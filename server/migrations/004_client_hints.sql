-- Подсказки «какого клиента ведёт какой менеджер». Нужны, пока компании не заведены:
-- когда компания появляется (регистрация или синхронизация с МоимСкладом), её менеджер находится по названию.
-- Автоматически назначается только при точном совпадении нормализованного названия.
CREATE TABLE client_manager_hints (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hint       text NOT NULL,
  hint_norm  text NOT NULL UNIQUE,
  manager_id bigint NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Проверка роли менеджера, как и для companies.manager_id.
CREATE FUNCTION check_hint_manager() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.manager_id AND role = 'manager') THEN
    RAISE EXCEPTION 'client_manager_hints.manager_id must reference a user with role manager';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER client_manager_hints_check
  BEFORE INSERT OR UPDATE OF manager_id ON client_manager_hints
  FOR EACH ROW EXECUTE FUNCTION check_hint_manager();
