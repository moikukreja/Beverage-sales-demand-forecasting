/**
 * Task 5: MAPE / WAPE comparison across models (same split, same horizon) and a
 * hand-calculation table that recomputes both metrics in the browser as a cross-check.
 */
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Calculator, Check, ChevronDown } from "lucide-react";
import { ChartTooltip } from "./ChartTooltip";
import { fmtInt, fmtPct, monthLong } from "../lib/format";
import { AXIS_COLOR, GRID_COLOR, MODEL_COLORS, MODEL_ORDER } from "../lib/theme";
import type { ModelKey, PipelineResult } from "../types";

export function MetricsPanel({ result, viewing }: { result: PipelineResult; viewing: ModelKey | "all" }) {
  const rows = MODEL_ORDER.filter((k) => result.models[k].metrics).map((k) => ({
    key: k,
    label: result.models[k].label,
    MAPE: result.models[k].metrics!.mape ?? 0,
    WAPE: result.models[k].metrics!.wape ?? 0,
    bias: result.models[k].metrics!.bias_pct ?? 0,
  }));

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <div>
        <div className="h-[260px]" role="img" aria-label="MAPE and WAPE by model">
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 22, right: 8, left: -8, bottom: 0 }} barGap={4} barCategoryGap="28%">
              <CartesianGrid stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey="label" stroke={AXIS_COLOR} tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
              <YAxis stroke={AXIS_COLOR} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                content={
                  <ChartTooltip
                    title={(l) => l}
                    rows={(l) => {
                      const r = rows.find((x) => x.label === l);
                      if (!r) return [];
                      const c = MODEL_COLORS[r.key];
                      return [
                        { name: "MAPE", color: c, value: fmtPct(r.MAPE) },
                        { name: "WAPE", color: c, value: fmtPct(r.WAPE) },
                        { name: "Bias", color: c, value: fmtPct(r.bias) },
                      ];
                    }}
                  />
                }
              />
              <Bar dataKey="MAPE" radius={[4, 4, 0, 0]} maxBarSize={38}>
                {rows.map((r) => <Cell key={r.key} fill={MODEL_COLORS[r.key]} fillOpacity={0.45} />)}
                <LabelList dataKey="MAPE" position="top" formatter={(v: number) => v.toFixed(2)} fill="#a9bccb" fontSize={11} />
              </Bar>
              <Bar dataKey="WAPE" radius={[4, 4, 0, 0]} maxBarSize={38}>
                {rows.map((r) => <Cell key={r.key} fill={MODEL_COLORS[r.key]} />)}
                <LabelList dataKey="WAPE" position="top" formatter={(v: number) => v.toFixed(2)} fill="#eaf2f7" fontSize={11} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-ink-soft">
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-ink-soft/45" /> MAPE (light bar)</span>
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-ink-soft" /> WAPE (solid bar)</span>
          <span>Lower is better · scored on {result.split.test_months} test month(s)</span>
        </div>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="label text-left">
              <th className="py-2 font-medium">Model</th>
              <th className="py-2 text-right font-medium">MAPE</th>
              <th className="py-2 text-right font-medium">WAPE</th>
              <th className="py-2 text-right font-medium">Bias</th>
            </tr>
          </thead>
          <tbody className="num">
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-white/5">
                <td className="py-2">
                  <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: MODEL_COLORS[r.key] }} />
                  {r.label}
                  {result.best_model === r.key && <span className="chip ml-2 py-0 text-[10px] text-citrus">best</span>}
                </td>
                <td className="py-2 text-right">{fmtPct(r.MAPE)}</td>
                <td className="py-2 text-right">{fmtPct(r.WAPE)}</td>
                <td className="py-2 text-right text-ink-soft">{r.bias > 0 ? "+" : ""}{fmtPct(r.bias)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-mute">Bias &gt; 0 means over-forecasting (overstock risk); &lt; 0 means under-forecasting (stock-out risk).</p>
      </div>
      <HandCalc result={result} model={viewing === "all" ? (result.best_model ?? "naive") : viewing} />
    </div>
  );
}

