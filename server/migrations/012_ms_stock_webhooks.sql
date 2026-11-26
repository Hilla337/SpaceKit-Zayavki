-- Остатки товаров на складе (обновляются из МойСклад) и обратная связь из МойСклад (вебхуки).
ALTER TABLE catalog ADD COLUMN stock numeric(14, 3), ADD COLUMN stock_at timestamptz;
-- Последний известный статус заказа в МойСклад: чтобы писать в историю только настоящие смены статуса.
ALTER TABLE requests ADD COLUMN ms_order_state text;
-- Одна отгрузка МойСклад — одна отгрузка в приложении (вебхук может прийти повторно).
CREATE UNIQUE INDEX shipments_ms_shipment_uq ON shipments (ms_shipment_id) WHERE ms_shipment_id IS NOT NULL;
