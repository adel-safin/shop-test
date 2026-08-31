import express from 'express';
import { config } from '../config.js';
import { withTransaction } from '../db/pool.js';
import { asyncRoute, errorHandler, sleep } from '../lib/http.js';

// Доли сбоев живут в памяти, чтобы тест мог переключать их на лету.
const runtime = {
  A: { ...config.providers.A },
  B: { ...config.providers.B },
};

export const setProviderBehaviour = (name, patch) => Object.assign(runtime[name], patch);
export const getProviderBehaviour = (name) => ({ ...runtime[name] });

const pickOutcome = (behaviour, forced) => {
  if (forced) return forced;
  const roll = Math.random();
  const lost = behaviour.lostRate ?? 0;
  if (roll < behaviour.timeoutRate) return 'timeout';
  if (roll < behaviour.timeoutRate + behaviour.errorRate) return 'error';
  if (roll < behaviour.timeoutRate + behaviour.errorRate + lost) return 'lost';
  return 'ok';
};

async function issue({ provider, requestId, sku, orderId }) {
  return withTransaction(async (client) => {
    // Сериализуем повторы с одним request_id. Без этого две параллельные попытки
    // захватят два разных ключа, и один из них придётся возвращать в пул.
    await client.query('select pg_advisory_xact_lock(hashtext($1)::bigint)', [requestId]);

    const existing = await client.query(
      'select code from provider_issues where request_id = $1',
      [requestId],
    );
    if (existing.rowCount > 0) {
      return { code: existing.rows[0].code, replayed: true };
    }

    const claimed = await client.query(
      `update product_keys
          set status = 'issued', order_id = $1, issued_at = now()
        where id = (select id from product_keys
                     where sku = $2 and status = 'free'
                     order by id
                       for update skip locked
                     limit 1)
      returning id, code`,
      [orderId, sku],
    );

    if (claimed.rowCount === 0) {
      return { outOfStock: true };
    }

    const key = claimed.rows[0];
    await client.query(
      `insert into provider_issues (request_id, provider, order_id, sku, key_id, code)
       values ($1, $2, $3, $4, $5, $6)`,
      [requestId, provider, orderId, sku, key.id, key.code],
    );

    return { code: key.code, replayed: false };
  });
}

export function createProviderApp() {
  const app = express();
  app.use(express.json());

  app.post('/provider/:name/config', (req, res) => {
    const name = req.params.name.toUpperCase();
    if (!runtime[name]) return res.status(404).json({ status: 'error', reason: 'unknown_provider' });
    setProviderBehaviour(name, req.body ?? {});
    return res.json({ status: 'ok', behaviour: getProviderBehaviour(name) });
  });

  app.post('/provider/:name/issue', asyncRoute(async (req, res) => {
    const name = req.params.name.toUpperCase();
    const behaviour = runtime[name];
    if (!behaviour) return res.status(404).json({ status: 'error', reason: 'unknown_provider' });

    const { request_id: requestId, sku, order_id: orderId } = req.body ?? {};
    if (!requestId || !sku || !orderId) {
      return res.status(400).json({ status: 'error', reason: 'bad_request' });
    }

    const outcome = pickOutcome(behaviour, req.get('x-force-outcome'));

    if (outcome === 'timeout') {
      // Зависаем, не отвечая. Ключ не трогаем: клиент не может знать, выдали мы его или нет,
      // и обязан повторить с тем же request_id.
      await sleep(behaviour.hangMs);
      return res.status(504).json({ status: 'error', reason: 'timeout' });
    }

    // Сбой отдаём до захвата ключа. Именно это делает правило «явная ошибка = ключ не потрачен»
    // верным, и только поэтому переход на резервного поставщика безопасен.
    if (outcome === 'error') {
      return res.status(503).json({ status: 'error', reason: 'provider_unavailable' });
    }

    const result = await issue({ provider: name, requestId, sku, orderId });

    if (result.outOfStock) {
      return res.status(409).json({ status: 'error', reason: 'out_of_stock' });
    }

    // Настоящая ловушка таймаута: ключ уже выдан, а ответ до клиента не доехал.
    // Повтор с тем же request_id обязан вернуть этот же код, а не следующий из пула.
    if (outcome === 'lost') {
      await sleep(behaviour.hangMs);
      return res.status(504).json({ status: 'error', reason: 'timeout' });
    }

    return res.json({
      status: 'ok',
      request_id: requestId,
      code: result.code,
      replayed: result.replayed,
    });
  }));

  app.use(errorHandler);
  return app;
}
