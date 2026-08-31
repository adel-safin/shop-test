import { config } from '../config.js';
import { withTransaction } from '../db/pool.js';
import { claimRecoverable } from '../db/orders.js';
import { applyPendingEvents } from './payments.js';
import { deliver } from './delivery.js';

let timer = null;
let running = false;

// Подбирает всё, что застряло: заказы, чей воркер умер посреди доставки,
// восстановимые после пополнения пула и оплаты, чей вебхук пришёл раньше заказа.
export async function runOnce(limit = 20) {
  const ids = await withTransaction((client) =>
    claimRecoverable(client, config.staleDeliveringMs, limit));

  const results = [];
  for (const id of ids) {
    try {
      await applyPendingEvents(id);
      results.push({ id, ...(await deliver(id)) });
    } catch (error) {
      console.error(`reconciler failed on ${id}`, error);
      results.push({ id, status: 'error', reason: error.message });
    }
  }
  return results;
}

export function startReconciler() {
  if (!config.reconcilerEnabled || timer) return;

  timer = setInterval(() => {
    if (running) return;
    running = true;
    runOnce()
      .catch((error) => console.error('reconciler tick failed', error))
      .finally(() => { running = false; });
  }, config.reconcilerIntervalMs);

  timer.unref();
}

export function stopReconciler() {
  if (timer) clearInterval(timer);
  timer = null;
}
