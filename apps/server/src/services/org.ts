import type { Database } from "bun:sqlite";
import { type Organization, OrgSettings } from "@stint/shared";

interface OrgRow {
  id: "org";
  name: string;
  settings: string;
  logo: string | null;
  updated_at: number;
  server_seq: number;
}

export function getOrgRow(db: Database): OrgRow | null {
  return db
    .query<OrgRow, []>(
      "SELECT id, name, settings, logo, updated_at, server_seq FROM organization WHERE id = 'org'",
    )
    .get();
}

export function getOrganization(db: Database): Organization | null {
  const r = getOrgRow(db);
  if (!r) return null;
  return {
    id: "org",
    name: r.name,
    settings: OrgSettings.parse(JSON.parse(r.settings)),
    logo: r.logo,
    updatedAt: r.updated_at,
    serverSeq: r.server_seq,
  };
}

/** Settings with defaults applied (works before setup, too). */
export function getOrgSettings(db: Database): OrgSettings {
  const r = getOrgRow(db);
  return OrgSettings.parse(r ? JSON.parse(r.settings) : {});
}

export function isSetupComplete(db: Database): boolean {
  return getOrgRow(db) !== null;
}
