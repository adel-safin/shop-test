import { findOrder, listOrders } from '../db/orders.js';
import { addKeys, countFreeKeys, countIssuedKeys, drainKeys, findDelivery } from '../db/deliveries.js';
import { listPromocodes } from '../db/promocodes.js';
import { STATUS } from '../domain/status.js';
import { notFound } from '../lib/errors.js';
import { deliver } from './delivery.js';
import { applyPendingEvents } from './payments.js';

const UNDELIVERED = new Set([
  STATUS.paid, STATUS.delivering, STATUS.outOfStock, STATUS.deliveryFailed,
]);

export async function stuckOrders() {
  const rows = await listOrders({ state: 'stuck' });
  return rows
    .filter((row) => UNDELIVERED.has(row.status) && row.delivered_code === null)
    .map((row) => ({
      id: row.id,
      sku: row.sku,
      status: row.status,
      amount: Number(row.amount),
      fail_reason: row.fail_reason,
      free_keys: Number(row.free_keys),
      updated_at: row.updated_at,
    }));
}

// Ручная повторная выдача. Идемпотентна: если заказ уже закрыт, отдаём тот же
// код и ничего не трогаем.
export async function redeliver(orderId) {
  const order = await findOrder(orderId);
  if (!order) throw notFound('order_not_found');

  const existing = await findDelivery(orderId);
  if (existing) return { status: STATUS.delivered, code: existing.code, repeated: true };

  await applyPendingEvents(orderId);
  return deliver(orderId, { force: true });
}

export async function refillKeys(sku, codes) {
  const added = await addKeys(sku, codes);
  return { added, free: await countFreeKeys(sku) };
}

export async function poolStats(sku) {
  const [free, issued] = await Promise.all([countFreeKeys(sku), countIssuedKeys(sku)]);
  return { sku, free, issued };
}

export async function emptyPool(sku) {
  const removed = await drainKeys(sku);
  return { removed, free: await countFreeKeys(sku) };
}

export const promocodeStats = () => listPromocodes();
