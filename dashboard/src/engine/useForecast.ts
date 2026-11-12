/**
 * Dashboard state: the monthly series (first year + newly arriving months), the
 * settings, and the latest pipeline result from the Python engine.
 *
 * Until the engine has loaded, the default view is served from default_results.json,
 * which the notebook exported by running the same code with the same settings.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callEngine, subscribeEngine, type EngineStatus } from "./client";
import { nextMonth } from "../lib/format";
import type { Breakdown, MonthRecord, PipelineResult } from "../types";

export const FIRST_YEAR = 12;
export const MIN_MONTHS = 7; // engine needs MIN_TRAIN (6) + 1 test month

export interface Settings {
  testSize: number;
  horizon: number;
  adjust: boolean;
}

export const DEFAULT_SETTINGS: Settings = { testSize: 3, horizon: 3, adjust: true };

export function useForecast() {
  const [feed, setFeed] = useState<MonthRecord[]>([]);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [series, setSeries] = useState<MonthRecord[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [engine, setEngine] = useState<EngineStatus>({ state: "loading", message: "Starting engine" });
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const runId = useRef(0);
  const isDefault = useRef(true);

  // Static data: the monthly series, region/channel breakdown, default results.
  useEffect(() => {
    Promise.all([
      fetch("/data/volvic_touch_monthly.json").then((r) => r.json()),
      fetch("/data/breakdown.json").then((r) => r.json()),
      fetch("/data/default_results.json").then((r) => r.json()),
    ])
      .then(([monthly, bd, defaults]: [MonthRecord[], Breakdown, PipelineResult]) => {
        setFeed(monthly);
        setBreakdown(bd);
        setSeries(monthly.slice(0, FIRST_YEAR).map((r) => ({ ...r, source: "history" })));
        setResult(defaults);
      })
      .catch(() => setLoadError("Could not load the sales data."));
  }, []);

  useEffect(() => subscribeEngine(setEngine), []);

  // Re-run the pipeline whenever data or settings change (debounced).
  useEffect(() => {
    if (!series.length || !breakdown || engine.state !== "ready") return;
    if (isDefault.current) return; // default view already computed by the notebook
    const id = ++runId.current;
    setComputing(true);
    const handle = window.setTimeout(() => {
      const params = {
        records: series,
        test_size: settings.testSize,
        horizon: settings.horizon,
        adjust: settings.adjust,
        breakdown,
      };
      callEngine("run_json", JSON.stringify(params))
        .then((text) => {
          if (id !== runId.current) return; // a newer run superseded this one
          setResult(JSON.parse(text));
          setError(null);
        })
        .catch((e: Error) => id === runId.current && setError(e.message))
        .finally(() => id === runId.current && setComputing(false));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [series, settings, breakdown, engine.state]);

  const touch = () => {
    isDefault.current = false;
  };

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    touch();
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const lastMonth = series.length ? series[series.length - 1].month : null;
  const nextFeedMonth = useMemo(() => {
    if (!lastMonth) return null;
    const target = nextMonth(lastMonth);
    return feed.find((r) => r.month === target) ?? null;
  }, [feed, lastMonth]);

  /** Real-time feed: the next actual month "arrives". */
  const advanceMonth = useCallback(() => {
    if (!nextFeedMonth) return;
    touch();
    setSeries((s) => [...s, { ...nextFeedMonth, source: "live feed" }]);
  }, [nextFeedMonth]);

  /** Manually add the next month's actual sales. */
  const addMonth = useCallback((units: number) => {
    touch();
    setSeries((s) => [...s, { month: nextMonth(s[s.length - 1].month), units, source: "manual" }]);
  }, []);

  /** Correct an existing month's actual sales. */
  const editMonth = useCallback((month: string, units: number) => {
    touch();
    setSeries((s) => s.map((r) => (r.month === month ? { ...r, units, source: "edited" } : r)));
  }, []);

  const removeLast = useCallback(() => {
    touch();
    setSeries((s) => (s.length > MIN_MONTHS ? s.slice(0, -1) : s));
  }, []);

  const reset = useCallback(() => {
    touch();
    setSettings(DEFAULT_SETTINGS);
    setSeries(feed.slice(0, FIRST_YEAR).map((r) => ({ ...r, source: "history" })));
  }, [feed]);

  return {
    feed, series, settings, result, engine, computing, error, loadError, nextFeedMonth,
    updateSettings, advanceMonth, addMonth, editMonth, removeLast, reset,
  };
}
