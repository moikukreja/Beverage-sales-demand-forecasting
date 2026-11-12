/**
 * Trend and seasonality views: units per day with its linear trend, and the month-of-year
 * profile before vs after calendar adjustment (shows how much "seasonality" is month length).
 */
import { useMemo } from "react";
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { ChartTooltip } from "./ChartTooltip";
import { fmtInt, fmtPct, monthLabel, monthName } from "../lib/format";
import { AXIS_COLOR, GRID_COLOR } from "../lib/theme";
import type { PipelineResult } from "../types";

const RAW = "#a9bccb";
const ADJ = "#5ee6d8";

export function TrendSeasonality({ result }: { result: PipelineResult }) {
  const a = result.analysis;
  const trend = useMemo(() => {
    const pts = result.series.map((r, i) => ({ month: r.month, perDay: r.units / r.days, i }));
    const n = pts.length;
    const mx = (n - 1) / 2;
    const my = pts.reduce((s, p) => s + p.perDay, 0) / n;
    const slope = pts.reduce((s, p) => s + (p.i - mx) * (p.perDay - my), 0) / pts.reduce((s, p) => s + (p.i - mx) ** 2, 0);
    return pts.map((p) => ({ ...p, fit: my + slope * (p.i - mx) }));
  }, [result.series]);

  const profile = a.month_profile.map((p) => ({
    month: monthName(p.month_of_year),
    raw: (p.raw_index - 1) * 100,
    adj: (p.per_day_index - 1) * 100,
    n: p.observations,
  }));

  const stats = [
    { label: "Trend", value: `${a.trend_pct_per_month >= 0 ? "+" : ""}${a.trend_pct_per_month.toFixed(2)}%/mo` },
    { label: "Variation (raw)", value: fmtPct(a.cv_raw_pct) },
    { label: "Variation (per day)", value: fmtPct(a.cv_per_day_pct) },
    { label: "Explained by month length", value: fmtPct(a.calendar_share_of_variation_pct, 1) },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-white/10 bg-deep-900/60 px-3 py-2.5">
            <div className="label">{s.label}</div>
            <div className="num mt-1 font-display text-lg text-ink">{s.value}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-medium text-ink-soft">Units per day and linear trend</h3>
          <div className="h-[230px]" role="img" aria-label="Units per day with trend line">
            <ResponsiveContainer>
              <ComposedChart data={trend} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
                <CartesianGrid stroke={GRID_COLOR} vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthLabel} stroke={AXIS_COLOR} tickLine={false} axisLine={{ stroke: GRID_COLOR }} minTickGap={14} />
                <YAxis stroke={AXIS_COLOR} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={48} tickFormatter={(v) => fmtInt(v)} />
                <Tooltip content={<ChartTooltip rows={(l) => {
                  const p = trend.find((t) => t.month === l);
                  return p ? [
                    { name: "Units per day", color: ADJ, value: fmtInt(p.perDay) },
                    { name: "Trend", color: RAW, value: fmtInt(p.fit) },
                  ] : [];
                }} />} />
                <Legend wrapperStyle={{ fontSize: 12, color: "#a9bccb" }} />
                <Line dataKey="perDay" name="Units per day" stroke={ADJ} strokeWidth={2} dot={{ r: 3, fill: ADJ, strokeWidth: 0 }} />
                <Line dataKey="fit" name="Linear trend" stroke={RAW} strokeDasharray="5 4" strokeWidth={1.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium text-ink-soft">Month-of-year profile: % vs average month</h3>
          <div className="h-[230px]" role="img" aria-label="Seasonal profile raw vs calendar adjusted">
            <ResponsiveContainer>
              <BarChart data={profile} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barGap={2}>
                <CartesianGrid stroke={GRID_COLOR} vertical={false} />
                <XAxis dataKey="month" stroke={AXIS_COLOR} tickLine={false} axisLine={{ stroke: GRID_COLOR }} interval={0} tick={{ fontSize: 10 }} />
                <YAxis stroke={AXIS_COLOR} tickLine={false} axisLine={false} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
                <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<ChartTooltip title={(l) => l} rows={(l) => {
                  const p = profile.find((x) => x.month === l);
                  return p ? [
                    { name: "Raw units", color: RAW, value: `${p.raw >= 0 ? "+" : ""}${p.raw.toFixed(2)}%` },
                    { name: "Per day", color: ADJ, value: `${p.adj >= 0 ? "+" : ""}${p.adj.toFixed(2)}%` },
                    { name: "Years observed", color: "transparent", value: String(p.n) },
                  ] : [];
                }} />} />
                <Legend wrapperStyle={{ fontSize: 12, color: "#a9bccb" }} />
                <Bar dataKey="raw" name="Raw units" fill={RAW} fillOpacity={0.7} radius={[3, 3, 3, 3]} />
                <Bar dataKey="adj" name="Per day (calendar-adjusted)" fill={ADJ} radius={[3, 3, 3, 3]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <p className="text-xs text-ink-mute">
        {a.full_years_observed < 2
          ? `Only ${a.n_months} months: each calendar month is seen about once, so this profile cannot separate true seasonality from noise. `
          : `${a.full_years_observed} full years observed. `}
        Grey bars that shrink to the aqua ones are month-length effects, not demand.
      </p>
    </div>
  );
}
