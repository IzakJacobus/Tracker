import { canTrackOnProject } from "@stint/shared";
import { ChevronDown, ChevronLeft, ChevronRight, FolderOpen, Search, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMe } from "../app/session.tsx";
import { accessFromLocal } from "../data/access.ts";
import { useData, useSyncStatus } from "../data/DataProvider.tsx";
import { useMembers, useProjectOptions, useProjects } from "../data/hooks.ts";
import { Dot } from "../ui/misc.tsx";
import { Popover } from "../ui/Popover.tsx";
import { type Combo, useFavorites, useRecentCombos } from "./hooks.ts";

/** One item of the project tree (a project or anything under it), as the pickers show it. */
export interface PickerItem {
  key: string;
  projectId: string;
  /** Always null: tasks are items in the tree since 0.2. Kept so Combo stays one shape. */
  taskId: null;
  name: string;
  /** Full path, e.g. "Bridge upgrade › Design › WP1". */
  projectLabel: string;
  /** The top-level project's code, shown in front of the path. */
  code: string | null;
  kind: string | null;
  clientName: string;
  color: string;
  search: string;
  /** No sub-items, not done, not under a done item, and the person may track on it. */
  loggable: boolean;
  /** Sub-items the person can reach (directly loggable or leading to something loggable). */
  childIds: string[];
  parentId: string | null;
  /** Shown in the "drill down" view (it is loggable, or something under it is). */
  reachable: boolean;
}

export interface PickerData {
  /** Loggable items only: what people can choose. */
  items: PickerItem[];
  /** Every item, for labelling existing entries (which may be on a parent or a done item). */
  byKey: Map<string, PickerItem>;
  byId: Map<string, PickerItem>;
  /** Top-level projects that lead to something loggable, grouped by client. */
  roots: { clientName: string; items: PickerItem[] }[];
}

export const comboKey = (c: Combo) => `${c.projectId}|${c.taskId ?? ""}`;

/** The project tree as the signed-in person can log hours on it. */
export function usePickerItems(): PickerData {
  const me = useMe();
  const options = useProjectOptions();
  const projects = useProjects();
  const members = useMembers();
  return useMemo(() => {
    const access = accessFromLocal(projects, members, me);
    const actor = { id: me.user.id, role: me.user.role };
    const byId = new Map<string, PickerItem>();
    const live = options.filter((o) => !o.project.deletedAt);
    const liveById = new Map(live.map((o) => [o.project.id, o]));
    const childrenOf = new Map<string, string[]>();
    for (const o of live) {
      if (!o.project.parentId) continue;
      const list = childrenOf.get(o.project.parentId) ?? [];
      list.push(o.project.id);
      childrenOf.set(o.project.parentId, list);
    }
    for (const o of live) {
      const p = o.project;
      const rootCode = (() => {
        let cur = p;
        while (cur.parentId) {
          const parent = liveById.get(cur.parentId)?.project;
          if (!parent) break;
          cur = parent;
        }
        return cur.code;
      })();
      const hasChildren = (childrenOf.get(p.id) ?? []).length > 0;
      byId.set(p.id, {
        key: `${p.id}|`,
        projectId: p.id,
        taskId: null,
        name: p.name,
        projectLabel: o.label,
        code: rootCode,
        kind: p.kind ?? null,
        clientName: o.client?.name ?? "",
        color: p.color,
        search:
          `${o.label} ${o.client?.name ?? ""} ${rootCode ?? ""} ${p.code ?? ""} ${p.kind ?? ""}`.toLowerCase(),
        loggable: !o.archived && !hasChildren && canTrackOnProject(actor, p.id, access),
        childIds: [],
        parentId: p.parentId,
        reachable: false,
      });
    }
    // An item is reachable when it is loggable or leads to something loggable (done branches drop out).
    const reach = (id: string): boolean => {
      const it = byId.get(id)!;
      const kids = (childrenOf.get(id) ?? []).filter((k) => {
        return !liveById.get(k)?.archived && reach(k);
      });
      it.childIds = kids;
      it.reachable = it.loggable || kids.length > 0;
      return it.reachable;
    };
    const roots = live.filter((o) => !o.project.parentId && !o.archived);
    for (const o of roots) reach(o.project.id);
    const order = new Map(live.map((o, i) => [o.project.id, i]));
    const sortIds = (ids: string[]) => ids.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    for (const it of byId.values()) sortIds(it.childIds);
    const byClient = new Map<string, PickerItem[]>();
    for (const o of roots) {
      const it = byId.get(o.project.id)!;
      if (!it.reachable) continue;
      const list = byClient.get(it.clientName) ?? [];
      list.push(it);
      byClient.set(it.clientName, list);
    }
    const all = [...byId.values()];
    return {
      items: all.filter((i) => i.loggable && i.reachable),
      byKey: new Map(all.map((i) => [i.key, i])),
      byId,
      roots: [...byClient.entries()].map(([clientName, items]) => ({ clientName, items })),
    };
  }, [options, projects, members, me]);
}

