import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool, closePool } from '../src/db/pool.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const readJson = async (name) => JSON.parse(await readFile(join(root, 'data', name), 'utf8'));

async function main() {
  const schema = await readFile(join(here, 'schema.sql'), 'utf8');
  const [products, keys, promocodes] = await Promise.all([
    readJson('products.json'),
    readJson('keys.json'),
    readJson('promocodes.json'),
  ]);

  await pool.query(`
    drop table if exists promocode_uses, promocodes, provider_issues, deliveries,
                         payment_events, product_keys, orders, products cascade;
  `);
  await pool.query(schema);

  for (const product of products.products) {
    await pool.query(
      `insert into products (sku, name, type, price_kopecks, currency, image)
       values ($1, $2, $3, $4, $5, $6)`,
      [product.sku, product.name, product.type, product.price * 100, product.currency, product.image],
    );
  }

  await pool.query(
    `insert into product_keys (sku, code) select $1, unnest($2::text[])`,
    [keys.sku, keys.keys],
  );

  for (const promo of promocodes.promocodes) {
    await pool.query(
      `insert into promocodes (code, type, value, currency, max_uses)
       values ($1, $2, $3, $4, $5)`,
      [promo.code, promo.type, promo.type === 'amount' ? promo.value * 100 : promo.value,
       promo.currency ?? null, promo.max_uses],
    );
  }

  console.log(
    `готово: ${products.products.length} товаров, ${keys.keys.length} ключей для ${keys.sku}, ` +
    `${promocodes.promocodes.length} промокодов`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
