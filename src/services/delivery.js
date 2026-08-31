import { config } from '../config.js';
import { withTransaction } from '../db/pool.js';
import { lockOrder, setStatus } from '../db/orders.js';
import { findDelivery, insertDelivery } from '../db/deliveries.js';
import { STATUS, canTransition } from '../domain/status.js';
import { issueFromProviders } from './provider-client.js';

const DELIVERABLE = new Set([
  STATUS.paid, STATUS.delivering, STATUS.outOfStock, STATUS.deliveryFailed,
]);

// Шаг 1. Под блокировкой заказа решаем, кто именно идёт к поставщику.
// Транзакция закрывается до сетевого вызова: держать блокировку поверх HTTP нельзя.
async function claimForDelivery(orderId, { force = false } = {}) {
  return withTransaction(async (client) => {
    const order = await lockOrder(client, orderId);
    if (!order) return { skipped: 'order_not_found' };

    const delivered = await findDelivery(orderId, client);
    if (delivered) {
      if (order.status !== STATUS.delivered) {
        await setStatus(client, orderId, STATUS.delivered);
      }
      return { skipped: 'already_delivered', code: delivered.code };
    }

    if (!DELIVERABLE.has(order.status)) return { skipped: order.status };

    if (order.status === STATUS.delivering && !force) {
      const ageMs = Date.now() - new Date(order.updated_at).getTime();
      if (ageMs < config.staleDeliveringMs) return { skipped: 'in_progress' };
    }

    if (order.status !== STATUS.delivering && !canTransition(order.status, STATUS.delivering)) {
      return { skipped: order.status };
    }

    // Пишем статус даже если он уже delivering: обновлённый updated_at говорит
    // reconciler'у, что попытка живая.
    await setStatus(client, orderId, STATUS.delivering);
    return { claimed: true, sku: order.sku };
  });
}

// Шаг 3. Записываем результат. PK по order_id решает исход, если сюда
// одновременно пришли два воркера.
async function commitDelivery(orderId, { code, provider, requestId }) {
  return withTransaction(async (client) => {
    await lockOrder(client, orderId);

    const existing = await findDelivery(orderId, client);
    if (existing) {
      await setStatus(client, orderId, STATUS.delivered);
      return { code: existing.code, duplicate: existing.code !== code };
    }

    const { rows } = await client.query(
      `select id from product_keys where sku = (select sku from orders where id = $1) and code = $2`,
      [orderId, code],
    );
    if (rows.length === 0) throw new Error(`key ${code} not found in pool for ${orderId}`);

    const inserted = await insertDelivery(client, {
      orderId, keyId: rows[0].id, code, provider, requestId,
    });

    await setStatus(client, orderId, STATUS.delivered);
    return { code: inserted?.code ?? code, duplicate: inserted === null };
  });
}

async function markFailure(orderId, status, reason) {
  return withTransaction(async (client) => {
    const order = await lockOrder(client, orderId);
    if (!order) return;

    // Пока мы ходили к поставщику, заказ мог закрыть другой воркер.
    const delivered = await findDelivery(orderId, client);
    if (delivered) {
      await setStatus(client, orderId, STATUS.delivered);
      return;
    }

    if (canTransition(order.status, status)) {
      await setStatus(client, orderId, status, { failReason: reason });
    }
  });
}

export async function deliver(orderId, options = {}) {
  const claim = await claimForDelivery(orderId, options);
  if (!claim.claimed) return { status: 'skipped', reason: claim.skipped, code: claim.code ?? null };

  const result = await issueFromProviders({ orderId, sku: claim.sku });

  if (result.outOfStock) {
    await markFailure(orderId, STATUS.outOfStock, 'out_of_stock');
    return { status: STATUS.outOfStock, trace: result.trace };
  }

  if (result.failed) {
    await markFailure(orderId, STATUS.deliveryFailed, result.reason);
    return { status: STATUS.deliveryFailed, reason: result.reason, trace: result.trace };
  }

  const committed = await commitDelivery(orderId, {
    code: result.code,
    provider: result.provider,
    requestId: result.requestId,
  });

  return { status: STATUS.delivered, code: committed.code, trace: result.trace };
}
