-- Run once against MySQL: dedupe admin payment notification emails (poll vs webhook).
-- This project uses underscored: false (see src/config/mysql.js) — column names are camelCase.
ALTER TABLE payments
  ADD COLUMN notifiedAt DATETIME NULL
  COMMENT 'Set when admin payment email sent';
