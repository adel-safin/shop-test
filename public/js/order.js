import { api, rubles } from './api.js';

const orderId = new URLSearchParams(location.search).get('id');
const el = (selector) => document.querySelector(selector);

const STATUS_LABEL = {
  created: 'создан, ждёт оплаты',
  paid: 'оплачен, запускается выдача',
  delivering: 'идёт получение кода',
  delivered: 'код выдан',
  payment_failed: 'оплата не прошла',
  out_of_stock: 'оплачен, кода нет в наличии',
  delivery_failed: 'поставщики не смогли выдать',
};

const STATUS_TONE = {
  delivered: 'delivered',
  out_of_stock: 'recoverable',
  delivery_failed: 'recoverable',
  payment_failed: 'failed',
};

const HINT = {
  created: 'Нажмите «Оплатить»: заглушка отправит вебхук по контракту платёжной системы.',
  out_of_stock: 'Заказ восстановим. Пополните пул в админке и нажмите повторную выдачу.',
  delivery_failed: 'Оба поставщика отказали. Фоновый повтор идёт сам, либо повторите из админки.',
  payment_failed: 'Промокод, если он был, вернулся в лимит.',
};

const log = (message) => {
  const box = el('[data-log]');
  box.hidden = false;
  box.textContent = `${new Date().toLocaleTimeString('ru-RU')}  ${message}\n${box.textContent}`;
};

function render(order) {
  el('[data-order-id]').textContent = order.id;
  el('[data-sku]').textContent = order.sku;
  el('[data-base]').textContent = rubles(order.base_amount);
  el('[data-discount]').textContent = order.discount
    ? `${rubles(order.discount)} (${order.promocode})`
    : '—';
  el('[data-amount]').textContent = rubles(order.amount);

  const status = el('[data-status]');
  status.textContent = STATUS_LABEL[order.status] ?? order.status;
  status.className = `status${STATUS_TONE[order.status] ? ` status--${STATUS_TONE[order.status]}` : ''}`;

  el('[data-hint]').textContent = HINT[order.status] ?? '';

  const hasCode = Boolean(order.code);
  el('[data-code-box]').hidden = !hasCode;
  if (hasCode) el('[data-code]').textContent = order.code;

  const payable = order.status === 'created';
  document.querySelectorAll('[data-pay]').forEach((button) => { button.disabled = !payable; });
}

async function refresh() {
  const order = await api.order(orderId);
  render(order);
  return order;
}

// Выдача идёт после вебхука, поэтому статус подтягиваем поллингом,
// пока заказ не придёт в состояние, из которого сам он уже не уйдёт.
async function poll() {
  const settled = new Set(['delivered', 'payment_failed', 'created']);
  for (let i = 0; i < 60; i += 1) {
    const order = await refresh();
    if (settled.has(order.status)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-pay]');
  if (!button) return;

  const outcome = button.dataset.pay;
  log(`отправляем вебхук: ${outcome}`);

  try {
    const result = await api.pay(orderId, outcome);
    log(`event_id=${result.sent.event_id} ответ=${JSON.stringify(result.webhook)}`);
  } catch (error) {
    log(`ошибка: ${error.message}`);
  }

  poll();
});

if (!orderId) {
  el('[data-status]').textContent = 'не указан id заказа';
} else {
  poll();
}
