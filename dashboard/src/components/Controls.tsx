/** Sticky control bar: model in view, train-test split, horizon, calendar feature, live feed. */
import { Loader2, Radio } from "lucide-react";
import { MODEL_COLORS, MODEL_ORDER } from "../lib/theme";
import { monthLong } from "../lib/format";
import type { Settings } from "../engine/useForecast";
import type { ModelKey, MonthRecord, PipelineResult } from "../types";

interface Props {
  result: PipelineResult;
  settings: Settings;
  seriesLength: number;
  viewing: ModelKey | "all";
  setViewing: (v: ModelKey | "all") => void;
  update: (p: Partial<Settings>) => void;
  nextFeed: MonthRecord | null;
  onAdvance: () => void;
  computing: boolean;
  engineReady: boolean;
}

export function Controls({ result, settings, seriesLength, viewing, setViewing, update, nextFeed, onAdvance, computing, engineReady }: Props) {
  const maxTest = Math.max(1, Math.min(6, seriesLength - 6));
  const options: (ModelKey | "all")[] = ["all", ...MODEL_ORDER];
  const locked = !engineReady;

  return (
    <div className="glass z-30 flex lg:sticky lg:top-3 flex-wrap items-end gap-x-6 gap-y-4 px-4 py-3">
      <div className="min-w-0">
        <div className="label mb-1.5">Model in view</div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1" role="radiogroup" aria-label="Model in view">
          {options.map((o) => (
            <button
              key={o}
              role="radio"
              aria-checked={viewing === o}
              onClick={() => setViewing(o)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${viewing === o ? "bg-white/[0.12] text-ink" : "text-ink-soft hover:text-ink"}`}
            >
              {o !== "all" && <span className="h-2 w-2 rounded-full" style={{ background: MODEL_COLORS[o] }} />}
              {o === "all" ? "All models" : result.models[o].label}
            </button>
          ))}
        </div>
      </div>

      <Slider label="Test months" value={settings.testSize} min={1} max={maxTest} disabled={locked}
        hint={`train ${seriesLength - settings.testSize} · test ${settings.testSize}`}
        onChange={(v) => update({ testSize: v })} />
      <Slider label="Forecast horizon" value={settings.horizon} min={1} max={6} disabled={locked}
        hint={`${settings.horizon} month${settings.horizon > 1 ? "s" : ""} ahead`}
        onChange={(v) => update({ horizon: v })} />

      <label className={`flex items-center gap-3 ${locked ? "opacity-40" : "cursor-pointer"}`}>
        <span>
          <span className="label block">Calendar adjustment</span>
          <span className="text-xs text-ink-soft">model units per day</span>
        </span>
        <button
          role="switch"
          aria-checked={settings.adjust}
          aria-label="Calendar adjustment"
          disabled={locked}
          onClick={() => update({ adjust: !settings.adjust })}
          className={`relative h-6 w-11 rounded-full border border-white/10 transition ${settings.adjust ? "bg-aqua/60" : "bg-white/10"}`}
        >
          <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white transition-all ${settings.adjust ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </label>

      <div className="ml-auto flex items-center gap-3">
        {computing && <span className="flex items-center gap-1.5 text-xs text-aqua"><Loader2 size={14} className="animate-spin" /> Recomputing</span>}
        <button className="btn btn-primary" onClick={onAdvance} disabled={!nextFeed || locked}
          title="Release the next actual month from the live feed">
          <Radio size={16} />
          {nextFeed ? `New month: ${monthLong(nextFeed.month)}` : "Feed exhausted"}
        </button>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, hint, onChange, disabled }: {
  label: string; value: number; min: number; max: number; hint: string; onChange: (v: number) => void; disabled: boolean;
}) {
  const id = `slider-${label.replace(/\s/g, "-")}`;
  return (
    <div className={`w-40 ${disabled ? "opacity-40" : ""}`}>
      <label htmlFor={id} className="label mb-1.5 flex justify-between">
        {label} <span className="num normal-case tracking-normal text-ink">{value}</span>
      </label>
      <input id={id} type="range" className="w-full" min={min} max={max} step={1} value={Math.min(value, max)}
        disabled={disabled || min === max} onChange={(e) => onChange(Number(e.target.value))} />
      <div className="mt-1 text-[11px] text-ink-mute">{hint}</div>
    </div>
  );
}
