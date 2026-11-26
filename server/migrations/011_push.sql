-- Push-уведомления в браузер (Web Push, бесплатно): подписки устройств и ключи VAPID сервера.
CREATE TABLE push_subscriptions (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- Настройки приложения, которые сервер создаёт сам (ключи VAPID генерируются при первом запуске).
CREATE TABLE app_settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- Какие уведомления уже отправлены push-ом. Старые помечаем отправленными, чтобы не прислать их задним числом.
ALTER TABLE notifications ADD COLUMN pushed_at timestamptz;
UPDATE notifications SET pushed_at = now();
CREATE INDEX notifications_push_idx ON notifications (id) WHERE pushed_at IS NULL;