export function ComboLabel({ item, compact }: { item: PickerItem | undefined; compact?: boolean }) {
  if (!item) return <span className="subtle">No project</span>;
  return (
    <span className="combo-label">
      <Dot color={item.color} />
      <span className="truncate">
        {item.code && <span className="mono subtle combo-label__code">{item.code} </span>}
        <span style={{ color: item.color, fontWeight: 600 }} className="combo-label__project">
          {item.projectLabel}
        </span>
        {!compact && item.clientName && <span className="subtle"> — {item.clientName}</span>}
      </span>
    </span>
  );
}

interface ProjectPickerProps {
  value: Combo | null;
  onChange: (c: Combo) => void;
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
  const data = usePickerItems();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(Boolean(autoOpen));
  const current = value ? data.byKey.get(comboKey(value)) : undefined;
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
            <FolderOpen /> Choose what you worked on
          </span>
        )}
        <ChevronDown className="picker-trigger__chevron" />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        placement={placement}
        width={440}
        label="Choose what you worked on"
      >
        <PickerList
          data={data}
          selected={value ? comboKey(value) : null}
          start={current?.parentId ?? null}
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

interface Row {
  item: PickerItem;
  /** Drill into it instead of picking it. */
  drill: boolean;
  /** Show the whole path (search, favourites) rather than just the name (drill-down). */
  full: boolean;
}

/**
 * Choose an item: drill down from the project, level by level, to the item you worked on
 * (only items with nothing under them take hours), or search all of them by name, path or code.
 */
