/**
 * LLM interpretation of the CURRENT results.
 *
 * 1. The Python engine builds a grounded payload from the live result (+ the model in view).
 * 2. POST /api/interpret (Netlify function, key server-side) returns structured answers.
 * 3. The engine checks every number in the answer against the payload.
 * 4. Any failure -> the engine's rule-based fallback from the same payload.
 * Each new data version or model in view marks the answer stale and (if auto) regenerates.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { callEngine } from "../engine/client";
import type { Grounding, Interpretation, ModelKey, PipelineResult } from "../types";

export interface InterpretationState {
  status: "idle" | "waiting" | "loading" | "done";
  forKey: string | null; // data version + model in view this answer belongs to
  answer: Interpretation | null;
  source: "llm" | "fallback" | null;
  sourceDetail: string;
  grounding: Grounding | null;
  dataVersion: string | null;
  generatedAt: string | null;
}

const FAIL_REASONS: Record<string, string> = {
  not_configured: "LLM not configured on the server (no API key)",
  rate_limited: "LLM rate-limited",
  timeout: "LLM timed out",
  bad_output: "LLM returned an incomplete answer",
  bad_api_key: "LLM API key rejected",
  network: "LLM service unreachable",
  llm_error: "LLM API error",
  server_error: "LLM function error",
};

const CLIENT_TIMEOUT_MS = 12_000;

export function useInterpretation(
  result: PipelineResult | null,
  viewing: ModelKey | "all",
  engineReady: boolean,
) {
  const [auto, setAuto] = useState(true);
  const [state, setState] = useState<InterpretationState>({
    status: "idle", forKey: null, answer: null, source: null, sourceDetail: "",
    grounding: null, dataVersion: null, generatedAt: null,
  });
  const cache = useRef(new Map<string, InterpretationState>());
  const requestId = useRef(0);
  const key = result ? `${result.data_version}:${viewing}` : null;

  const generate = useCallback(async (force = false) => {
    if (!result || !key) return;
    if (!engineReady) {
      setState((s) => ({ ...s, status: "waiting" }));
      return;
    }
    const cached = cache.current.get(key);
    if (cached && !force) {
      setState(cached);
      return;
    }
    const id = ++requestId.current;
    setState((s) => ({ ...s, status: "loading" }));
    try {
      const generatedAt = new Date().toISOString().slice(0, 19) + "Z";

      const payload = JSON.parse(await callEngine("payload_json", JSON.stringify(result), generatedAt));
      if (viewing !== "all") payload.viewing_model = result.models[viewing].label;
      const payloadText = JSON.stringify(payload);

      let answer: Interpretation | null = null;
      let source: "llm" | "fallback" = "fallback";
      let sourceDetail = "";
      try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
        const res = await fetch("/api/interpret", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ payload }),
          signal: controller.signal,
        }).finally(() => window.clearTimeout(timer));
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.interpretation) {
          answer = body.interpretation;
          source = "llm";
          sourceDetail = body.model ?? "LLM";
        } else {
          sourceDetail = FAIL_REASONS[body.code] ?? `LLM unavailable (HTTP ${res.status})`;
        }
      } catch (e) {
        sourceDetail = (e as Error).name === "AbortError" ? FAIL_REASONS.timeout : FAIL_REASONS.network;
      }
      if (!answer) answer = JSON.parse(await callEngine("fallback_json", payloadText));

      const texts = [answer!.seasonality_trends, answer!.best_model, ...answer!.recommendations];
      const grounding: Grounding = JSON.parse(
        await callEngine("grounding_json", JSON.stringify(texts), payloadText),
      );
      const next: InterpretationState = {
        status: "done", forKey: key, answer, source, sourceDetail, grounding,
        dataVersion: result.data_version, generatedAt,
      };
      // Only cache real LLM answers, so a later retry can still reach the LLM.
      if (source === "llm") cache.current.set(key, next);
      if (id === requestId.current) setState(next);
    } catch (e) {
      // Engine failure: nothing grounded to show, so say so instead of guessing.
      if (id === requestId.current)
        setState((s) => ({ ...s, status: "done", forKey: key, answer: null, source: null,
          sourceDetail: `Engine error: ${(e as Error).message}`, grounding: null }));
    }
  }, [result, key, viewing, engineReady]);

  // New data or a different model in view -> mark stale, regenerate after a pause.
  useEffect(() => {
    if (!key) return;
    if (!auto) return;
    const handle = window.setTimeout(() => void generate(), 1200);
    return () => window.clearTimeout(handle);
  }, [key, auto, generate]);

  return { ...state, stale: state.forKey !== key, auto, setAuto, regenerate: () => generate(true) };
}
