/**
 * Main-thread client for the Pyodide worker (public/engine/worker.js).
 * One shared worker; calls are matched to replies by id.
 */
type EngineFn = "run_json" | "payload_json" | "fallback_json" | "grounding_json";

export type EngineStatus =
  | { state: "loading"; message: string }
  | { state: "ready"; seconds: number }
  | { state: "failed"; error: string };

type Pending = { resolve: (v: string) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const listeners = new Set<(s: EngineStatus) => void>();
let status: EngineStatus = { state: "loading", message: "Starting engine" };

function setStatus(s: EngineStatus) {
  status = s;
  listeners.forEach((fn) => fn(s));
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker("/engine/worker.js");
  worker.onmessage = (event: MessageEvent) => {
    const data = event.data;
    if (data.type === "progress") setStatus({ state: "loading", message: data.message });
    else if (data.type === "ready") setStatus({ state: "ready", seconds: data.seconds });
    else if (data.type === "fatal") setStatus({ state: "failed", error: data.error });
    else if (typeof data.id === "number") {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.ok) p.resolve(data.result);
      else p.reject(new Error(data.error));
    }
  };
  worker.onerror = (e) => setStatus({ state: "failed", error: e.message || "Worker error" });
  return worker;
}

export function subscribeEngine(fn: (s: EngineStatus) => void): () => void {
  ensureWorker();
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

/** Call a JSON-in/JSON-out function of forecast_core.py. */
export function callEngine(fn: EngineFn, ...args: string[]): Promise<string> {
  const w = ensureWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, fn, args });
  });
}
