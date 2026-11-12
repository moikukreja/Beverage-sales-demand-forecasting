/** Shapes returned by forecast_core.py (run_pipeline / build_llm_payload). */

export type ModelKey = "naive" | "arima" | "random_forest";
export type Source = "history" | "live feed" | "manual" | "edited";

export interface MonthRecord {
  month: string; // YYYY-MM
  units: number;
  days?: number; // days observed (defaults to calendar days)
  source?: Source;
}

export interface TestPoint {
  month: string;
  actual: number;
  pred: number;
  lo: number | null;
  hi: number | null;
}

export interface ForecastPoint {
  month: string;
  pred: number;
  lo: number | null;
  hi: number | null;
}

export interface Metrics {
  mape: number | null;
  wape: number | null;
  bias_pct: number | null;
  mape_skipped: number;
  n: number;
}

export interface ModelResult {
  key: ModelKey;
  label: string;
  error?: string;
  test?: TestPoint[];
  metrics?: Metrics;
  forecast?: ForecastPoint[];
  forecast_total?: number;
  details?: Record<string, unknown>;
  details_full_fit?: Record<string, unknown>;
}

export interface FeatureRow {
  month: string;
  units: number;
  days: number;
  target: number;
  lag_1: number | null;
  lag_2: number | null;
  lag_3: number | null;
  roll_mean_3: number | null;
  t: number;
  month_num: number;
  month_sin: number;
  month_cos: number;
  quarter: number;
  days_in_month: number;
}

export interface MonthProfile {
  month_of_year: number;
  observations: number;
  raw_index: number;
  per_day_index: number;
}

export interface Analysis {
  n_months: number;
  first_month: string;
  last_month: string;
  full_years_observed: number;
  mean_units: number;
  min_units: number;
  max_units: number;
  min_month: string;
  max_month: string;
  trend_units_per_day_per_month: number;
  trend_pct_per_month: number;
  cv_raw_pct: number;
  cv_per_day_pct: number;
  calendar_share_of_variation_pct: number;
  month_profile: MonthProfile[];
}

export interface PipelineResult {
  settings: { test_size: number; horizon: number; calendar_adjusted: boolean };
  data_version: string;
  split: { train_months: number; test_months: number; train_end: string; test_start: string };
  series: Required<MonthRecord>[];
  features: FeatureRow[];
  models: Record<ModelKey, ModelResult>;
  best_model: ModelKey | null;
  analysis: Analysis;
  distribution: {
    months_covered?: number;
    region_share_pct?: Record<string, number>;
    channel_share_pct?: Record<string, number>;
  };
  sources: Record<string, number>;
}

export interface Interpretation {
  seasonality_trends: string;
  best_model: string;
  recommendations: string[];
  caveats: string[];
}

export interface Grounding {
  numbers_checked: number;
  ungrounded: string[];
  grounded: boolean;
}

export type Breakdown = Record<string, { regions: Record<string, number>; channels: Record<string, number> }>;
