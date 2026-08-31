import { admin, rubles } from './api.js';

const el = (selector) => document.querySelector(selector);
const client = () => admin(el('[data-token]').value.trim());
const sku = () => el('[data-sku]').value.trim();

const log = (message) => {
  const box = el('[data-log]');
  box.hidden = false;
  box.textContent = `${new Date().toLocaleTimeString('ru-RU')}  ${message}\n${box.textContent}`;
};

const cell = (text, className) => {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
};

function renderOrders(orders) {
  const body = el('[data-orders]');

  if (orders.length === 0) {
    body.replaceChildren(Object.assign(document.createElement('tr'), {
      innerHTML: '<td colspan="6" class="muted">пусто, всё выдано</td>',
    }));
    return;
  }

  body.replaceChildren(...orders.map((order) => {
    const row = document.createElement('tr');
    const button = document.createElement('button');
    button.className = 'btn';
    button.type = 'button';
    button.textContent = 'Выдать повторно';
    button.dataset.redeliver = order.id;

    const action = document.createElement('td');
    action.append(button);

    row.append(
      cell(order.id, 'mono'),
      cell(order.sku),
      cell(order.status),
      cell(order.fail_reason ?? '—', 'muted'),
      cell(String(order.free_keys)),
      action,
    );
    return row;
  }));
}

function renderPromocodes(promocodes) {
  el('[data-promocodes]').replaceChildren(...promocodes.map((promo) => {
    const row = document.createElement('tr');
    row.append(
      cell(promo.code, 'mono'),
      cell(promo.type),
      cell(promo.type === 'percent' ? `${promo.value}%` : rubles(Number(promo.value))),
      cell(`${promo.used_count} / ${promo.max_uses}`),
    );
    return row;
  }));
}

async function refresh() {
  try {
    const api = client();
    const [orders, promocodes, pool] = await Promise.all([
      api.orders(), api.promocodes(), api.pool(sku()),
    ]);
    renderOrders(orders.orders);
    renderPromocodes(promocodes.promocodes);
    el('[data-pool-info]').textContent = `${pool.sku}: свободно ${pool.free}, выдано ${pool.issued}`;
  } catch (error) {
    log(`ошибка: ${error.message}`);
  }
}

const guard = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (error) {
    log(`ошибка: ${error.message}`);
  }
};

el('[data-refresh]').addEventListener('click', refresh);

el('[data-pool]').addEventListener('click', guard(async () => {
  const pool = await client().pool(sku());
  el('[data-pool-info]').textContent = `${pool.sku}: свободно ${pool.free}, выдано ${pool.issued}`;
}));

el('[data-refill]').addEventListener('click', guard(async () => {
  const result = await client().refill(sku(), 5);
  log(`пул пополнен: +${result.added}, свободно ${result.free}`);
  await refresh();
}));

el('[data-drain]').addEventListener('click', guard(async () => {
  const result = await client().drain(sku());
  log(`пул осушён: удалено ${result.removed}`);
  await refresh();
}));

document.addEventListener('click', guard(async (event) => {
  const button = event.target.closest('[data-redeliver]');
  if (!button) return;

  const result = await client().redeliver(button.dataset.redeliver);
  log(`повторная выдача ${button.dataset.redeliver}: ${JSON.stringify(result)}`);
  await refresh();
}));

refresh();