/** Recomputes MAPE and WAPE from the test rows in the browser and compares with the engine. */
function HandCalc({ result, model }: { result: PipelineResult; model: ModelKey }) {
  const [open, setOpen] = useState(true);
  const m = result.models[model];
  if (!m.test || !m.metrics) return null;
  const rows = m.test.map((t) => ({ ...t, abs: Math.abs(t.actual - t.pred) }));
  const valid = rows.filter((r) => Math.abs(r.actual) > 1);
  const mape = valid.length ? (100 / valid.length) * valid.reduce((s, r) => s + r.abs / Math.abs(r.actual), 0) : null;
  const sumAbs = rows.reduce((s, r) => s + r.abs, 0);
  const sumA = rows.reduce((s, r) => s + Math.abs(r.actual), 0);
  const wape = sumA ? (100 * sumAbs) / sumA : null;
  const agree =
    mape != null && wape != null && m.metrics.mape != null && m.metrics.wape != null &&
    Math.abs(mape - m.metrics.mape) < 1e-6 && Math.abs(wape - m.metrics.wape) < 1e-6;

  return (
    <div className="rounded-xl border border-white/10 bg-deep-900/60 p-4">
      <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="flex items-center gap-2 text-sm font-medium">
          <Calculator size={16} className="text-aqua" /> Hand calculation · {m.label}
        </span>
        <ChevronDown size={16} className={`text-ink-mute transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] text-xs">
            <thead>
              <tr className="label text-left">
                <th className="py-1.5 font-medium">Month</th>
                <th className="py-1.5 text-right font-medium">Actual A</th>
                <th className="py-1.5 text-right font-medium">Forecast F</th>
                <th className="py-1.5 text-right font-medium">|A − F|</th>
                <th className="py-1.5 text-right font-medium">|A − F| / |A|</th>
              </tr>
            </thead>
            <tbody className="num">
              {rows.map((r) => (
                <tr key={r.month} className="border-t border-white/5">
                  <td className="py-1.5">{monthLong(r.month)}</td>
                  <td className="py-1.5 text-right">{fmtInt(r.actual)}</td>
                  <td className="py-1.5 text-right">{fmtInt(r.pred)}</td>
                  <td className="py-1.5 text-right">{fmtInt(r.abs)}</td>
                  <td className="py-1.5 text-right">{Math.abs(r.actual) > 1 ? fmtPct((100 * r.abs) / Math.abs(r.actual)) : "skipped (≈0)"}</td>
                </tr>
              ))}
              <tr className="border-t border-white/15 font-medium">
                <td className="py-1.5">Σ</td>
                <td className="py-1.5 text-right">{fmtInt(sumA)}</td>
                <td />
                <td className="py-1.5 text-right">{fmtInt(sumAbs)}</td>
                <td />
              </tr>
            </tbody>
          </table>
          <div className="mt-3 space-y-1.5 font-mono text-[11px] leading-relaxed text-ink-soft">
            <div>MAPE = (100 / n) · Σ |A−F|/|A| = <span className="text-ink">{fmtPct(mape, 4)}</span></div>
            <div>WAPE = 100 · Σ|A−F| / Σ|A| = 100 · {fmtInt(sumAbs)} / {fmtInt(sumA)} = <span className="text-ink">{fmtPct(wape, 4)}</span></div>
          </div>
          <div className={`mt-3 inline-flex items-center gap-1.5 text-xs ${agree ? "text-aqua" : "text-amber-300"}`}>
            <Check size={14} /> {agree ? "Matches the engine's MAPE and WAPE" : "Differs from the engine – check inputs"}
          </div>
          <p className="mt-2 text-[11px] text-ink-mute">
            Months with |A| ≤ 1 unit are skipped by MAPE (division by ≈0); WAPE is undefined only if every actual is 0.
          </p>
        </div>
      )}
    </div>
  );
}
