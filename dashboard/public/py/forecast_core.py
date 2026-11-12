"""
forecast_core.py - shared forecasting engine.

One file, two runtimes:
  * the Jupyter notebook (notebook/beverage_forecasting.ipynb) - its engine cells are
    generated from the "# %%" blocks below, so the notebook shows exactly this code;
  * the React dashboard, where it runs in the browser through Pyodide (WebAssembly).

Because both use the same code and the same library versions, the dashboard's
numbers match the notebook's.
"""

# %% [imports]
import calendar
import hashlib
import json
import re
import warnings

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from statsmodels.tsa.arima.model import ARIMA

SEED = 42          # fixed seed -> reproducible Random Forest
N_LAGS = 3         # lag features: sales 1, 2 and 3 months back
MIN_TRAIN = 6      # smallest training window: 3 lags + at least 3 usable rows
MAX_TEST = 6
MAX_HORIZON = 6
Z95 = 1.959964     # z-value for a 95% interval
MAPE_EPS = 1.0     # actuals with |A| <= 1 unit are treated as zero and skipped by MAPE

MODEL_KEYS = ["naive", "arima", "random_forest"]
MODEL_LABELS = {"naive": "Naive", "arima": "ARIMA", "random_forest": "Random Forest"}


# %% [calendar]
def days_in_month(month: str) -> int:
    """Number of calendar days in a 'YYYY-MM' month (28-31)."""
    year, mon = map(int, month.split("-"))
    return calendar.monthrange(year, mon)[1]


def next_month(month: str) -> str:
    """'2021-12' -> '2022-01'."""
    year, mon = map(int, month.split("-"))
    year, mon = (year + 1, 1) if mon == 12 else (year, mon + 1)
    return f"{year:04d}-{mon:02d}"


def future_months(last: str, horizon: int) -> list:
    """The `horizon` months that follow `last`."""
    out, cur = [], last
    for _ in range(horizon):
        cur = next_month(cur)
        out.append(cur)
    return out


# %% [prepare]
def prepare_series(records) -> pd.DataFrame:
    """Validate and tidy a monthly series.

    records: list of dicts with 'month' ('YYYY-MM'), 'units', and optionally
    'days' (days actually observed in that month) and 'source'.
    Months must be consecutive - a gap would silently break lag features.
    """
    df = pd.DataFrame(list(records))
    if df.empty or "month" not in df or "units" not in df:
        raise ValueError("Series needs 'month' and 'units' columns.")
    df["month"] = df["month"].astype(str).str.slice(0, 7)
    df = df.sort_values("month").drop_duplicates("month", keep="last").reset_index(drop=True)
    for prev, cur in zip(df["month"][:-1], df["month"][1:]):
        if next_month(prev) != cur:
            raise ValueError(f"Months must be consecutive: gap between {prev} and {cur}.")
    df["units"] = pd.to_numeric(df["units"], errors="raise").astype(float)
    if (df["units"] < 0).any():
        raise ValueError("Units cannot be negative.")
    if "days" not in df:
        df["days"] = np.nan
    df["days"] = df["days"].fillna(df["month"].map(days_in_month)).astype(float)
    if "source" not in df:
        df["source"] = "history"
    df["source"] = df["source"].fillna("history")
    return df[["month", "units", "days", "source"]]


# %% [features]
FEATURE_COLS = ["lag_1", "lag_2", "lag_3", "roll_mean_3", "t",
                "month_sin", "month_cos", "days_in_month"]


