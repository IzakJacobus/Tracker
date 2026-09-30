import { Plus, Tag as TagIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useData } from "../data/DataProvider.tsx";
import { useTags } from "../data/hooks.ts";
import { Button } from "../ui/Button.tsx";
import { Popover } from "../ui/Popover.tsx";

export function TagPicker({
  value,
  onChange,
  compact,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  compact?: boolean;
}) {
  const { entries } = useData();
  const tags = useTags().filter((t) => !t.archivedAt);
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = tags.filter((t) => value.includes(t.id));
  const shown = tags
    .filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const exact = tags.some((t) => t.name.toLowerCase() === q.trim().toLowerCase());
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <>
      <Button
        ref={anchor}
        variant="ghost"
        size={compact ? "sm" : "md"}
        iconOnly={selected.length === 0}
        label="Tags"
        icon={<TagIcon />}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className={selected.length ? "tag-trigger--on" : undefined}
      >
        {selected.length > 0 && (
          <span className="truncate" style={{ maxWidth: 140 }}>
            {selected.map((t) => t.name).join(", ")}
          </span>
        )}
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} label="Tags" width={260}>
        <div className="stack stack--sm" style={{ padding: 6 }}>
          <input
            className="input input--sm"
            // biome-ignore lint/a11y/noAutofocus: popover opens for typing
            autoFocus
            placeholder="Find or create a tag"
            value={q}
            aria-label="Find or create a tag"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && q.trim() && !exact) {
                const t = await entries.createTag(q);
                onChange([...value, t.id]);
                setQ("");
              }
            }}
          />
          <div style={{ maxHeight: 220, overflow: "auto" }}>
            {shown.map((t) => (
              <label key={t.id} className="menu-item checkbox">
                <input type="checkbox" checked={value.includes(t.id)} onChange={() => toggle(t.id)} />
                <span className="dot" style={{ background: t.color, borderRadius: "50%" }} />
                {t.name}
              </label>
            ))}
            {shown.length === 0 && !q && (
              <div className="subtle" style={{ padding: 8, fontSize: 13 }}>
                No tags yet — type to create one.
              </div>
            )}
          </div>
          {q.trim() && !exact && (
            <Button
              size="sm"
              icon={<Plus />}
              onClick={async () => {
                const t = await entries.createTag(q);
                onChange([...value, t.id]);
                setQ("");
              }}
            >
              Create “{q.trim()}”
            </Button>
          )}
        </div>
      </Popover>
    </>
  );
}
