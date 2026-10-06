import { formatDuration } from "@stint/shared";
import { useId, useState } from "react";

export interface StackDatum {
  key: string;
  label: string;
  /** seconds per series, bottom first */
  values: number[];
  tooltipTitle: string;
}

/**
 * Stacked column chart for hours per day (client work / internal).
 * Thin columns, 4px rounded tops, 2px surface gap between segments, recessive
 * grid, a legend (2 series) and a per-column tooltip on hover and keyboard focus.
 */
export function StackedColumns({
  data,
  series,
  height = 200,
  label,
}: {
  data: StackDatum[];
  series: { name: string; color: string }[];
  height?: number;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const maxRaw = Math.max(3600, ...data.map((d) => d.values.reduce((a, b) => a + b, 0)));
  const stepH = maxRaw > 12 * 3600 * 4 ? 10 : maxRaw > 12 * 3600 ? 4 : 2;
  const max = Math.ceil(maxRaw / 3600 / stepH) * stepH * 3600;
  const ticks = Array.from({ length: max / 3600 / stepH + 1 }, (_, i) => i * stepH * 3600);
  const padL = 34;
  const padB = 22;
  const w = 100 / Math.max(1, data.length);
  const showEvery = data.length > 16 ? Math.ceil(data.length / 12) : 1;

  return (
    <figure className="chart" aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`} className="sr-only">
        {label}
      </figcaption>
      <div className="chart__legend" aria-hidden="true">
        {series.map((s) => (
          <span key={s.name} className="chart__key">
            <span className="chart__swatch" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <div className="chart__plot" style={{ height, paddingLeft: padL, paddingBottom: padB }}>
        {ticks.map((t) => (
          <div key={t} className="chart__grid" style={{ bottom: padB + (t / max) * (height - padB) }}>
            <span>{t / 3600}h</span>
          </div>
        ))}
        <div className="chart__cols" style={{ left: padL, height: height - padB }}>
          {data.map((d, i) => {
            const totalS = d.values.reduce((a, b) => a + b, 0);
            let acc = 0;
            return (
              <button
                key={d.key}
                type="button"
                className="chart__col"
                style={{ width: `${w}%` }}
                data-hover={hover === i || undefined}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${d.tooltipTitle}: ${series.map((s, j) => `${s.name} ${formatDuration(d.values[j] ?? 0)}`).join(", ")}`}
              >
                <span className="chart__stack">
                  {d.values.map((v, j) => {
                    if (!v) return null;
                    const bottom = (acc / max) * 100;
                    acc += v;
                    const isTop = acc === totalS;
                    return (
                      <span
                        // biome-ignore lint/suspicious/noArrayIndexKey: series order is fixed
                        key={j}
                        className="chart__seg"
                        data-top={isTop || undefined}
                        style={{
                          bottom: `${bottom}%`,
                          height: `calc(${(v / max) * 100}% - 2px)`,
                          background: series[j]?.color,
                        }}
                      />
                    );
                  })}
                </span>
                {i % showEvery === 0 && <span className="chart__xlabel">{d.label}</span>}
                {hover === i && (
                  <span
                    className="chart__tip"
                    role="tooltip"
                    data-right={i > data.length * 0.66 || undefined}
                  >
                    <strong className="chart__tip-title">{d.tooltipTitle}</strong>
                    {series.map((s, j) => (
                      <span key={s.name} className="chart__tip-row">
                        <span className="chart__tip-key" style={{ background: s.color }} />
                        <strong className="mono">{formatDuration(d.values[j] ?? 0)}</strong>
                        <span className="muted">{s.name}</span>
                      </span>
                    ))}
                    <span className="chart__tip-row">
                      <span className="chart__tip-key" style={{ background: "transparent" }} />
                      <strong className="mono">{formatDuration(totalS)}</strong>
                      <span className="muted">Total</span>
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </figure>
  );
}

/** Horizontal magnitude bars (single series): a label, a bar, a value. */
export function BarList({
  items,
  format,
  emptyText = "Nothing yet.",
}: {
  items: { key: string; label: string; sub?: string; value: number; color?: string }[];
  format: (v: number) => string;
  emptyText?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="subtle">{emptyText}</p>;
  return (
    <ul className="barlist">
      {items.map((i) => (
        <li key={i.key}>
          <div className="barlist__label">
            <span className="truncate">
              {i.color && <span className="dot" style={{ background: i.color, marginRight: 6 }} />}
              {i.label}
            </span>
            {i.sub && <span className="subtle truncate barlist__sub">{i.sub}</span>}
          </div>
          <div className="barlist__track" aria-hidden="true">
            <span style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
          <span className="barlist__value mono">{format(i.value)}</span>
        </li>
      ))}
    </ul>
  );
}