def build_features(df: pd.DataFrame, adjust: bool = True) -> pd.DataFrame:
    """Task 1 - lag features and seasonal indicators.

    adjust=True models units per day (calendar adjustment): a 28-day February
    then no longer looks like a demand drop. Lags only look backwards (shift),
    so no future information leaks into a row.
    """
    out = df[["month", "units", "days"]].copy()
    out["target"] = out["units"] / out["days"] if adjust else out["units"]
    for k in range(1, N_LAGS + 1):
        out[f"lag_{k}"] = out["target"].shift(k)
    out["roll_mean_3"] = out["target"].shift(1).rolling(3).mean()
    out["t"] = np.arange(len(out))                      # time index -> trend
    month_num = out["month"].str.slice(5, 7).astype(int)
    out["month_num"] = month_num
    out["month_sin"] = np.sin(2 * np.pi * month_num / 12)  # cyclical month encoding
    out["month_cos"] = np.cos(2 * np.pi * month_num / 12)
    out["quarter"] = (month_num - 1) // 3 + 1
    out["days_in_month"] = out["month"].map(days_in_month)
    return out


def _feature_row(history, t, month):
    """Feature vector for one month, built only from values before it."""
    m = int(month[5:7])
    return [history[-1], history[-2], history[-3], float(np.mean(history[-3:])), t,
            np.sin(2 * np.pi * m / 12), np.cos(2 * np.pi * m / 12), days_in_month(month)]


# %% [models]
class NaiveModel:
    """Next month = last observed month. The benchmark every model must beat."""

    def fit(self, target, months):
        self.y = np.asarray(target, float)
        diffs = np.diff(self.y)
        # spread of month-to-month changes drives the random-walk interval
        self.sigma = float(np.std(diffs, ddof=1)) if len(diffs) >= 2 else float("nan")
        return self

    def forecast(self, months):
        h = len(months)
        mean = np.repeat(self.y[-1], h)
        spread = Z95 * self.sigma * np.sqrt(np.arange(1, h + 1))
        return mean, mean - spread, mean + spread

    def describe(self):
        return {"rule": "forecast = last observed value",
                "interval": "95% random-walk band (1.96 x sd of monthly changes x sqrt(h))"}


ARIMA_GRID = [(p, d, q) for d in (0, 1) for p in (0, 1) for q in (0, 1)]


class ArimaModel:
    """ARIMA(p,d,q) with p,d,q in {0,1}, chosen by AICc.

    A small grid on purpose: with 6-12 points, larger or seasonal models
    cannot be estimated reliably.
    """

    def fit(self, target, months):
        y = np.asarray(target, float)
        best = None
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")  # tiny samples trigger convergence warnings
            for order in ARIMA_GRID:
                trend = "c" if order[1] == 0 else "n"
                try:
                    res = ARIMA(y, order=order, trend=trend).fit()
                except Exception:
                    continue
                if np.isfinite(res.aicc) and (best is None or res.aicc < best[0]):
                    best = (float(res.aicc), order, res)
        if best is None:
            raise RuntimeError("No ARIMA order could be fitted.")
        self.aicc, self.order, self.res = best
        return self

    def forecast(self, months):
        fc = self.res.get_forecast(len(months))
        ci = np.asarray(fc.conf_int(alpha=0.05))
        return np.asarray(fc.predicted_mean), ci[:, 0], ci[:, 1]

    def describe(self):
        return {"order": f"({self.order[0]},{self.order[1]},{self.order[2]})",
                "aicc": round(self.aicc, 2),
                "interval": "95% ARIMA prediction interval"}


class RandomForestModel:
    """Random Forest on lag + seasonal-indicator features, forecasting recursively
    (each prediction becomes the next month's lag_1)."""

    def fit(self, target, months):
        target = list(map(float, target))
        X = [_feature_row(target[:i], i, months[i]) for i in range(N_LAGS, len(target))]
        y = target[N_LAGS:]
        if len(y) < 3:
            raise RuntimeError("Random Forest needs at least 3 rows after creating lags.")
        self.rf = RandomForestRegressor(n_estimators=300, random_state=SEED)
        self.rf.fit(np.array(X), np.array(y))
        self.history, self.n, self.rows = target, len(target), len(y)
        return self

    def forecast(self, months):
        hist, means, lows, highs = list(self.history), [], [], []
        for k, month in enumerate(months):
            x = np.array([_feature_row(hist, self.n + k, month)])
            trees = np.array([tree.predict(x)[0] for tree in self.rf.estimators_])
            mean = float(trees.mean())
            means.append(mean)
            lows.append(float(np.percentile(trees, 2.5)))
            highs.append(float(np.percentile(trees, 97.5)))
            hist.append(mean)
        return np.array(means), np.array(lows), np.array(highs)

    def describe(self):
        return {"features": FEATURE_COLS, "training_rows": self.rows, "trees": 300,
                "interval": "2.5-97.5% spread of the 300 trees (not a calibrated interval)"}


