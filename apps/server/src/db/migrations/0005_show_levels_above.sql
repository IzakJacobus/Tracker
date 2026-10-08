-- 0.3.5: someone added to just an item now also receives the project and levels above it (names
-- only), so the item can be found in Log hours. Browsers download everything again once, to get them.
INSERT INTO app_meta (key, value) VALUES ('sync_epoch', '1')
ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT);
