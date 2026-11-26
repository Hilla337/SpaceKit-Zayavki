-- Клиенты, которые берут счёт с НДС: им заказ и отгрузки в МойСклад оформляются с НДС 5% (внутри цены).
-- Флаг стоит у компании; новая заявка берёт его от компании, менеджер может поменять в заявке до создания заказа.
ALTER TABLE companies ADD COLUMN vat_invoice boolean NOT NULL DEFAULT false;
ALTER TABLE requests ADD COLUMN vat_invoice boolean NOT NULL DEFAULT false;
