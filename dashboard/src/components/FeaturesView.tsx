/**
 * Task 1: the engineered features exactly as the models see them - lag features
 * (tinted by value) and seasonal indicators. Empty lags show why early rows are dropped.
 */
import { fmtInt, monthLabel } from "../lib/format";
import type { FeatureRow, PipelineResult } from "../types";

const LAGS: (keyof FeatureRow)[] = ["lag_1", "lag_2", "lag_3", "roll_mean_3"];

export function FeaturesView({ result }: { result: PipelineResult }) {
  const adjust = result.settings.calendar_adjusted;
  const rows = result.features;
  const targets = rows.map((r) => r.target);
  const lo = Math.min(...targets);
  const hi = Math.max(...targets);
  const tint = (v: number | null) => {
    if (v == null) return undefined;
    const t = hi === lo ? 0.5 : (v - lo) / (hi - lo);
    return { background: `rgba(94, 230, 216, ${0.06 + 0.3 * t})` };
  };
  const usable = rows.filter((r) => r.lag_3 != null).length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <span className="chip">Target: {adjust ? "units per day (calendar-adjusted)" : "raw monthly units"}</span>
        <span className="chip">Lags use only past months (no leakage)</span>
        <span className="chip">{usable} of {rows.length} rows have all 3 lags</span>
      </div>
      <div className="max-h-[420px] overflow-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[860px] text-xs">
          <thead className="sticky top-0 bg-deep-900/95 backdrop-blur">
            <tr className="label text-left">
              <th className="px-3 py-2 font-medium">Month</th>
              <th className="px-3 py-2 text-right font-medium">Units</th>
              <th className="px-3 py-2 text-right font-medium">Days</th>
              <th className="px-3 py-2 text-right font-medium">Target</th>
              <th className="px-3 py-2 text-right font-medium">lag_1</th>
              <th className="px-3 py-2 text-right font-medium">lag_2</th>
              <th className="px-3 py-2 text-right font-medium">lag_3</th>
              <th className="px-3 py-2 text-right font-medium">roll_mean_3</th>
              <th className="px-3 py-2 text-right font-medium">month_sin</th>
              <th className="px-3 py-2 text-right font-medium">month_cos</th>
              <th className="px-3 py-2 text-right font-medium">Quarter</th>
              <th className="px-3 py-2 text-right font-medium">t</th>
            </tr>
          </thead>
          <tbody className="num">
            {rows.map((r) => (
              <tr key={r.month} className="border-t border-white/5">
                <td className="px-3 py-1.5 text-ink-soft">{monthLabel(r.month)}</td>
                <td className="px-3 py-1.5 text-right">{fmtInt(r.units)}</td>
                <td className={`px-3 py-1.5 text-right ${r.days_in_month === 28 ? "text-citrus" : ""}`}>{r.days}</td>
                <td className="px-3 py-1.5 text-right" style={tint(r.target)}>{fmtInt(r.target)}</td>
                {LAGS.map((k) => {
                  const v = r[k] as number | null;
                  return (
                    <td key={k} className="px-3 py-1.5 text-right" style={tint(v)}>
                      {v == null ? <span className="text-ink-mute">—</span> : fmtInt(v)}
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-right text-ink-soft">{r.month_sin.toFixed(2)}</td>
                <td className="px-3 py-1.5 text-right text-ink-soft">{r.month_cos.toFixed(2)}</td>
                <td className="px-3 py-1.5 text-right text-ink-soft">Q{r.quarter}</td>
                <td className="px-3 py-1.5 text-right text-ink-soft">{r.t}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-mute">
        Cell tint = value (darker = lower). A 12-month seasonal lag is not possible: it needs a full year before the first training row.
        Random Forest uses lag_1–3, roll_mean_3, t, month_sin/cos and days_in_month; Naive and ARIMA use the target series directly.
      </p>
    </div>
  );
}
