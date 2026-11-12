/**
 * Task 6 + Task 4: actual vs predicted (test window) and the next-N-month forecast with
 * its 95% range, on one time axis. Shaded areas mark the test window and the future.
 */
import { useMemo } from "react";
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { ChartTooltip, unitsValue, type TooltipRow } from "./ChartTooltip";
import { fmtK, monthLabel } from "../lib/format";
import { ACTUAL_COLOR, AXIS_COLOR, GRID_COLOR, MODEL_COLORS, MODEL_ORDER } from "../lib/theme";
import type { ModelKey, PipelineResult } from "../types";

type Row = Record<string, number | string | [number, number] | null>;

export function ForecastChart({ result, viewing }: { result: PipelineResult; viewing: ModelKey | "all" }) {
  const shown: ModelKey[] = viewing === "all" ? MODEL_ORDER : [viewing];
  const bandModel: ModelKey = viewing === "all" ? (result.best_model ?? "naive") : viewing;

  const data = useMemo(() => {
    const rows = new Map<string, Row>();
    const row = (m: string) => {
      if (!rows.has(m)) rows.set(m, { month: m });
      return rows.get(m)!;
    };
    result.series.forEach((r) => (row(r.month).actual = r.units));
    for (const key of MODEL_ORDER) {
      const m = result.models[key];
      if (!m.test || !m.forecast) continue;
      m.test.forEach((t) => {
        row(t.month)[`${key}_test`] = t.pred;
        if (key === bandModel && t.lo != null && t.hi != null) row(t.month).band_test = [t.lo, t.hi];
      });
      // join the forecast line to the last actual point so it reads as a continuation
      const last = result.series[result.series.length - 1];
      row(last.month)[`${key}_fc`] = last.units;
      m.forecast.forEach((f) => {
        row(f.month)[`${key}_fc`] = f.pred;
        if (key === bandModel && f.lo != null && f.hi != null) row(f.month).band_fc = [f.lo, f.hi];
      });
    }
    const lastActual = result.series[result.series.length - 1];
    if (row(lastActual.month).band_fc == null) row(lastActual.month).band_fc = [lastActual.units, lastActual.units];
    return [...rows.values()].sort((a, b) => String(a.month).localeCompare(String(b.month)));
  }, [result, bandModel]);

  const months = data.map((d) => String(d.month));
  const lastActual = result.series[result.series.length - 1].month;
  const firstFuture = months[months.indexOf(lastActual) + 1];

  const tooltipRows = (label: string): TooltipRow[] => {
    const d = data.find((r) => r.month === label);
    if (!d) return [];
    const out: TooltipRow[] = [];
    if (d.actual != null) out.push({ name: "Actual", color: ACTUAL_COLOR, value: unitsValue(d.actual as number) });
    for (const key of shown) {
      const label2 = result.models[key].label;
      if (d[`${key}_test`] != null)
        out.push({ name: `${label2} (test)`, color: MODEL_COLORS[key], value: unitsValue(d[`${key}_test`] as number) });
      if (d[`${key}_fc`] != null && d.actual == null)
        out.push({ name: `${label2} forecast`, color: MODEL_COLORS[key], value: unitsValue(d[`${key}_fc`] as number) });
    }
    const band = (d.actual == null ? d.band_fc : d.band_test) as [number, number] | undefined;
    if (band && band[0] !== band[1])
      out.push({ name: `95% range (${result.models[bandModel].label})`, color: MODEL_COLORS[bandModel], value: `${fmtK(band[0])}–${fmtK(band[1])}` });
    return out;
  };

  return (
    <div className="h-[340px] w-full sm:h-[400px]" role="img" aria-label="Actual sales, test predictions and forecast by model">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <ReferenceArea x1={result.split.test_start} x2={lastActual} fill="#ffffff" fillOpacity={0.035}
            label={{ value: "test", position: "insideTopLeft", fill: AXIS_COLOR, fontSize: 11 }} />
          {firstFuture && (
            <ReferenceArea x1={firstFuture} x2={months[months.length - 1]} fill="#d4f36b" fillOpacity={0.04}
              label={{ value: "forecast", position: "insideTopLeft", fill: AXIS_COLOR, fontSize: 11 }} />
          )}
          <XAxis dataKey="month" tickFormatter={monthLabel} stroke={AXIS_COLOR} tickLine={false}
            axisLine={{ stroke: GRID_COLOR }} minTickGap={14} />
          <YAxis stroke={AXIS_COLOR} tickFormatter={fmtK} tickLine={false} axisLine={false} width={44}
            domain={["auto", "auto"]} />
          <Tooltip content={<ChartTooltip rows={tooltipRows} />} cursor={{ stroke: "rgba(255,255,255,0.25)" }} />
          <Legend wrapperStyle={{ fontSize: 12, color: "#a9bccb", paddingTop: 8 }} />
          <Area dataKey="band_test" name="95% range" legendType="none" stroke="none"
            fill={MODEL_COLORS[bandModel]} fillOpacity={0.14} isAnimationActive={false} connectNulls />
          <Area dataKey="band_fc" name={`95% range · ${result.models[bandModel].label}`} stroke="none"
            fill={MODEL_COLORS[bandModel]} fillOpacity={0.2} isAnimationActive={false} />
          <Line dataKey="actual" name="Actual" stroke={ACTUAL_COLOR} strokeWidth={2.2}
            dot={{ r: 3, fill: ACTUAL_COLOR, strokeWidth: 0 }} activeDot={{ r: 5 }} />
          {shown.map((key) => [
            <Line key={`${key}-t`} dataKey={`${key}_test`} name={`${result.models[key].label}`}
              stroke={MODEL_COLORS[key]} strokeWidth={2} strokeDasharray={key === "arima" ? "6 4" : undefined}
              dot={{ r: 4, fill: MODEL_COLORS[key], stroke: "#071526", strokeWidth: 2 }} connectNulls />,
            <Line key={`${key}-f`} dataKey={`${key}_fc`} name={`${result.models[key].label} forecast`}
              legendType="none" stroke={MODEL_COLORS[key]} strokeWidth={2}
              strokeDasharray={key === "arima" ? "6 4" : "2 0"}
              dot={{ r: 4, fill: "#071526", stroke: MODEL_COLORS[key], strokeWidth: 2 }} connectNulls />,
          ])}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
