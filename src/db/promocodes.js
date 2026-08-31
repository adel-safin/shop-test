import { query } from './pool.js';

export async function findPromocode(code) {
  const { rows } = await query('select * from promocodes where code = $1', [code]);
  return rows[0] ?? null;
}

// Единственное место, где расходуется лимит. Условие used_count < max_uses стоит
// внутри update, поэтому параллельные запросы не могут перескочить лимит.
export async function consumePromocode(client, code) {
  const { rows } = await client.query(
    `update promocodes set used_count = used_count + 1
      where code = $1 and used_count < max_uses
     returning *`,
    [code],
  );
  return rows[0] ?? null;
}

export async function releasePromocode(client, code) {
  await client.query(
    `update promocodes set used_count = used_count - 1
      where code = $1 and used_count > 0`,
    [code],
  );
}

export async function recordPromocodeUse(client, orderId, code, discount) {
  await client.query(
    `insert into promocode_uses (order_id, code, discount) values ($1, $2, $3)
     on conflict (order_id) do nothing`,
    [orderId, code, discount],
  );
}

export async function deletePromocodeUse(client, orderId) {
  const { rows } = await client.query(
    'delete from promocode_uses where order_id = $1 returning code',
    [orderId],
  );
  return rows[0]?.code ?? null;
}

export async function listPromocodes() {
  const { rows } = await query('select * from promocodes order by code');
  return rows;
}
