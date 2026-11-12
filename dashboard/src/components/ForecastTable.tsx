/** Task 4: next-N-month forecast for each model side by side, with the 95% range. */
import { fmtInt, monthLong } from "../lib/format";
import { MODEL_BLURB, MODEL_COLORS, MODEL_ORDER } from "../lib/theme";
import type { ModelKey, PipelineResult } from "../types";

export function ForecastTable({ result, viewing }: { result: PipelineResult; viewing: ModelKey | "all" }) {
  const keys = viewing === "all" ? MODEL_ORDER : [viewing];
  const months = (result.models[keys.find((k) => result.models[k].forecast) ?? "naive"].forecast ?? []).map((f) => f.month);

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-deep-900/70">
            <tr className="text-left">
              <th className="label px-4 py-3 font-medium">Month</th>
              {keys.map((k) => (
                <th key={k} className="px-4 py-3 text-right font-medium">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: MODEL_COLORS[k] }} />
                    {result.models[k].label}
                    {result.best_model === k && <span className="chip py-0 text-[10px] text-citrus">best</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="num">
            {months.map((m, i) => (
              <tr key={m} className="border-t border-white/5">
                <td className="px-4 py-2 text-ink-soft">{monthLong(m)}</td>
                {keys.map((k) => {
                  const f = result.models[k].forecast?.[i];
                  return (
                    <td key={k} className="px-4 py-2 text-right">
                      <div>{f ? fmtInt(f.pred) : "–"}</div>
                      {f?.lo != null && f.hi != null && (
                        <div className="text-[11px] text-ink-mute">{fmtInt(f.lo)} – {fmtInt(f.hi)}</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t border-white/15 font-medium">
              <td className="px-4 py-2.5">Total units</td>
              {keys.map((k) => (
                <td key={k} className="px-4 py-2.5 text-right">{fmtInt(result.models[k].forecast_total)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <ul className="mt-3 grid gap-2 text-xs text-ink-mute md:grid-cols-3">
        {keys.map((k) => {
          const m = result.models[k];
          return (
            <li key={k}>
              <span className="font-medium text-ink-soft">{m.label}:</span> {m.error ?? MODEL_BLURB[k]}{" "}
              Range: {String(m.details_full_fit?.interval ?? "–")}
              {m.details_full_fit?.order ? `; order ${String(m.details_full_fit.order)}` : ""}.
            </li>
          );
        })}
      </ul>
    </div>
  );
}
