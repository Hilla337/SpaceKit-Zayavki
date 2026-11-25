-- Четыре менеджера. Телефоны (для входа) добавим позже: phone остаётся NULL.
-- Какие клиенты за кем закреплены, будет задано отдельно (companies.manager_id).
INSERT INTO users (name, role, status)
SELECT v.name, 'manager'::user_role, 'approved'::account_status
FROM (VALUES
  ('Филипп Инилеев'),
  ('Татьяна Чех'),
  ('Максим Стребков'),
  ('Дмитрий Барбарасов')
) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM users u WHERE u.role = 'manager' AND u.name = v.name
);
