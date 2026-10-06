-- 0.2: tasks become items in the project tree.
--
-- Under a project there is now one tree of items, nested as deep as a firm likes. Each item can
-- carry a free "kind" label ("Phase", "Task", ...) chosen by the firm. Every task becomes a child
-- item of its project (same id, name, order and done state), and time entries and favourites that
-- pointed at a task now point at that item. The tasks table stays, emptied by soft delete.
-- Every changed row gets a fresh server_seq, and the global sync epoch is bumped so every
-- browser re-downloads its data.

ALTER TABLE projects ADD COLUMN kind TEXT;

INSERT INTO projects (
  id, client_id, parent_id, name, code, color, billable_default, rate,
  budget_minutes, budget_amount, visibility, notes, sort_order, archived_at,
  created_at, updated_at, deleted_at, server_seq, field_clock, kind
)
SELECT
  t.id, p.client_id, t.project_id, t.name, NULL, p.color, COALESCE(t.billable, p.billable_default), t.rate,
  NULL, NULL, p.visibility, '', t.sort_order, t.archived_at,
  t.created_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000, t.deleted_at,
  (SELECT seq FROM sync_counter WHERE id = 1) + ROW_NUMBER() OVER (ORDER BY t.id), '{}', 'Task'
FROM tasks t
JOIN projects p ON p.id = t.project_id;

UPDATE sync_counter SET seq = MAX(seq, COALESCE((SELECT MAX(server_seq) FROM projects), 0)) WHERE id = 1;

UPDATE time_entries
SET project_id = task_id,
    task_id = NULL,
    server_seq = (SELECT seq FROM sync_counter WHERE id = 1) + r.n
FROM (SELECT id AS eid, ROW_NUMBER() OVER (ORDER BY id) AS n FROM time_entries WHERE task_id IS NOT NULL) AS r
WHERE time_entries.id = r.eid;

UPDATE sync_counter SET seq = MAX(seq, COALESCE((SELECT MAX(server_seq) FROM time_entries), 0)) WHERE id = 1;

UPDATE favorites
SET project_id = task_id,
    task_id = NULL,
    server_seq = (SELECT seq FROM sync_counter WHERE id = 1) + r.n
FROM (SELECT id AS fid, ROW_NUMBER() OVER (ORDER BY id) AS n FROM favorites WHERE task_id IS NOT NULL) AS r
WHERE favorites.id = r.fid;

UPDATE sync_counter SET seq = MAX(seq, COALESCE((SELECT MAX(server_seq) FROM favorites), 0)) WHERE id = 1;

UPDATE tasks
SET deleted_at = COALESCE(deleted_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    server_seq = (SELECT seq FROM sync_counter WHERE id = 1) + r.n
FROM (SELECT id AS tid, ROW_NUMBER() OVER (ORDER BY id) AS n FROM tasks) AS r
WHERE tasks.id = r.tid;

UPDATE sync_counter SET seq = MAX(seq, COALESCE((SELECT MAX(server_seq) FROM tasks), 0)) WHERE id = 1;

INSERT INTO app_meta (key, value) VALUES ('sync_epoch', '1')
ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT);
