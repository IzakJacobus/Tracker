import type { BillableFilter, ReportData, ReportFilter } from "@stint/shared";
import { useMe } from "../../app/session.tsx";
import { useSettings } from "../../tracking/hooks.ts";
import { Field, Input, Select } from "../../ui/Field.tsx";
import { type Preset, presetRange, useToday } from "./data.ts";

export interface FilterState {
  preset: Preset;
  from: string;
  to: string;
  clientId: string;
  projectId: string;
  userId: string;
  tagId: string;
  billable: BillableFilter;
}

export function initialFilter(today: string, weekStart: number, preset: Preset = "this-month"): FilterState {
  return {
    preset,
    ...presetRange(preset, today, weekStart),
    clientId: "",
    projectId: "",
    userId: "",
    tagId: "",
    billable: "all",
  };
}

export function toReportFilter(f: FilterState): ReportFilter {
  return {
    from: f.from,
    to: f.to,
    clientIds: f.clientId ? [f.clientId] : undefined,
    projectIds: f.projectId ? [f.projectId] : undefined,
    userIds: f.userId ? [f.userId] : undefined,
    tagIds: f.tagId ? [f.tagId] : undefined,
    billable: f.billable,
  };
}

const PRESETS: [Preset, string][] = [
  ["this-week", "This week"],
  ["last-week", "Last week"],
  ["this-month", "This month"],
  ["last-month", "Last month"],
  ["this-quarter", "This quarter"],
  ["this-year", "This year"],
  ["last-year", "Last year"],
  ["custom", "Custom…"],
];

/** One row of filters above the report: date range first, then dimensions. */
export function Filters({
  value,
  onChange,
  data,
  show = { client: true, project: true, user: true, tag: true, billable: true },
}: {
  value: FilterState;
  onChange: (f: FilterState) => void;
  data: ReportData;
  show?: Partial<Record<"client" | "project" | "user" | "tag" | "billable", boolean>>;
}) {
  const me = useMe();
  const settings = useSettings();
  const today = useToday();
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
  const clients = data.clients.filter((c) => !c.archivedAt).sort((a, b) => a.name.localeCompare(b.name));
  const projects = data.projects
    .filter((p) => (!value.clientId || p.clientId === value.clientId) && !p.parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const users = data.users.filter((u) => u.active).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="filters">
      <Field label="Period">
        <Select
          value={value.preset}
          onChange={(e) => {
            const p = e.target.value as Preset;
            set(p === "custom" ? { preset: p } : { preset: p, ...presetRange(p, today, settings.weekStart) });
          }}
        >
          {PRESETS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="From">
        <Input
          type="date"
          value={value.from}
          onChange={(e) => set({ preset: "custom", from: e.target.value })}
        />
      </Field>
      <Field label="To">
        <Input type="date" value={value.to} onChange={(e) => set({ preset: "custom", to: e.target.value })} />
      </Field>
      {show.client !== false && (
        <Field label="Client">
          <Select value={value.clientId} onChange={(e) => set({ clientId: e.target.value, projectId: "" })}>
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {show.project !== false && (
        <Field label="Project (incl. sub-projects)">
          <Select value={value.projectId} onChange={(e) => set({ projectId: e.target.value })}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {show.user !== false && me.user.role !== "member" && users.length > 1 && (
        <Field label="Person">
          <Select value={value.userId} onChange={(e) => set({ userId: e.target.value })}>
            <option value="">Everyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {show.tag !== false && data.tags.length > 0 && (
        <Field label="Tag">
          <Select value={value.tagId} onChange={(e) => set({ tagId: e.target.value })}>
            <option value="">Any tag</option>
            {data.tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {show.billable !== false && (
        <Field label="Billable">
          <Select
            value={value.billable}
            onChange={(e) => set({ billable: e.target.value as BillableFilter })}
          >
            <option value="all">All time</option>
            <option value="billable">Billable only</option>
            <option value="nonbillable">Non-billable only</option>
          </Select>
        </Field>
      )}
    </div>
  );
}
