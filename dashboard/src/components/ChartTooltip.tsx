import { fmtInt, monthLong } from "../lib/format";

export interface TooltipRow {
  name: string;
  color: string;
  value: string;
}

interface Props {
  active?: boolean;
  label?: string;
  rows: (label: string) => TooltipRow[];
  title?: (label: string) => string;
}

/** Shared glass tooltip. Text stays in ink colours; a swatch carries series identity. */
export function ChartTooltip({ active, label, rows, title }: Props) {
  if (!active || !label) return null;
  const items = rows(label);
  if (!items.length) return null;
  return (
    <div className="glass min-w-[180px] rounded-xl px-3 py-2 text-xs shadow-xl">
      <div className="mb-1.5 font-medium text-ink">{title ? title(label) : monthLong(label)}</div>
      <ul className="space-y-1">
        {items.map((r) => (
          <li key={r.name} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-ink-soft">
              <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
              {r.name}
            </span>
            <span className="num text-ink">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const unitsValue = (v: number | null | undefined) => (v == null ? "–" : `${fmtInt(v)} u`);
