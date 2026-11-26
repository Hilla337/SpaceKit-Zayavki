-- Запись в МойСклад: связь компании с контрагентом, объекта с проектом, заявки с заказом покупателя.
-- Контрагента у компании указывает менеджер (или команда ms:link-companies по точному названию).
ALTER TABLE companies ADD COLUMN ms_counterparty_id text UNIQUE;
ALTER TABLE objects ADD COLUMN ms_project_id text;
ALTER TABLE requests ADD COLUMN ms_order_name text;