export function PickerList({
  data,
  selected,
  onPick,
  start = null,
}: {
  data: PickerData;
  selected: string | null;
  onPick: (c: Combo) => void;
  /** Open inside this item (e.g. the parent of the current choice). */
  start?: string | null;
}) {
  const { entries } = useData();
  const sync = useSyncStatus();
  const favorites = useFavorites();
  const recent = useRecentCombos();
  const [q, setQ] = useState("");
  const [at, setAt] = useState<string | null>(start && data.byId.get(start)?.reachable ? start : null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const favKeys = useMemo(() => new Set(favorites.map(comboKey)), [favorites]);
  const here = at ? data.byId.get(at) : undefined;

  const sections = useMemo((): { title: string; rows: Row[] }[] => {
    const query = q.trim().toLowerCase();
    const pickable = (k: string) => {
      const it = data.byKey.get(k);
      return it?.loggable && it.reachable ? it : undefined;
    };
    if (query) {
      const words = query.split(/\s+/);
      const items = data.items.filter((i) => words.every((w) => i.search.includes(w))).slice(0, 80);
      return [{ title: "Results", rows: items.map((item) => ({ item, drill: false, full: true })) }];
    }
    if (here) {
      return [
        {
          title: here.projectLabel,
          rows: here.childIds
            .map((id) => data.byId.get(id)!)
            .map((item) => ({ item, drill: !item.loggable, full: false })),
        },
      ];
    }
    const fav = favorites.map((c) => pickable(comboKey(c))).filter((x): x is PickerItem => Boolean(x));
    const rec = recent
      .map((c) => pickable(comboKey(c)))
      .filter((x): x is PickerItem => Boolean(x) && !favKeys.has(x!.key))
      .slice(0, 5);
    return [
      ...(fav.length
        ? [{ title: "Favourites", rows: fav.map((item) => ({ item, drill: false, full: true })) }]
        : []),
      ...(rec.length
        ? [{ title: "Recent", rows: rec.map((item) => ({ item, drill: false, full: true })) }]
        : []),
      ...data.roots.map((g) => ({
        title: g.clientName,
        rows: g.items.map((item) => ({ item, drill: !item.loggable, full: false })),
      })),
    ];
  }, [q, data, here, favorites, favKeys, recent]);

  const flat = sections.flatMap((s) => s.rows);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (r: Row | undefined) => {
    if (!r) return;
    if (r.drill) {
      setAt(r.item.projectId);
      setActive(0);
      return;
    }
    onPick({ projectId: r.item.projectId, taskId: null });
  };
  const back = () => {
    setAt(here?.parentId && data.byId.get(here.parentId)?.reachable ? here.parentId : null);
    setActive(0);
  };

  let index = -1;
  return (
    <div className="picker">
      <div className="input-affix picker__search">
        <Search />
        <input
          className="input"
          // biome-ignore lint/a11y/noAutofocus: the picker opens for typing
          autoFocus
          placeholder="Search projects, items and codes"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          aria-label="Search projects, items and codes"
          aria-controls="picker-list"
          aria-activedescendant={flat[active] ? `pick-${flat[active]!.item.key}` : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(flat.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "ArrowRight" && !q && flat[active]?.drill) {
              e.preventDefault();
              choose(flat[active]);
            } else if ((e.key === "ArrowLeft" || (e.key === "Backspace" && !q)) && !q && here) {
              e.preventDefault();
              back();
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(flat[active]);
            }
          }}
        />
      </div>
      {here && !q && (
        <button type="button" className="menu-item picker__back" onClick={back}>
          <ChevronLeft /> <span className="truncate">{here.parentId ? "Back" : "All projects"}</span>
        </button>
      )}
      <div
        className="picker__list"
        id="picker-list"
        role="listbox"
        ref={listRef}
        aria-label="Projects and items"
      >
        {flat.length === 0 && (
          <div className="subtle" style={{ padding: 12, fontSize: "var(--text-sm)" }}>
            {data.items.length > 0
              ? "Nothing matches."
              : sync.lastSyncedAt === null
                ? "Loading your projects…"
                : "You aren't on any projects yet. Ask a manager to add you."}
          </div>
        )}
        {sections.map((s) =>
          s.rows.length === 0 ? null : (
            <div key={s.title}>
              <div className="menu-group">{s.title}</div>
              {s.rows.map((r) => {
                index++;
                const i = index;
                const it = r.item;
                const fav = favKeys.has(it.key);
                return (
                  <div
                    key={`${s.title}-${it.key}`}
                    id={`pick-${it.key}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={selected === it.key}
                    aria-label={r.drill ? `${it.name}, ${it.childIds.length} items inside` : undefined}
                    data-index={i}
                    data-active={i === active}
                    className="menu-item picker__item"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(r)}
                    onKeyDown={() => {}}
                  >
                    <span className="grow truncate row" style={{ gap: 8 }}>
                      <span className="dot" style={{ background: it.color }} />
                      {!it.parentId && it.code && <span className="mono subtle">{it.code}</span>}
                      <span className="truncate">{r.full ? it.projectLabel : it.name}</span>
                      {it.kind && !r.full && <span className="subtle picker__kind">{it.kind}</span>}
                      {r.full && it.clientName && <span className="subtle truncate"> — {it.clientName}</span>}
                    </span>
                    {r.drill ? (
                      <span className="subtle row" style={{ gap: 2 }}>
                        {it.childIds.length}
                        <span className="sr-only"> items inside</span> <ChevronRight />
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="picker__star"
                        data-on={fav || undefined}
                        aria-label={fav ? "Remove from favourites" : "Add to favourites"}
                        aria-pressed={fav}
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          void entries.toggleFavorite(it.projectId, null);
                        }}
                      >
                        <Star />
                      </button>
                    )}
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
