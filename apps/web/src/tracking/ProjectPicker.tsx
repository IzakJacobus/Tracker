import { canTrackOnProject } from "@stint/shared";
import { ChevronDown, FolderOpen, Search, Star } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useMe } from "../app/session.tsx";
import { accessFromLocal } from "../data/access.ts";
import { useData } from "../data/DataProvider.tsx";
import { useMembers, useProjectOptions, useProjects, useTasks } from "../data/hooks.ts";
import { Dot } from "../ui/misc.tsx";
import { Popover } from "../ui/Popover.tsx";
import { type Combo, useFavorites, useRecentCombos } from "./hooks.ts";

export interface PickerItem {
  key: string;
  projectId: string;
  taskId: string | null;
  projectLabel: string;
  taskName: string | null;
  clientName: string;
  color: string;
  search: string;
}

/** Every project (and task) the signed-in person can track time on. */
export function usePickerItems(): { items: PickerItem[]; byKey: Map<string, PickerItem> } {
  const me = useMe();
  const options = useProjectOptions();
  const projects = useProjects();
  const tasks = useTasks();
  const members = useMembers();
  return useMemo(() => {
    const access = accessFromLocal(projects, members, me);
    const actor = { id: me.user.id, role: me.user.role };
    const items: PickerItem[] = [];
    for (const o of options) {
      if (o.archived || !canTrackOnProject(actor, o.project.id, access)) continue;
      const base = {
        projectId: o.project.id,
        projectLabel: o.label,
        clientName: o.client?.name ?? "",
        color: o.project.color,
      };
      items.push({
        ...base,
        key: `${o.project.id}|`,
        taskId: null,
        taskName: null,
        search: `${o.label} ${o.client?.name ?? ""} ${o.project.code ?? ""}`.toLowerCase(),
      });
      for (const t of tasks
        .filter((t) => t.projectId === o.project.id && !t.archivedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder)) {
        items.push({
          ...base,
          key: `${o.project.id}|${t.id}`,
          taskId: t.id,
          taskName: t.name,
          search: `${o.label} ${t.name} ${o.client?.name ?? ""}`.toLowerCase(),
        });
      }
    }
    return { items, byKey: new Map(items.map((i) => [i.key, i])) };
  }, [options, projects, tasks, members, me]);
}

export const comboKey = (c: Combo) => `${c.projectId}|${c.taskId ?? ""}`;

export function ComboLabel({ item, compact }: { item: PickerItem | undefined; compact?: boolean }) {
  if (!item) return <span className="subtle">No project</span>;
  return (
    <span className="combo-label">
      <Dot color={item.color} />
      <span className="truncate">
        <span style={{ color: item.color, fontWeight: 600 }} className="combo-label__project">
          {item.projectLabel}
        </span>
        {item.taskName && <span className="muted"> · {item.taskName}</span>}
        {!compact && item.clientName && <span className="subtle"> — {item.clientName}</span>}
      </span>
    </span>
  );
}

interface ProjectPickerProps {
  value: Combo | null;
  onChange: (c: Combo) => void;
  /** Rendered trigger; defaults to a chip with the current project. */
  trigger?: (props: { open: () => void; label: ReactNode }) => ReactNode;
  placement?: "bottom-start" | "top-start" | "bottom-end" | "top-end";
  autoOpen?: boolean;
  id?: string;
}

export function ProjectPicker({
  value,
  onChange,
  placement = "bottom-start",
  autoOpen,
  id,
}: ProjectPickerProps) {
  const { items, byKey } = usePickerItems();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(Boolean(autoOpen));
  const current = value ? byKey.get(comboKey(value)) : undefined;
  return (
    <>
      <button
        ref={anchor}
        id={id}
        type="button"
        className="picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {current ? (
          <ComboLabel item={current} compact />
        ) : (
          <span className="row subtle">
            <FolderOpen /> Choose a project
          </span>
        )}
        <ChevronDown className="picker-trigger__chevron" />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        placement={placement}
        width={420}
        label="Choose a project"
      >
        <PickerList
          items={items}
          byKey={byKey}
          selected={value ? comboKey(value) : null}
          onPick={(c) => {
            onChange(c);
            setOpen(false);
            anchor.current?.focus();
          }}
        />
      </Popover>
    </>
  );
}

