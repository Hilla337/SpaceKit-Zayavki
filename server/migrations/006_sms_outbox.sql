-- SMS клиентам. Сообщение сначала кладётся в очередь в той же транзакции, что и событие (смена статуса и т.п.),
-- а отправляет его отдельный процесс с повторами. Так SMS не теряется при сбое и не уходит, если событие откатилось.
CREATE TYPE sms_status AS ENUM ('pending', 'sent', 'failed');

CREATE TABLE sms_outbox (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         bigint REFERENCES users(id) ON DELETE SET NULL,
  phone           text NOT NULL,
  text            text NOT NULL,
  request_id      bigint REFERENCES requests(id) ON DELETE SET NULL,
  status          sms_status NOT NULL DEFAULT 'pending',
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX sms_outbox_due_idx ON sms_outbox (next_attempt_at) WHERE status = 'pending';

-- Человек может отключить SMS у себя; уведомления в приложении при этом остаются.
ALTER TABLE users ADD COLUMN sms_enabled boolean NOT NULL DEFAULT true;
