import { config, providerUrl } from '../config.js';

// request_id выводится из номера заказа, а не генерируется на каждую попытку.
// Иначе повтор после таймаута попросил бы у поставщика второй ключ.
export const requestIdFor = (orderId) => `req_${orderId}`;

async function call(name, { requestId, sku, orderId }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.providerTimeoutMs);

  try {
    const response = await fetch(providerUrl(name), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request_id: requestId, sku, order_id: orderId }),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({}));

    if (response.ok) return { outcome: 'ok', code: body.code };
    if (response.status === 504) return { outcome: 'timeout', reason: 'gateway_timeout' };
    if (body.reason === 'out_of_stock') return { outcome: 'out_of_stock' };
    return { outcome: 'error', reason: body.reason ?? `http_${response.status}` };
  } catch (error) {
    // Разорванное соединение и наш собственный abort одинаково означают
    // «исход неизвестен»: поставщик мог успеть выдать ключ.
    return { outcome: 'timeout', reason: error.name };
  } finally {
    clearTimeout(timer);
  }
}

export async function issueFromProviders({ orderId, sku }) {
  const requestId = requestIdFor(orderId);
  const trace = [];

  for (let attempt = 0; attempt <= config.providerRetries; attempt += 1) {
    const primary = await call('a', { requestId, sku, orderId });
    trace.push(`A:${primary.outcome}${primary.reason ? `(${primary.reason})` : ''}`);

    if (primary.outcome === 'ok') return { code: primary.code, provider: 'A', requestId, trace };
    if (primary.outcome === 'out_of_stock') return { outOfStock: true, requestId, trace };

    if (primary.outcome === 'timeout') {
      // Таймаут это не отказ. Уйти к резервному нельзя: A мог уже списать ключ.
      // Повторяем A с тем же request_id, пока он не ответит определённо.
      continue;
    }

    // Явная ошибка приходит до захвата ключа, значит пул не тронут
    // и резервный поставщик не приведёт к двойной выдаче.
    const backup = await call('b', { requestId, sku, orderId });
    trace.push(`B:${backup.outcome}${backup.reason ? `(${backup.reason})` : ''}`);

    if (backup.outcome === 'ok') return { code: backup.code, provider: 'B', requestId, trace };
    if (backup.outcome === 'out_of_stock') return { outOfStock: true, requestId, trace };
  }

  return { failed: true, reason: 'providers_unavailable', requestId, trace };
}
