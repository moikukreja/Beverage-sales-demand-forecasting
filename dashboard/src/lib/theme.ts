/**
 * Series colours. One fixed colour per model (validated colour-blind-safe on the dark
 * surface); "actual" is near-white ink so the real data always reads first.
 */
import type { ModelKey } from "../types";

export const MODEL_COLORS: Record<ModelKey, string> = {
  naive: "#3987e5",
  arima: "#d95926",
  random_forest: "#199e70",
};

export const ACTUAL_COLOR = "#eef4f8";
export const GRID_COLOR = "rgba(169, 188, 203, 0.12)";
export const AXIS_COLOR = "#6f8598";

export const MODEL_ORDER: ModelKey[] = ["naive", "arima", "random_forest"];

export const MODEL_BLURB: Record<ModelKey, string> = {
  naive: "Next month = last month. The benchmark.",
  arima: "Statistical model; order (p,d,q) picked by AICc from a small grid.",
  random_forest: "300 trees on lag + seasonal-indicator features, forecasting recursively.",
};
