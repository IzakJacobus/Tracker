import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { EntryDialog, type EntryDialogProps } from "./EntryDialog.tsx";

type OpenProps = Omit<EntryDialogProps, "onClose">;

const Ctx = createContext<{ open: (p?: OpenProps) => void } | null>(null);

/** Lets any part of the app (dock, shortcuts, palette, calendar) open the entry dialog. */
export function EntryDialogHost({ children }: { children: ReactNode }) {
  const [props, setProps] = useState<OpenProps | null>(null);
  const open = useCallback((p: OpenProps = {}) => setProps(p), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {props && <EntryDialog key={props.entry?.id ?? "new"} {...props} onClose={() => setProps(null)} />}
    </Ctx.Provider>
  );
}

export function useEntryDialog() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useEntryDialog outside EntryDialogHost");
  return c;
}
