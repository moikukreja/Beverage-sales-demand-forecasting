import { CheckCircle2, Droplets, Loader2, XCircle } from "lucide-react";
import type { EngineStatus } from "../engine/client";

export function Header({ engine }: { engine: EngineStatus }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 pb-2 pt-6">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl border border-aqua/30 bg-gradient-to-br from-aqua/25 to-[#2a78d6]/20 text-aqua shadow-[0_0_30px_-6px_rgba(94,230,216,0.5)]">
          <Droplets size={22} />
        </span>
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight sm:text-2xl">
            FlowCast <span className="font-medium text-ink-soft">· Flavored Water Demand</span>
          </h1>
          <p className="text-xs text-ink-mute sm:text-sm">
            Forecasting monthly sales for a new beverage product · AI in Operations lab
          </p>
        </div>
      </div>
      <EnginePill engine={engine} />
    </header>
  );
}

function EnginePill({ engine }: { engine: EngineStatus }) {
  if (engine.state === "ready")
    return (
      <span className="chip text-aqua" title="Python forecasting engine running in your browser (Pyodide)">
        <CheckCircle2 size={14} /> Live engine ready · {engine.seconds.toFixed(1)}s
      </span>
    );
  if (engine.state === "failed")
    return (
      <span className="chip text-rose-300" title={engine.error}>
        <XCircle size={14} /> Engine failed – showing saved results
      </span>
    );
  return (
    <span className="chip" title="First visit downloads the Python runtime; later visits use the browser cache">
      <Loader2 size={14} className="animate-spin text-aqua" /> {engine.message}… (showing saved results)
    </span>
  );
}
