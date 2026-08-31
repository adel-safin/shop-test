import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db/pool.js';
import { findProduct } from '../db/products.js';
import { findOrder, findOrderByClientToken, insertOrder } from '../db/orders.js';
import { findDelivery } from '../db/deliveries.js';
import {
  consumePromocode, findPromocode, recordPromocodeUse, releasePromocode,
} from '../db/promocodes.js';
import { applyPromocode } from '../domain/pricing.js';
import { STATUS } from '../domain/status.js';
import { AppError, notFound } from '../lib/errors.js';

const newOrderId = () => `ord_${randomUUID().replaceAll('-', '').slice(0, 16)}`;

export async function quote(sku, code) {
  const product = await findProduct(sku);
  if (!product) throw notFound('product_not_found');

  const base = Number(product.price_kopecks);
  if (!code) return { base, discount: 0, amount: base, promocode: null };

  const promo = await findPromocode(code.trim().toUpperCase());
  if (!promo) throw new AppError('promocode_not_found', { status: 404 });
  if (promo.used_count >= promo.max_uses) throw new AppError('promocode_limit_reached', { status: 409 });

  const discount = applyPromocode(base, promo);
  return { base, discount, amount: base - discount, promocode: promo.code };
}

export async function createOrder({ sku, promocode, clientToken, orderId }) {
  const product = await findProduct(sku);
  if (!product) throw notFound('product_not_found');

  const token = clientToken ?? randomUUID();

  return withTransaction(async (client) => {
    const existing = await findOrderByClientToken(client, token);
    if (existing) return { order: existing, created: false };

    const base = Number(product.price_kopecks);
    let discount = 0;
    let appliedCode = null;

    if (promocode) {
      const code = promocode.trim().toUpperCase();
      const promo = await findPromocode(code);
      if (!promo) throw new AppError('promocode_not_found', { status: 404 });

      // Лимит расходуется здесь, при создании заказа. Если оплата не пройдёт,
      // использование вернётся обратно в webhook-обработчике.
      const consumed = await consumePromocode(client, code);
      if (!consumed) throw new AppError('promocode_limit_reached', { status: 409 });

      discount = applyPromocode(base, consumed);
      appliedCode = consumed.code;
    }

    const order = await insertOrder(client, {
      id: orderId ?? newOrderId(),
      sku,
      baseAmount: base,
      discount,
      amount: base - discount,
      currency: product.currency,
      promocode: appliedCode,
      status: STATUS.created,
      clientToken: token,
    });

    if (!order) {
      // Второй параллельный клик с тем же токеном проиграл insert.
      // Промокод откатываем, отдаём заказ, который выиграл.
      if (appliedCode) await releasePromocode(client, appliedCode);
      const winner = await findOrderByClientToken(client, token);
      if (!winner) throw new AppError('order_conflict', { status: 409 });
      return { order: winner, created: false };
    }

    if (appliedCode) await recordPromocodeUse(client, order.id, appliedCode, discount);

    return { order, created: true };
  });
}

export async function getOrderView(id) {
  const order = await findOrder(id);
  if (!order) throw notFound('order_not_found');

  const delivery = await findDelivery(id);
  return {
    id: order.id,
    sku: order.sku,
    status: order.status,
    base_amount: Number(order.base_amount),
    discount: Number(order.discount),
    amount: Number(order.amount),
    currency: order.currency,
    promocode: order.promocode,
    fail_reason: order.fail_reason,
    created_at: order.created_at,
    updated_at: order.updated_at,
    code: delivery?.code ?? null,
    provider: delivery?.provider ?? null,
  };
}