export function PickerList({
  items,
  byKey,
  selected,
  onPick,
}: {
  items: PickerItem[];
  byKey: Map<string, PickerItem>;
  selected: string | null;
  onPick: (c: Combo) => void;
}) {
  const { entries } = useData();
  const favorites = useFavorites();
  const recent = useRecentCombos();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const favKeys = useMemo(() => new Set(favorites.map(comboKey)), [favorites]);

  const sections = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (query) {
      const words = query.split(/\s+/);
      return [
        {
          title: "Results",
          items: items.filter((i) => words.every((w) => i.search.includes(w))).slice(0, 80),
        },
      ];
    }
    const fav = favorites.map((c) => byKey.get(comboKey(c))).filter((x): x is PickerItem => Boolean(x));
    const rec = recent
      .map((c) => byKey.get(comboKey(c)))
      .filter((x): x is PickerItem => Boolean(x) && !favKeys.has(x!.key))
      .slice(0, 5);
    const byClient = new Map<string, PickerItem[]>();
    for (const i of items) {
      const list = byClient.get(i.clientName) ?? [];
      list.push(i);
      byClient.set(i.clientName, list);
    }
    return [
      ...(fav.length ? [{ title: "Favourites", items: fav }] : []),
      ...(rec.length ? [{ title: "Recent", items: rec }] : []),
      ...[...byClient.entries()].map(([title, list]) => ({ title, items: list })),
    ];
  }, [q, items, favorites, favKeys, recent, byKey]);

  const flat = sections.flatMap((s) => s.items);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let index = -1;
  return (
    <div className="picker">
      <div className="input-affix picker__search">
        <Search />
        <input
          className="input"
          // biome-ignore lint/a11y/noAutofocus: the picker opens for typing
          autoFocus
          placeholder="Search projects and tasks"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          aria-label="Search projects and tasks"
          aria-controls="picker-list"
          aria-activedescendant={flat[active] ? `pick-${flat[active]!.key}` : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(flat.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const it = flat[active];
              if (it) onPick({ projectId: it.projectId, taskId: it.taskId });
            }
          }}
        />
      </div>
      <div className="picker__list" id="picker-list" role="listbox" ref={listRef} aria-label="Projects">
        {flat.length === 0 && (
          <div className="subtle" style={{ padding: 12, fontSize: "var(--text-sm)" }}>
            {items.length === 0
              ? "You aren't on any projects yet. Ask a manager to add you."
              : "Nothing matches."}
          </div>
        )}
        {sections.map((s) =>
          s.items.length === 0 ? null : (
            <div key={s.title}>
              <div className="menu-group">{s.title}</div>
              {s.items.map((it) => {
                index++;
                const i = index;
                const fav = favKeys.has(it.key);
                return (
                  <div
                    key={`${s.title}-${it.key}`}
                    id={`pick-${it.key}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={selected === it.key}
                    data-index={i}
                    data-active={i === active}
                    className="menu-item picker__item"
                    style={{ paddingLeft: it.taskId ? 30 : 8 }}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => onPick({ projectId: it.projectId, taskId: it.taskId })}
                    onKeyDown={() => {}}
                  >
                    {it.taskId ? (
                      <span className="grow truncate">{it.taskName}</span>
                    ) : (
                      <span className="grow truncate row" style={{ gap: 8 }}>
                        <span className="dot" style={{ background: it.color }} />
                        <span className="truncate">{it.projectLabel}</span>
                      </span>
                    )}
                    <button
                      type="button"
                      className="picker__star"
                      data-on={fav || undefined}
                      aria-label={fav ? "Remove from favourites" : "Add to favourites"}
                      aria-pressed={fav}
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        void entries.toggleFavorite(it.projectId, it.taskId);
                      }}
                    >
                      <Star />
                    </button>
                  </div>
                );
              })}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
