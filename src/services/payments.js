import { withTransaction } from '../db/pool.js';
import { lockOrder, setStatus } from '../db/orders.js';
import { markEventApplied, pendingEventsFor, recordEvent } from '../db/payments.js';
import { deletePromocodeUse, releasePromocode } from '../db/promocodes.js';
import { STATUS, canTransition, isFinal } from '../domain/status.js';
import { AppError } from '../lib/errors.js';
import { deliver } from './delivery.js';

function normalize(body) {
  const eventId = body?.event_id;
  const orderId = body?.order_id;
  const status = body?.status;

  if (!eventId || !orderId || !['paid', 'failed'].includes(status)) {
    throw new AppError('invalid_webhook_payload', { status: 400 });
  }

  return {
    eventId,
    orderId,
    status,
    amount: Number.isFinite(Number(body.amount)) ? Math.round(Number(body.amount) * 100) : null,
    currency: body.currency ?? null,
    payload: body,
  };
}

async function applyEvent(client, order, event) {
  if (isFinal(order.status)) return { needsDelivery: false };

  if (event.status === 'paid') {
    if (canTransition(order.status, STATUS.paid)) {
      // Из вебхука берём только факт оплаты. Сумму сверяем со своей, расхождение
      // логируем, но заказ по данным клиента не переписываем.
      if (event.amount !== null && event.amount !== Number(order.amount)) {
        console.warn(`amount mismatch on ${order.id}: webhook ${event.amount}, order ${order.amount}`);
      }
      await setStatus(client, order.id, STATUS.paid);
    }
    return { needsDelivery: true };
  }

  if (canTransition(order.status, STATUS.paymentFailed)) {
    // Оплата не прошла, использование промокода возвращаем в лимит.
    const code = await deletePromocodeUse(client, order.id);
    if (code) await releasePromocode(client, code);
    await setStatus(client, order.id, STATUS.paymentFailed, { failReason: 'payment_failed' });
  }

  // Поздний failed после успешной оплаты ничего не откатывает.
  return { needsDelivery: false };
}

export async function handlePaymentWebhook(body) {
  const event = normalize(body);

  const outcome = await withTransaction(async (client) => {
    const stored = await recordEvent(client, event);
    if (!stored) return { result: 'duplicate' };

    const order = await lockOrder(client, event.orderId);
    if (!order) {
      // Вебхук обогнал создание заказа. Событие остаётся неприменённым,
      // его подхватит создание заказа или reconciler.
      return { result: 'pending_order' };
    }

    const applied = await applyEvent(client, order, event);
    await markEventApplied(client, event.eventId);
    return { result: 'applied', needsDelivery: applied.needsDelivery };
  });

  if (outcome.result === 'applied' && outcome.needsDelivery) {
    await deliver(event.orderId);
  }

  return outcome;
}

// Применяет события, пришедшие раньше заказа. Вызывается после создания заказа
// и из reconciler'а.
export async function applyPendingEvents(orderId) {
  const outcome = await withTransaction(async (client) => {
    let order = await lockOrder(client, orderId);
    if (!order) return { needsDelivery: false };

    const events = await pendingEventsFor(client, orderId);
    if (events.length === 0) return { needsDelivery: false };

    // Если в буфере лежат и paid, и failed, побеждает paid: порядок доставки
    // вебхуков не гарантирован, а факт успешной оплаты сильнее.
    events.sort((a, b) => (a.status === b.status ? 0 : a.status === 'paid' ? -1 : 1));

    let needsDelivery = false;
    for (const stored of events) {
      const applied = await applyEvent(client, order, {
        ...stored,
        amount: stored.amount === null ? null : Number(stored.amount),
      });
      needsDelivery = needsDelivery || applied.needsDelivery;
      await markEventApplied(client, stored.event_id);
      order = await lockOrder(client, orderId);
    }

    return { needsDelivery };
  });

  if (outcome.needsDelivery) await deliver(orderId);
  return outcome;
}
