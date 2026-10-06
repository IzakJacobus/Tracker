-- 0.2: Stint tracks hours only. Billing is removed completely: rates, billable flags, money
-- budgets, rate snapshots, currency, rounding and the related settings. (The automatic backup
-- made before this upgrade still has them.)

ALTER TABLE users DROP COLUMN rate;
ALTER TABLE clients DROP COLUMN rate;
ALTER TABLE projects DROP COLUMN billable_default;
ALTER TABLE projects DROP COLUMN rate;
ALTER TABLE projects DROP COLUMN budget_amount;
ALTER TABLE project_members DROP COLUMN rate;
ALTER TABLE tasks DROP COLUMN rate;
ALTER TABLE tasks DROP COLUMN billable;
ALTER TABLE time_entries DROP COLUMN billable;
ALTER TABLE time_entries DROP COLUMN rate_snapshot;
ALTER TABLE time_entries DROP COLUMN currency;

UPDATE organization
SET settings = json_remove(
  settings,
  '$.currency',
  '$.defaultRate',
  '$.rounding',
  '$.membersSeeOwnRates',
  '$.idleMinutes',
  '$.pdf.vatNumber'
);

-- Browsers drop their copies (which still carry the old fields) and download again.
INSERT INTO app_meta (key, value) VALUES ('sync_epoch', '1')
ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT);