MODEL_CLASSES = {"naive": NaiveModel, "arima": ArimaModel, "random_forest": RandomForestModel}


# %% [metrics]
def mape(actual, forecast, eps=MAPE_EPS):
    """MAPE = 100/n * sum(|A - F| / |A|), over months where |A| > eps.

    Zero or near-zero actuals would divide by ~0, so they are skipped and counted.
    Returns (value or None, number_of_months_skipped).
    """
    a, f = np.asarray(actual, float), np.asarray(forecast, float)
    keep = np.abs(a) > eps
    if not keep.any():
        return None, int((~keep).sum())
    return float(100 * np.mean(np.abs(a[keep] - f[keep]) / np.abs(a[keep]))), int((~keep).sum())


def wape(actual, forecast):
    """WAPE = 100 * sum|A - F| / sum|A|. Undefined (None) when all actuals are 0."""
    a, f = np.asarray(actual, float), np.asarray(forecast, float)
    denom = np.abs(a).sum()
    return None if denom == 0 else float(100 * np.abs(a - f).sum() / denom)


def bias_pct(actual, forecast):
    """Bias = 100 * sum(F - A) / sum(A). Positive = over-forecast (risk of overstock)."""
    a, f = np.asarray(actual, float), np.asarray(forecast, float)
    denom = a.sum()
    return None if denom == 0 else float(100 * (f - a).sum() / denom)


def score(actual, forecast):
    m, skipped = mape(actual, forecast)
    return {"mape": m, "wape": wape(actual, forecast), "bias_pct": bias_pct(actual, forecast),
            "mape_skipped": skipped, "n": len(actual)}


# %% [analysis]
def describe_series(df: pd.DataFrame) -> dict:
    """Trend and seasonality facts the interpretation is based on."""
    units = df["units"].to_numpy(float)
    per_day = units / df["days"].to_numpy(float)
    n = len(df)
    t = np.arange(n)
    slope_day = float(np.polyfit(t, per_day, 1)[0]) if n >= 2 else 0.0
    mean_days = float(df["days"].mean())
    var_raw = float(np.var(units))
    # share of month-to-month variation that is only "different month lengths"
    calendar_share = 0.0 if var_raw == 0 else float(
        np.clip(1 - np.var(per_day * mean_days) / var_raw, 0, 1))
    moy = df["month"].str.slice(5, 7)
    profile = []
    for m in sorted(moy.unique()):
        mask = (moy == m).to_numpy()
        profile.append({"month_of_year": int(m), "observations": int(mask.sum()),
                        "raw_index": float(units[mask].mean() / units.mean()),
                        "per_day_index": float(per_day[mask].mean() / per_day.mean())})
    return {
        "n_months": n, "first_month": df["month"].iloc[0], "last_month": df["month"].iloc[-1],
        "full_years_observed": n // 12,
        "mean_units": float(units.mean()), "min_units": float(units.min()),
        "max_units": float(units.max()),
        "min_month": df["month"].iloc[int(units.argmin())],
        "max_month": df["month"].iloc[int(units.argmax())],
        "trend_units_per_day_per_month": slope_day,
        "trend_pct_per_month": float(100 * slope_day / per_day.mean()),
        "cv_raw_pct": float(100 * units.std() / units.mean()),
        "cv_per_day_pct": float(100 * per_day.std() / per_day.mean()),
        "calendar_share_of_variation_pct": 100 * calendar_share,
        "month_profile": profile,
    }


