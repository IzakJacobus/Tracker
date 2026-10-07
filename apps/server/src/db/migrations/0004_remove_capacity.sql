-- 0.3: people no longer have "expected hours per week", so reports have no capacity or
-- utilisation. The column goes; the automatic backup made before this upgrade still has it.

ALTER TABLE users DROP COLUMN weekly_capacity_minutes;

-- Organisations that approved per week keep their Monday-to-Sunday style weeks: the week ends the
-- day before the week starts. (New organisations hand in on Fridays.)
UPDATE organization
SET settings = json_set(
  settings,
  '$.approvalDay',
  (COALESCE(json_extract(settings, '$.weekStart'), 1) + 6) % 7
)
WHERE json_extract(settings, '$.approvalPeriod') = 'week';

-- Browsers drop their copies (which still carry the old field) and download again.
INSERT INTO app_meta (key, value) VALUES ('sync_epoch', '1')
ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT);
