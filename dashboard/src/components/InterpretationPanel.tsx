/** Task 7 + "Must add LLM": the three slide questions, answered from the live results. */
import { motion } from "framer-motion";
import { AlertTriangle, BadgeCheck, Bot, Cpu, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import type { InterpretationState } from "../llm/useInterpretation";

interface Props {
  state: InterpretationState & { stale: boolean; auto: boolean };
  setAuto: (v: boolean) => void;
  regenerate: () => void;
  currentVersion: string;
  viewingLabel: string;
}

const QUESTIONS = [
  { key: "seasonality_trends", q: "How well did the model capture seasonality or trends?" },
  { key: "best_model", q: "Which model performed best and why?" },
] as const;

export function InterpretationPanel({ state, setAuto, regenerate, currentVersion, viewingLabel }: Props) {
  const a = state.answer;
  const busy = state.status === "loading";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <StatusPill state={state} />
        {state.source === "llm" && <span className="chip text-aqua"><Bot size={13} /> {state.sourceDetail}</span>}
        {state.source === "fallback" && (
          <span className="chip text-amber-300" title={state.sourceDetail}><Cpu size={13} /> Offline interpretation · {state.sourceDetail}</span>
        )}
        {state.grounding && (
          state.grounding.grounded ? (
            <span className="chip text-aqua"><BadgeCheck size={13} /> {state.grounding.numbers_checked} numbers verified against the data</span>
          ) : (
            <span className="chip text-amber-300" title="Numbers that do not appear in the computed results">
              <ShieldAlert size={13} /> Unverified: {state.grounding.ungrounded.join(", ")}
            </span>
          )
        )}
        <span className="chip num">data v{state.dataVersion ?? currentVersion}{state.generatedAt ? ` · ${state.generatedAt.replace("T", " ").replace("Z", " UTC")}` : ""}</span>
        <span className="chip">viewing: {viewingLabel}</span>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-ink-soft">
            <input type="checkbox" className="accent-[#5ee6d8]" checked={state.auto} onChange={(e) => setAuto(e.target.checked)} />
            Auto-update
          </label>
          <button className="btn py-1.5" onClick={regenerate} disabled={busy}>
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Regenerate
          </button>
        </div>
      </div>

      {state.status === "done" && !a && (
        <p className="mb-3 text-sm text-rose-300" role="alert">{state.sourceDetail}</p>
      )}
      <div className={`grid gap-4 transition-opacity lg:grid-cols-3 ${state.stale || busy ? "opacity-60" : ""}`}>
          {QUESTIONS.map((item, i) => (
            <Card key={`${item.key}-${state.generatedAt}`} index={i} q={item.q}>
              {a ? <p>{a[item.key]}</p> : <Skeleton />}
            </Card>
          ))}
          <Card key={`rec-${state.generatedAt}`} index={2} q="What recommendations would you give the company?">
            {a ? (
              <ul className="space-y-2">
                {a.recommendations.map((r) => (
                  <li key={r} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-citrus" />{r}</li>
                ))}
              </ul>
            ) : <Skeleton />}
          </Card>
      </div>

      {a && a.caveats.length > 0 && (
        <details className="mt-4 rounded-xl border border-white/10 bg-deep-900/50 px-4 py-3 text-sm">
          <summary className="flex cursor-pointer items-center gap-2 text-ink-soft"><AlertTriangle size={14} className="text-amber-300" /> Caveats and limitations ({a.caveats.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">
            {a.caveats.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function Card({ index, q, children }: { index: number; q: string; children: React.ReactNode }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.08 }}
      className="rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-4"
    >
      <div className="label mb-1">Question {index + 1}</div>
      <h3 className="mb-2 font-display text-[15px] font-semibold text-ink">{q}</h3>
      <div className="text-sm leading-relaxed text-ink-soft">{children}</div>
    </motion.article>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      {[92, 100, 76, 84].map((w) => <div key={w} className="h-3 animate-pulse rounded bg-white/10" style={{ width: `${w}%` }} />)}
    </div>
  );
}

function StatusPill({ state }: { state: Props["state"] }) {
  if (state.status === "loading")
    return <span className="chip text-aqua"><Loader2 size={13} className="animate-spin" /> Interpreting current results…</span>;
  if (state.status === "waiting")
    return <span className="chip"><Loader2 size={13} className="animate-spin" /> Waiting for the engine to load</span>;
  if (state.stale)
    return <span className="chip text-amber-300"><RefreshCw size={13} /> Data changed – {state.auto ? "updating shortly" : "regenerate to update"}</span>;
  return <span className="chip text-aqua"><BadgeCheck size={13} /> Up to date with the data shown</span>;
}