def distribution_shares(breakdown, months) -> dict:
    """Region and channel shares over the given months (from the raw order data)."""
    if not breakdown:
        return {}
    regions, channels = {}, {}
    for m in months:
        b = breakdown.get(m)
        if not b:
            continue
        for k, v in b["regions"].items():
            regions[k] = regions.get(k, 0) + v
        for k, v in b["channels"].items():
            channels[k] = channels.get(k, 0) + v
    if not regions:
        return {}
    rt, ct = sum(regions.values()), sum(channels.values())
    reg = sorted(((k, 100 * v / rt) for k, v in regions.items()), key=lambda kv: -kv[1])
    return {"months_covered": sum(1 for m in months if m in breakdown),
            "region_share_pct": {k: v for k, v in reg},
            "channel_share_pct": {k: 100 * v / ct for k, v in channels.items()}}


# %% [pipeline]
def _clean(obj):
    """Make results JSON-safe: numpy -> python, NaN/inf -> None."""
    if isinstance(obj, dict):
        return {str(k): _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        return None if not np.isfinite(obj) else float(obj)
    return obj


def data_version(records, settings) -> str:
    """Short hash of the data + settings: any change -> new version."""
    blob = json.dumps({"r": [[r["month"], float(r["units"])] for r in records], "s": settings},
                      sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:10]


def run_pipeline(records, test_size=3, horizon=3, adjust=True, breakdown=None) -> dict:
    """Tasks 1-5 end to end: features, chronological split, train, test, forecast, score.

    All models get the same split, horizon and calendar setting (a fair comparison).
    The test forecast is made from the training window only; the future forecast is
    made after refitting on all available months.
    """
    df = prepare_series(records)
    n = len(df)
    if n < MIN_TRAIN + 1:
        raise ValueError(f"Need at least {MIN_TRAIN + 1} months of data.")
    test_size = int(np.clip(test_size, 1, min(MAX_TEST, n - MIN_TRAIN)))
    horizon = int(np.clip(horizon, 1, MAX_HORIZON))
    feats = build_features(df, adjust)
    target, months = feats["target"].to_numpy(float), list(df["month"])
    days, actual = df["days"].to_numpy(float), df["units"].to_numpy(float)
    split = n - test_size                                   # chronological split point
    fut_months = future_months(months[-1], horizon)
    fut_days = np.array([days_in_month(m) for m in fut_months], float)

    def to_units(values, d):
        return np.asarray(values) * d if adjust else np.asarray(values)

    models = {}
    for key in MODEL_KEYS:
        entry = {"key": key, "label": MODEL_LABELS[key]}
        try:
            fitted = MODEL_CLASSES[key]().fit(target[:split], months[:split])
            mean, lo, hi = (to_units(v, days[split:]) for v in fitted.forecast(months[split:]))
            entry["test"] = [{"month": months[split + i], "actual": actual[split + i],
                              "pred": mean[i], "lo": max(lo[i], 0), "hi": hi[i]}
                             for i in range(test_size)]
            entry["metrics"] = score(actual[split:], mean)
            entry["details"] = fitted.describe()
            final = MODEL_CLASSES[key]().fit(target, months)
            fmean, flo, fhi = (to_units(v, fut_days) for v in final.forecast(fut_months))
            entry["forecast"] = [{"month": fut_months[i], "pred": fmean[i],
                                  "lo": max(flo[i], 0), "hi": fhi[i]} for i in range(horizon)]
            entry["forecast_total"] = float(np.sum(fmean))
            entry["details_full_fit"] = final.describe()
        except Exception as exc:  # one model failing must not break the others
            entry["error"] = str(exc)
        models[key] = entry

    scored = [m for m in models.values() if m.get("metrics", {}).get("wape") is not None]
    best = min(scored, key=lambda m: (m["metrics"]["wape"], m["metrics"]["mape"] or 0))["key"] \
        if scored else None
    settings = {"test_size": test_size, "horizon": horizon, "calendar_adjusted": bool(adjust)}
    recs = df.to_dict("records")
    return _clean({
        "settings": settings,
        "data_version": data_version(recs, settings),
        "split": {"train_months": split, "test_months": test_size,
                  "train_end": months[split - 1], "test_start": months[split]},
        "series": recs,
        "features": feats.to_dict("records"),
        "models": models,
        "best_model": best,
        "analysis": describe_series(df),
        "distribution": distribution_shares(breakdown, months),
        "sources": df["source"].value_counts().to_dict(),
    })


# %% [llm]
SYSTEM_PROMPT = """You are an operations analytics assistant for a beverage company that \
launched a new flavored water product. You receive a JSON object with the CURRENT results of \
a monthly sales forecasting exercise (data, settings, model metrics, forecasts, trend and \
seasonality statistics, distribution shares, and known limitations).

Answer the three questions of the lab exercise:
1. seasonality_trends: How well did the models capture seasonality or trends?
2. best_model: Which model performed best and why?
3. recommendations: What recommendations would you give the company for production and \
distribution? (3-4 items, one sentence each)
Also list the most important caveats (2-4 items) drawn from known_limitations.

Rules:
- Use ONLY numbers that appear in the JSON. You may round them, but never invent, estimate \
or compute new figures. If something is not in the JSON, say it is not known.
- MAPE and WAPE are percentages; lower is better. The best model is the one named in best_model.
- If viewing_model is present, the user is looking at that model: also comment on it specifically in seasonality_trends.
- Be specific and concise: 2-4 sentences per answer, plain business English, no markdown."""


def _r(x, nd=0):
    return None if x is None else round(float(x), nd)


def build_llm_payload(result, generated_at=None) -> dict:
    """The grounded context sent to the LLM - compact, rounded, nothing invented."""
    a, st, sp = result["analysis"], result["settings"], result["split"]
    models = {}
    for m in result["models"].values():
        if "error" in m:
            models[m["label"]] = {"error": m["error"]}
            continue
        mt = m["metrics"]
        models[m["label"]] = {
            "test_MAPE_pct": _r(mt["mape"], 2), "test_WAPE_pct": _r(mt["wape"], 2),
            "test_bias_pct": _r(mt["bias_pct"], 2),
            "test_months": [{"month": t["month"], "actual": _r(t["actual"]),
                             "predicted": _r(t["pred"])} for t in m["test"]],
            "forecast": [{"month": f["month"], "units": _r(f["pred"]),
                          "low_95": _r(f["lo"]), "high_95": _r(f["hi"])} for f in m["forecast"]],
            "forecast_total_units": _r(m["forecast_total"]),
            "model_details_test_fit": m["details"],
            "model_details_final_fit": m["details_full_fit"],
        }
    best = result["best_model"]
    dist = result.get("distribution") or {}
    regions = list((dist.get("region_share_pct") or {}).items())
    n = a["n_months"]
    limits = ["The dataset is synthetic (Kaggle 'Beverage Sales', simulated orders), so it shows "
              "no real weather-driven peak such as a summer high for water."]
    if n < 24:
        limits.append(f"Only {n} months of history (less than two full years), so true "
                      "seasonality cannot be separated from noise; 12-month seasonal lags and "
                      "seasonal ARIMA cannot be used.")
    limits.append(f"Models were tested on only {st['test_size']} month(s) after training on "
                  f"{sp['train_months']}, so the error metrics rest on very few points.")
    rf = result["models"].get("random_forest", {})
    if "details" in rf:
        limits.append(f"Random Forest was trained on only {rf['details']['training_rows']} rows "
                      "(lags remove the first 3 months) and cannot extrapolate a trend.")
    if st["calendar_adjusted"]:
        limits.append("Sales were modelled per day and scaled by days in each month, because "
                      "28-31 day months otherwise look like demand changes.")
    return _clean({
        "product": "Volvic Touch flavored water (stand-in for the new flavored water product)",
        "data_window": f"{a['first_month']} to {a['last_month']}",
        "n_months": n,
        "data_sources": result.get("sources", {}),
        "data_version": result["data_version"],
        "generated_at": generated_at,
        "settings": {"test_months": st["test_size"], "forecast_horizon_months": st["horizon"],
                     "calendar_adjusted": st["calendar_adjusted"],
                     "train_window": f"{a['first_month']} to {sp['train_end']}"},
        "trend_and_seasonality": {
            "mean_monthly_units": _r(a["mean_units"]),
            "lowest_month": {"month": a["min_month"], "units": _r(a["min_units"])},
            "highest_month": {"month": a["max_month"], "units": _r(a["max_units"])},
            "trend_pct_per_month": _r(a["trend_pct_per_month"], 2),
            "month_to_month_variation_cv_pct": _r(a["cv_raw_pct"], 2),
            "variation_after_calendar_adjustment_cv_pct": _r(a["cv_per_day_pct"], 2),
            "share_of_variation_explained_by_month_length_pct":
                _r(a["calendar_share_of_variation_pct"], 1),
            "full_years_observed": a["full_years_observed"],
        },
        "models": models,
        "best_model": MODEL_LABELS.get(best) if best else None,
        "distribution": {
            "top_regions_share_pct": {k: _r(v, 1) for k, v in regions[:3]},
            "bottom_regions_share_pct": {k: _r(v, 1) for k, v in regions[-3:]},
            "channel_share_pct": {k: _r(v, 1) for k, v in
                                  (dist.get("channel_share_pct") or {}).items()},
        } if regions else "not available",
        "known_limitations": limits,
    })


def _fmt(x, nd=0):
    return f"{x:,.{nd}f}"


def fallback_interpretation(payload) -> dict:
    """Rule-based answer to the three questions, built only from the payload.
    Used when the LLM is unavailable, rate-limited or returns invalid output."""
    ts = payload["trend_and_seasonality"]
    best = payload.get("best_model")
    models = {k: v for k, v in payload["models"].items() if "error" not in v}
    trend = ts["trend_pct_per_month"]
    direction = "essentially flat" if abs(trend) < 0.5 else ("rising" if trend > 0 else "falling")
    q1 = (f"Sales are {direction} at {trend}% per month on average. Month-to-month variation is "
          f"{ts['month_to_month_variation_cv_pct']}% (CV) and "
          f"{ts['share_of_variation_explained_by_month_length_pct']}% of it is explained by month "
          f"length alone; after adjusting for days it falls to "
          f"{ts['variation_after_calendar_adjustment_cv_pct']}%. With "
          f"{ts['full_years_observed']} full year(s) of data, true seasonality cannot be confirmed.")
    if best and best in models:
        b = models[best]
        others = "; ".join(f"{k} {v['test_WAPE_pct']}%" for k, v in models.items() if k != best)
        details = b.get("model_details_test_fit", {})
        ties = [k for k, v in models.items() if k != best and v["test_WAPE_pct"] == b["test_WAPE_pct"]]
        if best == "Naive":
            why = ("the series is nearly flat, so the last observed month is hard to beat and "
                   "more complex models have very few points to learn from.")
        elif best == "ARIMA" and details.get("order") == "(0,1,0)":
            why = ("AICc selected ARIMA(0,1,0), a random walk that equals the Naive forecast: the "
                   "data shows no autocorrelation worth modelling.")
        elif best == "ARIMA":
            why = (f"the selected ARIMA{details.get('order', '')} captured the short-term "
                   "dependence between consecutive months better than the alternatives.")
        else:
            why = (f"its lag and calendar features tracked the recent level, but it learned from "
                   f"only {details.get('training_rows', 'a few')} rows, so the advantage is small "
                   "and may not persist.")
        tie_txt = f" It tied with {', '.join(ties)}." if ties else ""
        q2 = (f"{best} performed best with a test WAPE of {b['test_WAPE_pct']}% and MAPE of "
              f"{b['test_MAPE_pct']}% (others' WAPE: {others}) because {why}{tie_txt}")
        fc = b["forecast"]
        recs = [f"Plan production on the {best} forecast of {_fmt(b['forecast_total_units'])} units "
                f"for {fc[0]['month']} to {fc[-1]['month']}.",
                f"Hold safety stock sized to the {b['test_WAPE_pct']}% WAPE error rather than "
                "the narrow point forecast.",
                "Re-run the forecast each month as new actuals arrive and track bias "
                f"(currently {b['test_bias_pct']}%)."]
    else:
        q2 = "No model could be scored with the current data."
        recs = ["Collect more months of data before committing to a production plan."]
    dist = payload.get("distribution")
    if isinstance(dist, dict) and dist.get("top_regions_share_pct"):
        top = ", ".join(f"{k} ({v}%)" for k, v in dist["top_regions_share_pct"].items())
        ch = ", ".join(f"{k} {v}%" for k, v in dist["channel_share_pct"].items())
        recs.append(f"Prioritise distribution capacity for the largest regions, {top}, and the "
                    f"main channel mix ({ch}).")
    return {"seasonality_trends": q1, "best_model": q2, "recommendations": recs,
            "caveats": payload["known_limitations"][:4]}


# %% [grounding]
_NUM = re.compile(r"(?<![\w.])[-−]?\d[\d,]*(?:\.\d+)?\s*(k|K|M)?(?![\w])")


def _payload_numbers(obj, out):
    if isinstance(obj, dict):
        for v in obj.values():
            _payload_numbers(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _payload_numbers(v, out)
    elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
        out.append(abs(float(obj)))
    elif isinstance(obj, str):
        for m in re.finditer(r"\d+(?:\.\d+)?", obj):
            out.append(float(m.group()))
    return out


def check_grounding(texts, payload) -> dict:
    """Check every number in the LLM answer against the numbers in the payload.

    Years, small counts (<= 12) and common constants are ignored. A number counts as
    grounded if it is within 1% (or 0.06 for small values) of a payload number."""
    known = _payload_numbers(payload, []) + [95.0, 100.0]
    found, ungrounded = 0, []
    for text in texts:
        for m in _NUM.finditer(text):
            raw = m.group(0).strip()
            num = raw.rstrip("kKM").strip().replace(",", "").replace("−", "-")
            try:
                val = abs(float(num))
            except ValueError:
                continue
            if m.group(1) in ("k", "K"):
                val *= 1_000
            elif m.group(1) == "M":
                val *= 1_000_000
            if (val.is_integer() and (val <= 12 or 1990 <= val <= 2100)):
                continue
            found += 1
            tol = max(0.01 * val, 0.06)
            if not any(abs(val - k) <= max(tol, 0.01 * k) for k in known):
                ungrounded.append(raw)
    return {"numbers_checked": found, "ungrounded": sorted(set(ungrounded)),
            "grounded": len(ungrounded) == 0}


# %% [api]
def run_json(params_json: str) -> str:
    """Entry point for the dashboard's Pyodide worker (JSON in, JSON out)."""
    p = json.loads(params_json)
    return json.dumps(run_pipeline(p["records"], p.get("test_size", 3), p.get("horizon", 3),
                                   p.get("adjust", True), p.get("breakdown")))


def payload_json(result_json: str, generated_at: str) -> str:
    return json.dumps(build_llm_payload(json.loads(result_json), generated_at))


def fallback_json(payload_json_str: str) -> str:
    return json.dumps(fallback_interpretation(json.loads(payload_json_str)))


def grounding_json(texts_json: str, payload_json_str: str) -> str:
    return json.dumps(check_grounding(json.loads(texts_json), json.loads(payload_json_str)))
