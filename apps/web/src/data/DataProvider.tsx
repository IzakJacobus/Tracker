import type { Organization } from "@stint/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useMe } from "../app/session.tsx";
import { useToast } from "../ui/Toast.tsx";
import { createClock } from "./clock.ts";
import { dbName, StintDB } from "./db.ts";
import { EntryRepo } from "./entries.ts";
import { SyncEngine, type SyncStatus } from "./syncEngine.ts";

interface DataApi {
  db: StintDB;
  engine: SyncEngine;
  entries: EntryRepo;
  /** Run a server call, then pull so the local copy (and the UI) reflect it. */
  mutate<T>(fn: () => Promise<T>): Promise<T>;
}

const DataContext = createContext<DataApi | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const toast = useToast();
  const timezone = me.organization?.settings.timezone ?? "Africa/Johannesburg";
  const value = useMemo<DataApi>(() => {
    const db = new StintDB(dbName(me.serverId, me.user.id));
    const clock = createClock();
    const engine = new SyncEngine(db, clock);
    const entries = new EntryRepo({
      db,
      clock,
      userId: me.user.id,
      timezone,
      onChange: () => void engine.notifyLocalChange(),
    });
    return {
      db,
      engine,
      entries,
      async mutate(fn) {
        const out = await fn();
        await engine.syncNow();
        return out;
      },
    };
  }, [me.serverId, me.user.id, timezone]);

  useEffect(() => {
    value.engine.onRejected = (m) => toast.error(m);
  }, [value, toast]);

  useEffect(() => {
    value.engine.start();
    return () => {
      value.engine.stop();
      value.db.close();
    };
  }, [value]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataApi {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used inside <DataProvider>");
  return ctx;
}

export function useSyncStatus(): SyncStatus {
  const { engine } = useData();
  const [s, setS] = useState(engine.get());
  useEffect(() => engine.subscribe(setS), [engine]);
  return s;
}

/** Organisation settings from the local copy, falling back to the signed-in snapshot. */
export function useOrganization(): Organization | null {
  const me = useMe();
  const { db } = useData();
  const local = useLiveQuery(() => db.getMeta<Organization>("organization"), [db]);
  return local ?? me.organization;
}
