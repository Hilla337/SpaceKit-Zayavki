-- Чат как в мессенджере: вложения (фото, видео, голосовые, файлы), ответы, правка и удаление, реакции, прочитано.
-- Вложения хранятся в базе (bytea, до 25 МБ): так их не надо отдельно бэкапить и защищать; позже можно вынести в объектное хранилище.
CREATE TABLE attachments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id  bigint NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  uploader_id bigint NOT NULL REFERENCES users(id),
  kind        text NOT NULL CHECK (kind IN ('photo', 'video', 'voice', 'file')),
  mime        text NOT NULL,
  name        text NOT NULL,
  size        integer NOT NULL,
  duration_ms integer,
  data        bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_request_idx ON attachments (request_id);

ALTER TABLE messages
  ADD COLUMN attachment_id bigint REFERENCES attachments(id) ON DELETE SET NULL,
  ADD COLUMN reply_to_id   bigint REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN edited_at     timestamptz,
  ADD COLUMN deleted_at    timestamptz;

-- Одна реакция от человека на сообщение (как в Telegram).
CREATE TABLE message_reactions (
  message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES users(id),
  emoji      text NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

-- До какого сообщения человек дочитал переписку по заявке (для галочек «прочитано»).
CREATE TABLE chat_reads (
  request_id   bigint NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id      bigint NOT NULL REFERENCES users(id),
  last_read_id bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (request_id, user_id)
);
