/*
 * Forecast engine worker: runs forecast_core.py (the same file the notebook uses) in
 * the browser through Pyodide, off the main thread so the UI stays responsive.
 *
 * Messages in:  { id, fn, args: string[] }   fn = run_json | payload_json | fallback_json | grounding_json
 * Messages out: { type: "progress", message } | { type: "ready", seconds } | { type: "fatal", error }
 *               { id, ok: true, result } | { id, ok: false, error }
 */
/* global loadPyodide */
const PYODIDE_VERSION = "0.29.5";
const ENGINE_VERSION = "1"; // bump to bust the cached engine file after editing it
importScripts(`https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`);

const progress = (message) => self.postMessage({ type: "progress", message });

async function boot() {
  const started = performance.now();
  progress("Loading Python runtime");
  const pyodide = await loadPyodide();
  progress("Loading numpy, pandas, scikit-learn, statsmodels");
  await pyodide.loadPackage(["numpy", "pandas", "scikit-learn", "statsmodels"]);
  progress("Loading forecast engine");
  const source = await (await fetch(`/py/forecast_core.py?v=${ENGINE_VERSION}`)).text();
  pyodide.FS.writeFile("/home/pyodide/forecast_core.py", source);
  pyodide.runPython("import sys; sys.path.insert(0, '/home/pyodide')");
  const core = pyodide.pyimport("forecast_core");
  self.postMessage({ type: "ready", seconds: (performance.now() - started) / 1000 });
  return core;
}

const corePromise = boot().catch((err) => {
  self.postMessage({ type: "fatal", error: String(err && err.message ? err.message : err) });
  return null;
});

const ALLOWED = new Set(["run_json", "payload_json", "fallback_json", "grounding_json"]);

self.onmessage = async (event) => {
  const { id, fn, args } = event.data;
  const core = await corePromise;
  if (!core) return self.postMessage({ id, ok: false, error: "Engine failed to load." });
  if (!ALLOWED.has(fn)) return self.postMessage({ id, ok: false, error: `Unknown function ${fn}` });
  try {
    const result = core[fn](...args);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    // Python exceptions: keep only the final "ValueError: ..." line for the UI.
    const text = String(err && err.message ? err.message : err).trim().split("\n");
    self.postMessage({ id, ok: false, error: text[text.length - 1] });
  }
};
