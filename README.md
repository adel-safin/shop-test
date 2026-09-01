# Магазин цифровых товаров

Витрина и выдача ключа. Один ключ не уходит в два заказа, даже если вебхук прилетит 50 раз.

Node.js + Express + Postgres. Фронт без сборщика, лежит в `public/` и отдаётся тем же процессом.

## Запуск

```bash
docker compose up -d db
npm install
npm run db:reset
npm start
```

Открывается на http://localhost:3000. Админка: `/admin.html`, токен `dev-admin-token`.

Postgres слушает 5433, чтобы не пересечься с локальным 5432. Своя база: `DATABASE_URL`.

## Гонки

Сервер уже запущен:

```bash
npm run db:reset
npm run test:race
```

Сбрасывать нужно: иначе лимиты промокодов уже съедены предыдущим прогоном.

Скрипт гоняет параллельные вебхуки, повтор `event_id`, вебхук раньше заказа, пустой пул и промокод `LIMIT3`. Печатает числа, не только PASS.

То же руками:

```bash
ORDER=$(curl -s -XPOST localhost:3000/api/orders \
  -H 'content-type: application/json' \
  -H 'idempotency-key: manual-1' \
  -d '{"sku":"KEY-CS2-PRIME"}' | jq -r .id)

seq 50 | xargs -P 50 -I{} curl -s -o /dev/null -XPOST localhost:3000/webhook/payment \
  -H 'content-type: application/json' \
  -d "{\"event_id\":\"evt-{}\",\"order_id\":\"$ORDER\",\"status\":\"paid\",\"amount\":1290,\"currency\":\"RUB\"}"

curl -s localhost:3000/api/debug/orders/$ORDER | jq
```

Ожидание: `deliveries: 1`, из пула ушёл один ключ.

## Почему ключ один

Три вещи, и любая из них сама по себе уже не даёт задвоения.

Заказ берётся `for update` на время обработки вебхука. Остальные ждут и видят готовый статус.

В схеме `deliveries.order_id` это PK, ключ из пула захватывается одним `update ... skip locked`. Вторую строку Postgres просто не вставит.

`request_id` считается из номера заказа (`req_<id>`), не генерируется заново. Повтор после таймаута получает тот же код.

HTTP к поставщику идёт вне транзакции. Иначе блокировка заказа висит, пока сеть отвечает.

Пустой пул это `out_of_stock`, не падение. Потом из админки пополняешь и жмёшь повторную выдачу. Если ключ уже выдан, вернётся он же.

Скидку считает сервер. Из запроса берём `sku` и код промокода, сумму от клиента не принимаем.

Ключи в сиде только у `KEY-CS2-PRIME`. Остальные товары тоже покупаются, но уходят в `out_of_stock`. Это второй сценарий, не баг.

Доли ошибок поставщиков крутятся через `PROVIDER_A_ERROR_RATE` / `TIMEOUT_RATE` / `LOST_RATE` (и те же для B). На лету: `POST /admin/providers/a {"errorRate": 1}`.
