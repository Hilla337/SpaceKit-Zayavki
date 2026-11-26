-- Вход по телефону и паролю вместо платных кодов из звонка/SMS.
-- Пароль хранится только как хэш scrypt. После серии неудачных попыток вход на номер временно блокируется.
-- Таблица login_codes остаётся для одноразовых кодов сброса пароля, которые выдаёт менеджер или админ.
ALTER TABLE users
  ADD COLUMN password_hash text,
  ADD COLUMN failed_logins integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until  timestamptz;
ALTER TABLE login_codes ADD COLUMN issued_by bigint REFERENCES users(id);
