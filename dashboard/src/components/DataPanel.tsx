/**
 * Real-time data: release the next actual month from the feed, add a month manually,
 * correct a month, or undo. Every change re-runs the models and the LLM interpretation.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, RotateCcw, Undo2, Radio } from "lucide-react";
import { fmtInt, monthLong, nextMonth } from "../lib/format";
import type { MonthRecord, Source } from "../types";

const SOURCE_STYLE: Record<Source, string> = {
  history: "text-ink-mute",
  "live feed": "text-aqua",
  manual: "text-citrus",
  edited: "text-amber-300",
};

interface Props {
  series: MonthRecord[];
  nextFeed: MonthRecord | null;
  canRemove: boolean;
  onAdvance: () => void;
  onAdd: (units: number) => void;
  onEdit: (month: string, units: number) => void;
  onRemoveLast: () => void;
  onReset: () => void;
}

function validate(text: string, mean: number): { value?: number; error?: string; warn?: string } {
  const v = Number(text.replace(/[, ]/g, ""));
  if (text.trim() === "" || !Number.isFinite(v)) return { error: "Enter a number of units." };
  if (v < 0) return { error: "Units cannot be negative." };
  if (v > 10_000_000) return { error: "That is implausibly large." };
  const warn = mean && Math.abs(v - mean) / mean > 0.5 ? "More than 50% away from the average month – check it." : undefined;
  return { value: Math.round(v), warn };
}

export function DataPanel({ series, nextFeed, canRemove, onAdvance, onAdd, onEdit, onRemoveLast, onReset }: Props) {
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<{ text: string; tone: "error" | "warn" | "ok" } | null>(null);
  const mean = series.reduce((s, r) => s + r.units, 0) / Math.max(series.length, 1);
  const upcoming = series.length ? nextMonth(series[series.length - 1].month) : "";

  const submit = () => {
    const r = validate(draft, mean);
    if (r.error) return setMsg({ text: r.error, tone: "error" });
    onAdd(r.value!);
    setDraft("");
    setMsg({ text: r.warn ?? `${monthLong(upcoming)} added.`, tone: r.warn ? "warn" : "ok" });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-4">
        <div className="rounded-xl border border-aqua/20 bg-aqua/[0.06] p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-aqua"><Radio size={16} /> Live sales feed</div>
          <p className="mt-1 text-xs text-ink-soft">
            Releases the next real month (2022 onwards, held out of the first year) as if it just arrived.
          </p>
          <button className="btn btn-primary mt-3 w-full" onClick={onAdvance} disabled={!nextFeed}>
            {nextFeed ? `Receive ${monthLong(nextFeed.month)} actuals` : "Feed exhausted (Dec 2023)"}
          </button>
        </div>
        <div className="rounded-xl border border-white/10 bg-deep-900/60 p-4">
          <label htmlFor="new-units" className="text-sm font-medium">Add {upcoming ? monthLong(upcoming) : "next month"} manually</label>
          <div className="mt-2 flex gap-2">
            <input
              id="new-units"
              inputMode="numeric"
              placeholder="e.g. 158000"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="num w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm outline-none focus:border-aqua/50"
            />
            <button className="btn shrink-0" onClick={submit}><Plus size={16} /> Add</button>
          </div>
          <AnimatePresence>
            {msg && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className={`mt-2 text-xs ${msg.tone === "error" ? "text-rose-300" : msg.tone === "warn" ? "text-amber-300" : "text-aqua"}`}
                role="status">
                {msg.text}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={onRemoveLast} disabled={!canRemove}><Undo2 size={16} /> Remove last month</button>
          <button className="btn" onClick={onReset}><RotateCcw size={16} /> Reset to first year</button>
        </div>
      </div>

      <div className="max-h-[360px] overflow-auto rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-deep-900/95 backdrop-blur">
            <tr className="label text-left">
              <th className="px-3 py-2 font-medium">Month</th>
              <th className="px-3 py-2 text-right font-medium">Units (editable)</th>
              <th className="px-3 py-2 text-right font-medium">Source</th>
            </tr>
          </thead>
          <tbody className="num">
            {[...series].reverse().map((r) => (
              <tr key={r.month} className="border-t border-white/5">
                <td className="px-3 py-1.5 text-ink-soft">{monthLong(r.month)}</td>
                <td className="px-3 py-1 text-right">
                  <EditableUnits value={r.units} mean={mean} onCommit={(v) => onEdit(r.month, v)} label={monthLong(r.month)} />
                </td>
                <td className={`px-3 py-1.5 text-right text-xs ${SOURCE_STYLE[r.source ?? "history"]}`}>{r.source ?? "history"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditableUnits({ value, mean, onCommit, label }: { value: number; mean: number; onCommit: (v: number) => void; label: string }) {
  const [text, setText] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const commit = () => {
    if (text == null) return;
    const r = validate(text, mean);
    if (r.error) {
      setBad(true);
      return;
    }
    setBad(false);
    setText(null);
    if (r.value !== Math.round(value)) onCommit(r.value!);
  };
  return (
    <input
      aria-label={`Units for ${label}`}
      value={text ?? fmtInt(value)}
      onFocus={() => setText(String(Math.round(value)))}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setText(null); setBad(false); }
      }}
      className={`w-28 rounded-lg border bg-transparent px-2 py-1 text-right outline-none focus:border-aqua/50 ${bad ? "border-rose-400/60" : "border-transparent hover:border-white/10"}`}
    />
  );
}
