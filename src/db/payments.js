import { query } from './pool.js';

// Возвращает null, если событие с таким event_id уже записано. Первичный ключ
// и есть проверка на дубль: любой select-before-insert проиграет гонку.
export async function recordEvent(client, event) {
  const { rows } = await client.query(
    `insert into payment_events (event_id, order_id, status, amount, currency, payload)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (event_id) do nothing
     returning *`,
    [event.eventId, event.orderId, event.status, event.amount, event.currency, event.payload],
  );
  return rows[0] ?? null;
}

export async function markEventApplied(client, eventId) {
  await client.query(
    'update payment_events set applied_at = now() where event_id = $1 and applied_at is null',
    [eventId],
  );
}

// События, пришедшие раньше заказа, ждут здесь до его появления.
export async function pendingEventsFor(client, orderId) {
  const { rows } = await client.query(
    `select * from payment_events
      where order_id = $1 and applied_at is null
      order by received_at`,
    [orderId],
  );
  return rows;
}

export async function countEvents(orderId) {
  const { rows } = await query(
    'select count(*)::int as total from payment_events where order_id = $1',
    [orderId],
  );
  return rows[0].total;
}
