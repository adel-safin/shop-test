import { query } from './pool.js';

export async function insertOrder(client, order) {
  // on conflict do nothing вместо «посмотреть и вставить»: двойной клик приходит
  // с одним client_token, и второй insert обязан молча проиграть.
  const { rows } = await client.query(
    `insert into orders (id, sku, base_amount, discount, amount, currency, promocode, status, client_token)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict do nothing
     returning *`,
    [
      order.id, order.sku, order.baseAmount, order.discount, order.amount,
      order.currency, order.promocode, order.status, order.clientToken,
    ],
  );
  return rows[0] ?? null;
}

export async function findOrderByClientToken(client, token) {
  const { rows } = await client.query('select * from orders where client_token = $1', [token]);
  return rows[0] ?? null;
}

export async function findOrder(id) {
  const { rows } = await query('select * from orders where id = $1', [id]);
  return rows[0] ?? null;
}

export async function lockOrder(client, id) {
  const { rows } = await client.query('select * from orders where id = $1 for update', [id]);
  return rows[0] ?? null;
}

export async function setStatus(client, id, status, { failReason = null } = {}) {
  const { rows } = await client.query(
    `update orders set status = $2, fail_reason = $3, updated_at = now()
      where id = $1
     returning *`,
    [id, status, failReason],
  );
  return rows[0];
}

export async function listOrders({ state } = {}) {
  const filters = {
    stuck: `o.status in ('paid', 'delivering', 'out_of_stock', 'delivery_failed')`,
    delivered: `o.status = 'delivered'`,
  };
  const where = filters[state] ? `where ${filters[state]}` : '';

  const { rows } = await query(
    `select o.*, d.code as delivered_code, d.provider as delivered_by,
            (select count(*) from product_keys k where k.sku = o.sku and k.status = 'free') as free_keys
       from orders o
       left join deliveries d on d.order_id = o.id
       ${where}
      order by o.created_at desc
      limit 200`,
  );
  return rows;
}

// Кандидаты на автоматический повтор: зависшие в delivering дольше положенного
// и восстановимые, для которых снова появились ключи.
export async function claimRecoverable(client, staleMs, limit) {
  const { rows } = await client.query(
    `select o.id
       from orders o
      where (
              (o.status = 'delivering' and o.updated_at < now() - ($1::bigint * interval '1 millisecond'))
              or o.status = 'delivery_failed'
              or (o.status = 'out_of_stock'
                  and exists (select 1 from product_keys k where k.sku = o.sku and k.status = 'free'))
              or (o.status = 'paid' and o.updated_at < now() - ($1::bigint * interval '1 millisecond'))
            )
      order by o.updated_at
        for update skip locked
      limit $2`,
    [staleMs, limit],
  );
  return rows.map((row) => row.id);
}
