import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  SKU, adminDelete, adminGet, adminPost, createOrder, debug, ensureServerUp,
  payWebhook, poolFree, report, resetProviders, setProvider, uid, waitFor,
} from './helpers.mjs';

before(async () => {
  await ensureServerUp();
  await resetProviders();
});

after(resetProviders);

test('двойной клик «Купить»: 20 параллельных запросов с одним Idempotency-Key', async () => {
  const key = uid('click');
  const responses = await Promise.all(
    Array.from({ length: 20 }, () => createOrder({ idempotencyKey: key })),
  );

  const ids = new Set(responses.map((r) => r.body.id));
  const created = responses.filter((r) => r.status === 201).length;

  report('двойной клик', { запросов: 20, уникальных_заказов: ids.size, ответов_201: created });
  assert.equal(ids.size, 1);
  assert.equal(created, 1);
});

test('50 параллельных вебхуков с разными event_id: один ключ, одна выдача', async () => {
  const order = (await createOrder()).body;
  const freeBefore = await poolFree();

  const responses = await Promise.all(
    Array.from({ length: 50 }, () => payWebhook(order.id)),
  );

  const state = await waitFor(async () => {
    const snapshot = await debug(order.id);
    return snapshot.order.status === 'delivered' ? snapshot : null;
  });

  const freeAfter = await poolFree();

  report('шторм вебхуков', {
    вебхуков: 50,
    ответов_200: responses.filter((r) => r.status === 200).length,
    выдач: state.deliveries,
    событий: state.events,
    ключей_потрачено: freeBefore - freeAfter,
  });

  assert.equal(state.order.status, 'delivered');
  assert.equal(state.deliveries, 1);
  assert.equal(state.events, 50);
  assert.equal(freeBefore - freeAfter, 1);
  assert.ok(state.order.code);
});

test('повтор одного event_id 50 раз ничего не меняет', async () => {
  const order = (await createOrder()).body;
  const eventId = uid('evt');
  const freeBefore = await poolFree();

  await payWebhook(order.id, { eventId });
  const delivered = await waitFor(async () => {
    const snapshot = await debug(order.id);
    return snapshot.order.status === 'delivered' ? snapshot : null;
  });

  const replays = await Promise.all(
    Array.from({ length: 50 }, () => payWebhook(order.id, { eventId })),
  );

  const after = await debug(order.id);
  const freeAfter = await poolFree();

  report('повтор event_id', {
    повторов: 50,
    ответов_duplicate: replays.filter((r) => r.body.result === 'duplicate').length,
    событий_в_журнале: after.events,
    выдач: after.deliveries,
    ключей_потрачено: freeBefore - freeAfter,
  });

  assert.equal(after.events, 1);
  assert.equal(after.deliveries, 1);
  assert.equal(after.order.code, delivered.order.code);
  assert.equal(freeBefore - freeAfter, 1);
});

test('вебхук пришёл раньше заказа', async () => {
  const orderId = uid('ord');
  const freeBefore = await poolFree();

  const early = await payWebhook(orderId);
  const beforeCreate = await poolFree();

  const created = await createOrder({ orderId });
  const state = await waitFor(async () => {
    const snapshot = await debug(orderId);
    return snapshot.order.status === 'delivered' ? snapshot : null;
  });

  const freeAfter = await poolFree();

  report('ранний вебхук', {
    ответ_вебхука: early.body.result,
    ключей_до_создания: beforeCreate - freeBefore,
    статус: state.order.status,
    выдач: state.deliveries,
    ключей_потрачено: freeBefore - freeAfter,
  });

  assert.equal(early.status, 200);
  assert.equal(early.body.result, 'pending_order');
  assert.equal(created.status, 201);
  assert.equal(state.order.status, 'delivered');
  assert.equal(state.deliveries, 1);
  assert.equal(freeBefore - freeAfter, 1);
});

test('пустой пул: заказ восстановим, после пополнения ровно один ключ', async () => {
  const drained = await adminDelete(`/admin/keys/${SKU}`);
  assert.equal(drained.body.free, 0);

  const order = (await createOrder()).body;
  await payWebhook(order.id);

  const stuck = await waitFor(async () => {
    const snapshot = await debug(order.id);
    return snapshot.order.status === 'out_of_stock' ? snapshot : null;
  });

  const listed = await adminGet('/admin/orders');
  const inAdmin = listed.body.orders.some((row) => row.id === order.id);

  await adminPost(`/admin/keys/${SKU}`, { count: 5 });
  const freeBefore = await poolFree();

  const redeliveries = await Promise.all(
    Array.from({ length: 10 }, () => adminPost(`/admin/orders/${order.id}/redeliver`)),
  );

  const state = await waitFor(async () => {
    const snapshot = await debug(order.id);
    return snapshot.order.status === 'delivered' ? snapshot : null;
  });

  const freeAfter = await poolFree();
  const codes = new Set(redeliveries.map((r) => r.body.code).filter(Boolean));

  report('пустой пул', {
    статус_после_оплаты: stuck.order.status,
    виден_в_админке: inAdmin,
    повторных_выдач: 10,
    уникальных_кодов: codes.size,
    выдач: state.deliveries,
    ключей_потрачено: freeBefore - freeAfter,
  });

  assert.equal(stuck.order.status, 'out_of_stock');
  assert.ok(inAdmin);
  assert.equal(state.order.status, 'delivered');
  assert.equal(state.deliveries, 1);
  assert.equal(freeBefore - freeAfter, 1);
  assert.equal(codes.size, 1);

  await adminPost(`/admin/keys/${SKU}`, { count: 60 });
});

