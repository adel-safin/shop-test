async function request(method, path, { body, headers } = {}) {
  const response = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    // На Pages /api нет: без таймаута fetch к github.io/api/... висит, пока CDN не ответит 404.
    signal: AbortSignal.timeout(2500),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(data?.error ?? `http_${response.status}`);
    error.payload = data;
    throw error;
  }

  return data;
}

export const api = {
  products: () => request('GET', '/api/products'),
  order: (id) => request('GET', `/api/orders/${id}`),
  createOrder: (sku, idempotencyKey, promocode) =>
    request('POST', '/api/orders', {
      body: { sku, promocode },
      headers: { 'idempotency-key': idempotencyKey },
    }),
  pay: (id, outcome) => request('POST', `/api/dev/pay/${id}?outcome=${outcome}`, { body: {} }),
};

export const admin = (token) => ({
  orders: () => request('GET', '/admin/orders', { headers: { 'x-admin-token': token } }),
  redeliver: (id) =>
    request('POST', `/admin/orders/${id}/redeliver`, { body: {}, headers: { 'x-admin-token': token } }),
  pool: (sku) => request('GET', `/admin/keys/${sku}`, { headers: { 'x-admin-token': token } }),
  refill: (sku, count) =>
    request('POST', `/admin/keys/${sku}`, { body: { count }, headers: { 'x-admin-token': token } }),
  drain: (sku) => request('DELETE', `/admin/keys/${sku}`, { headers: { 'x-admin-token': token } }),
  promocodes: () => request('GET', '/admin/promocodes', { headers: { 'x-admin-token': token } }),
});

export const isStaticHost = () => /\.github\.io$/.test(location.hostname);
