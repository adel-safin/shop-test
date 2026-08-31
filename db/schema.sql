create table if not exists products (
  sku            text primary key,
  name           text        not null,
  type           text        not null,
  price_kopecks  bigint      not null check (price_kopecks >= 0),
  currency       text        not null default 'RUB',
  image          text,
  created_at     timestamptz not null default now()
);

create table if not exists orders (
  id            text primary key,
  sku           text        not null references products (sku),
  base_amount   bigint      not null check (base_amount >= 0),
  discount      bigint      not null default 0 check (discount >= 0),
  amount        bigint      not null check (amount >= 0),
  currency      text        not null default 'RUB',
  promocode     text,
  status        text        not null,
  client_token  text,
  fail_reason   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint orders_status_known check (status in (
    'created', 'paid', 'delivering', 'delivered',
    'payment_failed', 'out_of_stock', 'delivery_failed'
  )),
  constraint orders_amount_matches check (amount = base_amount - discount)
);

-- Двойной клик «Купить» шлёт один и тот же Idempotency-Key.
-- Уникальный индекс, а не проверка в коде: между select и insert влезет второй клик.
create unique index if not exists orders_client_token_uq
  on orders (client_token) where client_token is not null;

create index if not exists orders_status_updated_idx on orders (status, updated_at);

create table if not exists product_keys (
  id          bigserial primary key,
  sku         text        not null references products (sku),
  code        text        not null,
  status      text        not null default 'free' check (status in ('free', 'issued')),
  order_id    text        references orders (id),
  issued_at   timestamptz,
  created_at  timestamptz not null default now(),
  constraint product_keys_code_uq unique (sku, code)
);

-- Один ключ физически не может быть привязан к двум заказам,
-- и один заказ не может утащить из пула два ключа.
create unique index if not exists product_keys_order_uq
  on product_keys (order_id) where order_id is not null;

create index if not exists product_keys_free_idx
  on product_keys (sku, id) where status = 'free';

-- Журнал вебхуков. FK на orders намеренно нет: событие может прийти раньше заказа.
create table if not exists payment_events (
  event_id     text primary key,
  order_id     text        not null,
  status       text        not null,
  amount       bigint,
  currency     text,
  payload      jsonb       not null,
  received_at  timestamptz not null default now(),
  applied_at   timestamptz
);

create index if not exists payment_events_pending_idx
  on payment_events (order_id) where applied_at is null;

-- Факт выдачи. PK по order_id и есть гарантия «ровно один факт на заказ».
create table if not exists deliveries (
  order_id    text primary key references orders (id),
  key_id      bigint      not null unique references product_keys (id),
  code        text        not null,
  provider    text        not null,
  request_id  text        not null unique,
  created_at  timestamptz not null default now()
);

-- Журнал поставщика: повтор с тем же request_id обязан вернуть тот же код.
create table if not exists provider_issues (
  request_id  text primary key,
  provider    text        not null,
  order_id    text        not null,
  sku         text        not null,
  key_id      bigint      not null unique,
  code        text        not null,
  created_at  timestamptz not null default now()
);

create table if not exists promocodes (
  code        text primary key,
  type        text   not null check (type in ('percent', 'amount')),
  value       bigint not null check (value > 0),
  currency    text,
  max_uses    integer not null check (max_uses > 0),
  used_count  integer not null default 0 check (used_count >= 0),
  constraint promocodes_limit check (used_count <= max_uses)
);

create table if not exists promocode_uses (
  order_id    text primary key references orders (id),
  code        text        not null references promocodes (code),
  discount    bigint      not null,
  created_at  timestamptz not null default now()
);
