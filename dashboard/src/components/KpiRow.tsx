import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect } from "react";
import { fmtInt, fmtPct, monthLong } from "../lib/format";
import { MODEL_COLORS } from "../lib/theme";
import type { ModelKey, PipelineResult } from "../types";

/** Number that tweens to its new value when the data changes. */
function Counter({ value, format }: { value: number; format: (v: number) => string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, format);
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.6, ease: "easeOut" });
    return c.stop;
  }, [value, mv]);
  return <motion.span>{text}</motion.span>;
}

export function KpiRow({ result, viewing }: { result: PipelineResult; viewing: ModelKey | "all" }) {
  const last = result.series[result.series.length - 1];
  const focus: ModelKey = viewing === "all" ? (result.best_model ?? "naive") : viewing;
  const fm = result.models[focus];
  const best = result.best_model ? result.models[result.best_model] : null;
  const sources = Object.entries(result.sources).map(([k, v]) => `${v} ${k}`).join(" · ");

  const tiles = [
    { label: `Latest actual · ${monthLong(last.month)}`, value: <Counter value={last.units} format={fmtInt} />, sub: `units · ${last.source}` },
    {
      label: `Next ${result.settings.horizon} months · ${fm.label}`,
      value: fm.forecast_total != null ? <Counter value={fm.forecast_total} format={fmtInt} /> : "–",
      sub: fm.forecast ? `${monthLong(fm.forecast[0].month)} – ${monthLong(fm.forecast[fm.forecast.length - 1].month)}` : fm.error,
      color: MODEL_COLORS[focus],
    },
    {
      label: "Best model (lowest WAPE)",
      value: best ? best.label : "–",
      sub: best?.metrics ? `WAPE ${fmtPct(best.metrics.wape)} · MAPE ${fmtPct(best.metrics.mape)}` : "",
      color: result.best_model ? MODEL_COLORS[result.best_model] : undefined,
    },
    { label: "History used", value: <Counter value={result.analysis.n_months} format={(v) => `${Math.round(v)} months`} />, sub: sources },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="glass relative overflow-hidden px-4 py-3.5">
          {t.color && <span className="absolute inset-y-0 left-0 w-1" style={{ background: t.color }} />}
          <div className="label truncate">{t.label}</div>
          <div className="num mt-1 font-display text-2xl font-semibold text-ink">{t.value}</div>
          <div className="mt-0.5 truncate text-xs text-ink-soft">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}
