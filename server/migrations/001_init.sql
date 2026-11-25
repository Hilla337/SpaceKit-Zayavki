-- SpaceKit · Заявки · начальная схема.
-- Каждый файл миграции выполняется в одной транзакции (см. src/migrate.ts).

CREATE TYPE user_role AS ENUM ('customer', 'manager', 'picker', 'admin');
CREATE TYPE account_status AS ENUM ('pending', 'approved', 'blocked');
CREATE TYPE request_status AS ENUM ('new', 'work', 'confirm', 'assembly', 'partial', 'shipped', 'cancelled');
CREATE TYPE match_state AS ENUM ('none', 'found', 'created');

-- Компании-заказчики. manager_id — менеджер, который ведёт клиента (NULL = клиент ещё не распределён).
CREATE TABLE companies (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              text NOT NULL,
  status            account_status NOT NULL DEFAULT 'pending',
  manager_id        bigint,
  show_prices_early boolean NOT NULL DEFAULT false, -- true: заказчик видит цены на всех статусах, а не только с «На подтверждении»
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone      text UNIQUE,
  name       text NOT NULL,
  role       user_role NOT NULL,
  company_id bigint REFERENCES companies(id),
  status     account_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_has_phone_and_company CHECK (role <> 'customer' OR (phone IS NOT NULL AND company_id IS NOT NULL)),
  CONSTRAINT only_customer_has_company CHECK (role = 'customer' OR company_id IS NULL)
);

ALTER TABLE companies
  ADD CONSTRAINT companies_manager_fk FOREIGN KEY (manager_id) REFERENCES users(id);

-- Клиента может вести только пользователь с ролью manager.
CREATE FUNCTION check_company_manager() RETURNS trigger AS $$
BEGIN
  IF NEW.manager_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.manager_id AND role = 'manager') THEN
    RAISE EXCEPTION 'companies.manager_id must reference a user with role manager';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER companies_manager_check
  BEFORE INSERT OR UPDATE OF manager_id ON companies
  FOR EACH ROW EXECUTE FUNCTION check_company_manager();

-- История распределения клиентов между менеджерами.
CREATE TABLE company_manager_history (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id      bigint NOT NULL REFERENCES companies(id),
  from_manager_id bigint REFERENCES users(id),
  to_manager_id   bigint REFERENCES users(id),
  changed_by      bigint REFERENCES users(id),
  changed_at      timestamptz NOT NULL DEFAULT now()
);

-- Объекты заказчика (поля проекта МоегоСклада).
CREATE TABLE objects (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  bigint NOT NULL REFERENCES companies(id),
  jk          text,
  street      text,
  house       text,
  entrance    text,
  floor       text,
  apt         text,
  height_limit text,
  lift        text CHECK (lift IN ('грузовой', 'пассажирский', 'нет')),
  resp_name   text,
  resp_phone  text,
  district    text,
  parking     text,
  pass        text,
  extra_info  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Кэш каталога из МоегоСклада.
CREATE TABLE catalog (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ms_id      text NOT NULL UNIQUE,
  store      text NOT NULL DEFAULT '',
  store_code text,
  name       text NOT NULL,
  price      numeric(12, 2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX catalog_store_code_uq ON catalog (store, store_code) WHERE store_code IS NOT NULL;

-- Заявки. Владелец заявки — менеджер компании (companies.manager_id), отдельно он не хранится.
CREATE TABLE requests (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id     bigint NOT NULL REFERENCES companies(id),
  created_by     bigint NOT NULL REFERENCES users(id),
  object_id      bigint REFERENCES objects(id),
  status         request_status NOT NULL DEFAULT 'new',
  change_comment text,
  ms_order_id    text UNIQUE,
  ms_project     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX requests_company_status_idx ON requests (company_id, status);
CREATE INDEX requests_status_idx ON requests (status);

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER requests_updated_at
  BEFORE UPDATE ON requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE request_items (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id  bigint NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  store       text,
  url         text,
  store_code  text,
  name        text NOT NULL,
  qty         numeric(12, 3) NOT NULL DEFAULT 1,
  unit        text,
  note        text,
  match_state match_state NOT NULL DEFAULT 'none',
  sku_id      bigint REFERENCES catalog(id),
  price       numeric(12, 2),
  picked      boolean NOT NULL DEFAULT false,
  shipped     boolean NOT NULL DEFAULT false
);
CREATE INDEX request_items_request_idx ON request_items (request_id);

CREATE TABLE shipments (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id     bigint NOT NULL REFERENCES requests(id),
  number         text NOT NULL UNIQUE,
  ms_shipment_id text,
  created_by     bigint REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shipment_items (
  shipment_id bigint NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  item_id     bigint NOT NULL REFERENCES request_items(id),
  PRIMARY KEY (shipment_id, item_id)
);

CREATE TABLE messages (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id bigint NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  author_id  bigint NOT NULL REFERENCES users(id),
  text       text NOT NULL,
  photo_url  text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_request_idx ON messages (request_id, created_at);

CREATE TABLE notifications (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id),
  request_id bigint REFERENCES requests(id) ON DELETE CASCADE,
  text       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, read_at);

CREATE TABLE request_history (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id bigint NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  actor_id   bigint REFERENCES users(id),
  text       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX request_history_request_idx ON request_history (request_id, created_at);

-- Коды входа по телефону (хранится только хэш, число попыток ограничивается на сервере).
CREATE TABLE login_codes (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone      text NOT NULL,
  code_hash  text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts   integer NOT NULL DEFAULT 0,
  used       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_codes_phone_idx ON login_codes (phone, created_at DESC);

CREATE INDEX companies_manager_idx ON companies (manager_id);
