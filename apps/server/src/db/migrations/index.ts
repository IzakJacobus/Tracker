import m0001 from "./0001_initial.sql" with { type: "text" };
import m0002 from "./0002_item_tree.sql" with { type: "text" };
import m0003 from "./0003_remove_billing.sql" with { type: "text" };
import m0004 from "./0004_remove_capacity.sql" with { type: "text" };

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Every migration, in order. Files are embedded into the compiled binary via
 * text imports. Never edit a migration after it has been released — add a new one.
 */
export const migrations: Migration[] = [
  { version: 1, name: "initial", sql: m0001 },
  { version: 2, name: "item_tree", sql: m0002 },
  { version: 3, name: "remove_billing", sql: m0003 },
  { version: 4, name: "remove_capacity", sql: m0004 },
];
