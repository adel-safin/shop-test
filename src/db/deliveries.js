import { query } from './pool.js';

// Второй барьер однократной выдачи. PK по order_id: даже если блокировка заказа
// не сработает, вторая строка просто не встанет.
export async function insertDelivery(client, delivery) {
  const { rows } = await client.query(
    `insert into deliveries (order_id, key_id, code, provider, request_id)
     values ($1, $2, $3, $4, $5)
     on conflict (order_id) do nothing
     returning *`,
    [delivery.orderId, delivery.keyId, delivery.code, delivery.provider, delivery.requestId],
  );
  return rows[0] ?? null;
}

export async function findDelivery(orderId, client) {
  const runner = client ?? { query };
  const { rows } = await runner.query('select * from deliveries where order_id = $1', [orderId]);
  return rows[0] ?? null;
}

export async function countDeliveries(orderId) {
  const { rows } = await query(
    'select count(*)::int as total from deliveries where order_id = $1',
    [orderId],
  );
  return rows[0].total;
}

export async function countFreeKeys(sku) {
  const { rows } = await query(
    `select count(*)::int as total from product_keys where sku = $1 and status = 'free'`,
    [sku],
  );
  return rows[0].total;
}

export async function countIssuedKeys(sku) {
  const { rows } = await query(
    `select count(*)::int as total from product_keys where sku = $1 and status = 'issued'`,
    [sku],
  );
  return rows[0].total;
}

export async function addKeys(sku, codes) {
  const { rows } = await query(
    `insert into product_keys (sku, code) select $1, unnest($2::text[])
     on conflict (sku, code) do nothing
     returning id`,
    [sku, codes],
  );
  return rows.length;
}

export async function drainKeys(sku) {
  const { rows } = await query(
    `delete from product_keys where sku = $1 and status = 'free' returning id`,
    [sku],
  );
  return rows.length;
}

export async function findKeyIssue(requestId) {
  const { rows } = await query('select * from provider_issues where request_id = $1', [requestId]);
  return rows[0] ?? null;
}
