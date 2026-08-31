import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { config, apiUrl } from '../config.js';
import { listProducts } from '../db/products.js';
import { countDeliveries, countFreeKeys } from '../db/deliveries.js';
import { countEvents } from '../db/payments.js';
import { createOrder, getOrderView, quote } from '../services/orders.js';
import { applyPendingEvents, handlePaymentWebhook } from '../services/payments.js';
import { runOnce } from '../services/reconciler.js';
import { setProviderBehaviour } from '../providers/server.js';
import {
  emptyPool, poolStats, promocodeStats, redeliver, refillKeys, stuckOrders,
} from '../services/admin.js';
import { asyncRoute } from '../lib/http.js';
import { AppError } from '../lib/errors.js';

const requireAdmin = (req, res, next) => {
  if (req.get('x-admin-token') !== config.adminToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
};

export function createRouter() {
  const router = Router();

  router.get('/api/products', asyncRoute(async (req, res) => {
    res.json({ products: await listProducts() });
  }));

  router.post('/api/promocodes/preview', asyncRoute(async (req, res) => {
    const { sku, code } = req.body ?? {};
    res.json(await quote(sku, code));
  }));

  router.post('/api/orders', asyncRoute(async (req, res) => {
    const { sku, promocode, order_id: orderId } = req.body ?? {};
    if (!sku) throw new AppError('sku_required');

    const clientToken = req.get('idempotency-key') ?? null;
    const { order, created } = await createOrder({ sku, promocode, clientToken, orderId });

    // Вебхук мог прийти раньше заказа: применяем то, что уже лежит в журнале.
    await applyPendingEvents(order.id);

    res.status(created ? 201 : 200).json(await getOrderView(order.id));
  }));

  router.get('/api/orders/:id', asyncRoute(async (req, res) => {
    res.json(await getOrderView(req.params.id));
  }));

  router.post('/webhook/payment', asyncRoute(async (req, res) => {
    const outcome = await handlePaymentWebhook(req.body);
    res.json({ received: true, ...outcome });
  }));

  // Эмуляция платёжной системы: сама шлёт вебхук по контракту.
  router.post('/api/dev/pay/:id', asyncRoute(async (req, res) => {
    const status = req.query.outcome === 'fail' ? 'failed' : 'paid';
    const order = await getOrderView(req.params.id);

    const event = {
      event_id: req.body?.event_id ?? `evt_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      order_id: order.id,
      status,
      amount: order.amount / 100,
      currency: order.currency,
      created_at: new Date().toISOString(),
    };

    const response = await fetch(apiUrl('/webhook/payment'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });

    res.status(response.status).json({ sent: event, webhook: await response.json() });
  }));

  router.get('/api/debug/orders/:id', asyncRoute(async (req, res) => {
    const order = await getOrderView(req.params.id);
    res.json({
      order,
      deliveries: await countDeliveries(order.id),
      events: await countEvents(order.id),
      free_keys: await countFreeKeys(order.sku),
    });
  }));

  router.use('/admin', requireAdmin);

  router.get('/admin/orders', asyncRoute(async (req, res) => {
    res.json({ orders: await stuckOrders() });
  }));

  router.post('/admin/orders/:id/redeliver', asyncRoute(async (req, res) => {
    res.json(await redeliver(req.params.id));
  }));

  router.get('/admin/keys/:sku', asyncRoute(async (req, res) => {
    res.json(await poolStats(req.params.sku));
  }));

  router.post('/admin/keys/:sku', asyncRoute(async (req, res) => {
    const codes = Array.isArray(req.body?.codes) && req.body.codes.length > 0
      ? req.body.codes
      : Array.from({ length: Number(req.body?.count ?? 1) },
          () => `REFI-${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`);

    res.json(await refillKeys(req.params.sku, codes));
  }));

  router.delete('/admin/keys/:sku', asyncRoute(async (req, res) => {
    res.json(await emptyPool(req.params.sku));
  }));

  router.get('/admin/promocodes', asyncRoute(async (req, res) => {
    res.json({ promocodes: await promocodeStats() });
  }));

  router.post('/admin/reconcile', asyncRoute(async (req, res) => {
    res.json({ processed: await runOnce(Number(req.body?.limit ?? 50)) });
  }));

  router.post('/admin/providers/:name', asyncRoute(async (req, res) => {
    const name = req.params.name.toUpperCase();
    if (!['A', 'B'].includes(name)) throw new AppError('unknown_provider', { status: 404 });
    setProviderBehaviour(name, req.body ?? {});
    res.json({ ok: true });
  }));

  return router;
}