test('потерянный ответ поставщика: ключ выдан, ответ не дошёл', async () => {
  // A забирает ключ из пула и молчит. Наш повтор обязан получить тот же код,
  // а не следующий ключ.
  await setProvider('a', { lostRate: 1, hangMs: 5000 });

  const order = (await createOrder()).body;
  const freeBefore = await poolFree();

  await payWebhook(order.id);
  const failed = await waitFor(async () => {
    const snapshot = await debug(order.id);
    return ['delivery_failed', 'delivered'].includes(snapshot.order.status) ? snapshot : null;
  }, { timeoutMs: 30000 });

  const spentWhileLost = freeBefore - (await poolFree());

  await resetProviders();
  await adminPost('/admin/reconcile', { limit: 50 });

  const state = await waitFor(async () => {
    const snapshot = await debug(order.id);
    return snapshot.order.status === 'delivered' ? snapshot : null;
  }, { timeoutMs: 20000 });

  const freeAfter = await poolFree();

  report('потерянный ответ', {
    статус_после_потери: failed.order.status,
    ключей_ушло_при_потере: spentWhileLost,
    статус: state.order.status,
    выдач: state.deliveries,
    ключей_потрачено_всего: freeBefore - freeAfter,
  });

  assert.equal(spentWhileLost, 1);
  assert.equal(state.order.status, 'delivered');
  assert.equal(state.deliveries, 1);
  assert.equal(freeBefore - freeAfter, 1);
});

test('оба поставщика падают: delivery_failed, потом восстановление одним ключом', async () => {
  await setProvider('a', { errorRate: 1 });
  await setProvider('b', { errorRate: 1 });

  const order = (await createOrder()).body;
  const freeBefore = await poolFree();

  await payWebhook(order.id);
  const failed = await waitFor(async () => {
    const snapshot = await debug(order.id);
    return snapshot.order.status === 'delivery_failed' ? snapshot : null;
  }, { timeoutMs: 20000 });

  await resetProviders();
  const state = await waitFor(async () => {
    const snapshot = await debug(order.id);
    return snapshot.order.status === 'delivered' ? snapshot : null;
  }, { timeoutMs: 20000 });

  const freeAfter = await poolFree();

  report('оба поставщика упали', {
    статус_после_сбоя: failed.order.status,
    причина: failed.order.fail_reason,
    восстановлен: state.order.status,
    ключей_потрачено: freeBefore - freeAfter,
  });

  assert.equal(failed.order.status, 'delivery_failed');
  assert.equal(state.deliveries, 1);
  assert.equal(freeBefore - freeAfter, 1);
});

test('промокод с лимитом 3 под 30 параллельными заказами', async () => {
  const before = (await adminGet('/admin/promocodes')).body.promocodes
    .find((p) => p.code === 'LIMIT3');

  const responses = await Promise.all(
    Array.from({ length: 30 }, () => createOrder({ promocode: 'LIMIT3' })),
  );

  const applied = responses.filter((r) => r.body?.promocode === 'LIMIT3');
  const rejected = responses.filter((r) => r.body?.error === 'promocode_limit_reached');

  const after = (await adminGet('/admin/promocodes')).body.promocodes
    .find((p) => p.code === 'LIMIT3');

  const remaining = before.max_uses - before.used_count;

  report('лимит промокода', {
    запросов: 30,
    было_свободно: remaining,
    применено: applied.length,
    отказано: rejected.length,
    used_count: `${after.used_count}/${after.max_uses}`,
  });

  assert.equal(applied.length, remaining);
  assert.ok(after.used_count <= after.max_uses);
  assert.equal(rejected.length, 30 - remaining);
  assert.equal(applied.every((r) => r.body.discount === 32250), true);
});

test('скидку считает сервер, суммы из запроса игнорируются', async () => {
  const response = await createOrder({ promocode: 'WELCOME10' });
  const order = response.body;

  report('серверный расчёт', {
    base: order.base_amount,
    discount: order.discount,
    amount: order.amount,
  });

  assert.equal(order.base_amount, 129000);
  assert.equal(order.discount, 12900);
  assert.equal(order.amount, 116100);
});
