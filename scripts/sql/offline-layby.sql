-- Offline layby: nullable layby plan FKs + link to offline_sales + sale type
-- Run manually in production, or use DB_SYNC_ALTER=true with updated Sequelize models.

ALTER TABLE layby_plans
  MODIFY COLUMN orderId INT NULL,
  MODIFY COLUMN userId INT NULL,
  ADD COLUMN offlineSaleId INT NULL,
  ADD CONSTRAINT fk_layby_plans_offline_sale
    FOREIGN KEY (offlineSaleId) REFERENCES offline_sales(id) ON DELETE SET NULL;

CREATE INDEX idx_layby_plans_offline_sale_id ON layby_plans (offlineSaleId);

ALTER TABLE offline_sales
  ADD COLUMN saleType ENUM('full', 'layby') NOT NULL DEFAULT 'full';
