import { randomUUID } from 'node:crypto';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin-token';

export const SKU = 'KEY-CS2-PRIME';

export const uid = (prefix) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;

async function request(method, path, { body, headers } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, body: json };
}

export const get = (path, headers) => request('GET', path, { headers });
export const post = (path, body, headers) => request('POST', path, { body, headers });
export const del = (path, headers) => request('DELETE', path, { headers });

const admin = { 'x-admin-token': ADMIN_TOKEN };

export const adminGet = (path) => get(path, admin);
export const adminPost = (path, body) => post(path, body, admin);
export const adminDelete = (path) => del(path, admin);

export async function createOrder({ sku = SKU, promocode, orderId, idempotencyKey } = {}) {
  const headers = idempotencyKey ? { 'idempotency-key': idempotencyKey } : {};
  return post('/api/orders', { sku, promocode, order_id: orderId }, headers);
}

export const payWebhook = (orderId, { eventId = uid('evt'), status = 'paid', amount = 1290 } = {}) =>
  post('/webhook/payment', {
    event_id: eventId,
    order_id: orderId,
    status,
    amount,
    currency: 'RUB',
    created_at: new Date().toISOString(),
  });

export const debug = async (orderId) => (await get(`/api/debug/orders/${orderId}`)).body;

export const poolFree = async (sku = SKU) => (await adminGet(`/admin/keys/${sku}`)).body.free;

export const setProvider = (name, patch) => adminPost(`/admin/providers/${name}`, patch);

export const resetProviders = async () => {
  const clean = { errorRate: 0, timeoutRate: 0, lostRate: 0, hangMs: 30000 };
  await setProvider('a', clean);
  await setProvider('b', clean);
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(check, { timeoutMs = 15000, stepMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await sleep(stepMs);
  }
  return last;
}

export async function ensureServerUp() {
  const response = await get('/api/products').catch(() => null);
  if (!response || response.status !== 200) {
    throw new Error(`сервер не отвечает на ${BASE}. Запустите npm start в соседнем терминале`);
  }
}

export const report = (title, facts) => {
  const line = Object.entries(facts).map(([key, value]) => `${key}=${value}`).join(' ');
  console.log(`  ${title}: ${line}`);
};
