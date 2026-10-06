import {
  BarChart3,
  Building2,
  CheckSquare,
  FolderTree,
  Keyboard,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Timer,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { getThemePref, setThemePref } from "../lib/theme.ts";
import { useEntryDialog } from "../tracking/EntryDialogHost.tsx";
import { usePickerItems } from "../tracking/ProjectPicker.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { useMe } from "./session.tsx";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && Boolean(t.closest("input, textarea, select, [contenteditable=true]"));

/** Global keyboard shortcuts + the ⌘K / Ctrl+K command palette. */
export function CommandLayer() {
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const dialog = useEntryDialog();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector("[role=dialog]"))
        return;
      if (e.key === "/") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "n" || e.key === "N" || e.key === "l" || e.key === "L") {
        e.preventDefault();
        dialog.open({});
      } else if (e.key === "?") {
        e.preventDefault();
        setHelp(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);

  return (
    <>
      {open && <Palette onClose={() => setOpen(false)} onHelp={() => setHelp(true)} />}
      <ShortcutHelp open={help} onClose={() => setHelp(false)} />
    </>
  );
}

function Palette({ onClose, onHelp }: { onClose: () => void; onHelp: () => void }) {
  const me = useMe();
  const navigate = useNavigate();
  const dialog = useEntryDialog();
  const { items } = usePickerItems();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const role = me.user.role;

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to);
    const base: (Command | false)[] = [
      {
        id: "add",
        label: "Log hours",
        icon: <Plus />,
        hint: "N",
        keywords: "add time",
        run: () => dialog.open({}),
      },
      { id: "g-track", label: "Go to Track", icon: <Timer />, run: go("/") },
      {
        id: "g-week",
        label: "Open the weekly timesheet",
        icon: <Timer />,
        keywords: "grid week",
        run: go("/?view=week"),
      },
      { id: "g-reports", label: "Go to Reports", icon: <BarChart3 />, run: go("/reports") },
      role !== "member" && {
        id: "g-approvals",
        label: "Go to Approvals",
        icon: <CheckSquare />,
        run: go("/approvals"),
      },
      { id: "g-projects", label: "Go to Projects", icon: <FolderTree />, run: go("/projects") },
      role === "admin" && {
        id: "g-clients",
        label: "Go to Clients",
        icon: <Building2 />,
        run: go("/clients"),
      },
      role !== "member" && { id: "g-team", label: "Go to Team", icon: <Users />, run: go("/team") },
      role === "admin" && {
        id: "g-settings",
        label: "Go to Settings",
        icon: <Settings />,
        run: go("/settings"),
      },
      {
        id: "theme",
        label: getThemePref() === "dark" ? "Switch to light mode" : "Switch to dark mode",
        icon: getThemePref() === "dark" ? <Sun /> : <Moon />,
        keywords: "theme appearance",
        run: () => setThemePref(getThemePref() === "dark" ? "light" : "dark"),
      },
      { id: "help", label: "Keyboard shortcuts", icon: <Keyboard />, hint: "?", run: onHelp },
    ];
    return base.filter((c): c is Command => Boolean(c));
  }, [role, navigate, dialog, onHelp]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    const words = query.split(/\s+/).filter(Boolean);
    const match = (s: string) => words.every((w) => s.includes(w));
    const cmds = commands.filter((c) => !query || match(`${c.label} ${c.keywords ?? ""}`.toLowerCase()));
    const projects: Command[] = query
      ? items
          .filter((i) => match(i.search))
          .slice(0, 8)
          .map((i) => ({
            id: `p-${i.key}`,
            label: `Log hours: ${i.code ? `${i.code} ` : ""}${i.projectLabel}`,
            hint: i.clientName,
            icon: <span className="dot" style={{ background: i.color }} />,
            run: () => dialog.open({ combo: { projectId: i.projectId, taskId: null } }),
          }))
      : [];
    return [...cmds, ...projects];
  }, [q, commands, items, dialog]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click closes; Escape also closes
    <div
      className="dialog-backdrop palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="input-affix palette__search">
          <Search />
          <input
            className="input"
            // biome-ignore lint/a11y/noAutofocus: the palette exists to be typed into
            autoFocus
            placeholder="Type a command, or a project to log hours on…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `cmd-${results[active]!.id}` : undefined}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(results[active]);
              }
            }}
          />
        </div>
        <div className="palette__list" id="palette-list" role="listbox" ref={listRef} aria-label="Commands">
          {results.length === 0 && (
            <div className="subtle" style={{ padding: 16 }}>
              No matches.
            </div>
          )}
          {results.map((c, i) => (
            <div
              key={c.id}
              id={`cmd-${c.id}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              data-index={i}
              data-active={i === active}
              className="menu-item"
              onMouseEnter={() => setActive(i)}
              onClick={() => run(c)}
              onKeyDown={() => {}}
            >
              {c.icon}
              <span className="grow truncate">{c.label}</span>
              {c.hint &&
                (c.hint.length <= 2 ? (
                  <kbd>{c.hint}</kbd>
                ) : (
                  <span className="subtle" style={{ fontSize: 12 }}>
                    {c.hint}
                  </span>
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const SHORTCUTS: [string, string][] = [
  ["Ctrl K  or  /", "Open the command palette"],
  ["N", "Log hours"],
  ["← →", "Previous / next week (Track)"],
  ["T", "Jump to today (Track)"],
  ["1  2", "List or week grid (Track)"],
  ["Enter / arrows", "Move between cells in the weekly grid"],
  ["?", "Show this list"],
];

function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts">
      <table className="table">
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k}>
              <td style={{ width: 170 }}>
                {k.split(/\s{2}/).map((part) => (
                  <kbd key={part} style={{ marginRight: 4 }}>
                    {part}
                  </kbd>
                ))}
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
