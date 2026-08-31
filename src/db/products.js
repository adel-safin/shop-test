import { query } from './pool.js';

export async function listProducts() {
  const { rows } = await query(
    `select p.sku, p.name, p.type, p.price_kopecks, p.currency, p.image,
            count(k.id) filter (where k.status = 'free') as free_keys
       from products p
       left join product_keys k on k.sku = p.sku
      group by p.sku
      order by p.sku`,
  );
  return rows;
}

export async function findProduct(sku) {
  const { rows } = await query('select * from products where sku = $1', [sku]);
  return rows[0] ?? null;
}
