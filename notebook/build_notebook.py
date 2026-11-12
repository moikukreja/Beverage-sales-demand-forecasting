"""Builds beverage_forecasting.ipynb.

The engine cells are copied verbatim from dashboard/public/py/forecast_core.py, so the
notebook and the dashboard always run the same code. Re-run this script after editing
the engine, then execute the notebook:

    python notebook/build_notebook.py
    jupyter nbconvert --to notebook --execute --inplace notebook/beverage_forecasting.ipynb
"""
import json
import re
from pathlib import Path

import nbformat as nbf

ROOT = Path(__file__).resolve().parent
CORE = (ROOT.parent / "dashboard" / "public" / "py" / "forecast_core.py").read_text(encoding="utf-8")
BLOCKS = dict(re.findall(r"# %% \[(\w+)\]\n(.*?)(?=\n# %% \[|\Z)", CORE, flags=re.S))

# The Netlify LLM function uses the same system prompt: export it as JSON (single source).
import importlib.util
_spec = importlib.util.spec_from_file_location("forecast_core", ROOT.parent / "dashboard" / "public" / "py" / "forecast_core.py")
_core = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_core)
_prompt = _core.SYSTEM_PROMPT
(ROOT.parent / "dashboard" / "netlify" / "lib" / "system_prompt.json").write_text(
    json.dumps({"system_prompt": _prompt}, indent=2), encoding="utf-8")

cells = []


def md(text):
    cells.append(nbf.v4.new_markdown_cell(text.strip()))


def code(text):
    cells.append(nbf.v4.new_code_cell(text.strip()))


def engine(name):
    code(f"# --- engine block '{name}' (identical to dashboard/public/py/forecast_core.py) ---\n"
         + BLOCKS[name])


# ----------------------------------------------------------------------------------------
md("""
# Forecasting Monthly Sales for a New Beverage Product
**AI in Operations – Session II Lab Activity** · MAIB, SP Jain School of Global Management

**Scenario.** A beverage company has launched a new flavored water product in regional markets.
It has collected monthly sales for the first year and wants to forecast the coming months to
optimise production and distribution.

**What this notebook does (the seven lab tasks):**

| # | Task | Section |
|---|------|---------|
| 1 | Preprocess: lag features and seasonal indicators | §4 |
| 2 | Choose forecasting models: Naive, ARIMA, Random Forest | §5 |
| 3 | Train and test with a chronological train-test split | §7 |
| 4 | Forecast the next 3 months | §8 |
| 5 | Evaluate with MAPE and WAPE | §6, §9 |
| 6 | Plot actual vs predicted sales | §10 |
| 7 | Interpret: seasonality and trends, best model and why, recommendations | §11 |
| + | **LLM interpretation based on real-time data** | §12 |

**Data.** Kaggle *Beverage Sales* (SWillm, 2025, MIT licence): about 9 million synthetic order
lines from German wholesalers, 2021-2023. We use **Volvic Touch**, the dataset's only *flavored*
water, as a stand-in for the new product, and treat **2021 as its first year**.
""")

md("""
## 1. Setup
Imports, file paths and a consistent colour palette. The palette (one fixed colour per model)
was checked for colour-blind safety, and every chart also carries a legend or direct labels.
The forecasting engine below is the same Python file the dashboard runs in the browser.
""")
engine("imports")
md("Calendar helpers used throughout (days in a month, next month).")
engine("calendar")
code("""
import os
from datetime import datetime, timezone
from pathlib import Path

import matplotlib.pyplot as plt
from IPython.display import display, Markdown

ROOT = Path.cwd().parent if Path.cwd().name == "notebook" else Path.cwd()
RAW_CSV = ROOT / "data" / "synthetic_beverage_sales_data.csv"
EXPORT_DIR = ROOT / "dashboard" / "public" / "data"
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

PRODUCT = "Volvic Touch"     # the flavored water used as the new product
FIRST_YEAR = 12              # months in the product's first year (Jan-Dec 2021)

# Fixed colour per series (validated categorical palette)
INK = "#1f2328"
COLORS = {"actual": INK, "naive": "#2a78d6", "arima": "#eb6834", "random_forest": "#1baf7a"}
plt.rcParams.update({"figure.dpi": 110, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.grid": True, "grid.color": "#e6e6e3", "grid.linewidth": 0.8,
                     "axes.edgecolor": "#8a8986", "font.size": 10, "axes.titleweight": "bold",
                     "lines.linewidth": 2})
pd.set_option("display.float_format", lambda v: f"{v:,.2f}")
from matplotlib.patches import Patch
from matplotlib.ticker import FuncFormatter


def fmt_units(*axes):
    # thousands separators on unit axes, e.g. 160,000
    for ax in axes:
        ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:,.0f}"))


print("Raw data found:", RAW_CSV.exists())
""")

# ----------------------------------------------------------------------------------------
md("""
## 2. Load the raw data and check its quality
The raw file is about 790 MB, so it is read in chunks of 1 million rows. For every row we check:
missing values, invalid dates, non-positive quantities, and whether
`Total_Price = Unit_Price × Quantity × (1 − Discount)`. For the product itself we keep monthly
units, the number of days with orders, and the region and channel (B2B/B2C) split.
""")
code("""
checks = {"rows": 0, "missing_values": 0, "bad_dates": 0, "non_positive_qty": 0,
          "price_mismatch": 0}
dates_min, dates_max, categories, parts = None, None, {}, []

for chunk in pd.read_csv(RAW_CSV, chunksize=1_000_000):
    checks["rows"] += len(chunk)
    checks["missing_values"] += int(chunk.isna().sum().sum())
    d = pd.to_datetime(chunk["Order_Date"], errors="coerce")
    checks["bad_dates"] += int(d.isna().sum())
    checks["non_positive_qty"] += int((chunk["Quantity"] <= 0).sum())
    expected = (chunk["Unit_Price"] * chunk["Quantity"] * (1 - chunk["Discount"])).round(2)
    checks["price_mismatch"] += int(((expected - chunk["Total_Price"]).abs() > 0.05).sum())
    dates_min = d.min() if dates_min is None else min(dates_min, d.min())
    dates_max = d.max() if dates_max is None else max(dates_max, d.max())
    for k, v in chunk["Category"].value_counts().items():
        categories[k] = categories.get(k, 0) + int(v)
    p = chunk[chunk["Product"] == PRODUCT].assign(Order_Date=d)
    parts.append(p[["Order_Date", "Quantity", "Region", "Customer_Type"]])

orders = pd.concat(parts, ignore_index=True)
print(pd.Series(checks).to_string())
print("Date range:", dates_min.date(), "to", dates_max.date())
print("Category rows:", categories)
print(f"{PRODUCT}: {len(orders):,} order lines")
""")
md("""
**Reading.** The data is clean: no missing values, no invalid dates, no zero or negative
quantities, and every `Total_Price` is consistent. The four categories are balanced (about 25%
each). One gap matters: **2023-12-31 has no orders**, so December 2023 covers 30 days. We record
the days observed per month so this partial month is not mistaken for a demand drop.
""")

md("""
## 3. Aggregate to monthly sales and export for the dashboard
Monthly units are the forecasting target. We also keep `days` (days with orders in the month)
and a region and channel breakdown, which supports the distribution recommendations. These small
files are the only precomputed data the dashboard uses: the 790 MB raw file cannot be shipped
to a browser or committed to GitHub.
""")
code("""
orders["Month"] = orders["Order_Date"].dt.to_period("M").astype(str)
monthly = (orders.groupby("Month")
           .agg(units=("Quantity", "sum"), days=("Order_Date", lambda s: s.dt.date.nunique()))
           .reset_index().rename(columns={"Month": "month"}))
monthly["units"] = monthly["units"].astype(float)

breakdown = {}
for m, g in orders.groupby("Month"):
    breakdown[m] = {"regions": g.groupby("Region")["Quantity"].sum().astype(int).to_dict(),
                    "channels": g.groupby("Customer_Type")["Quantity"].sum().astype(int).to_dict()}

all_records = monthly.to_dict("records")
_ = (EXPORT_DIR / "volvic_touch_monthly.json").write_text(json.dumps(all_records), encoding="utf-8")
_ = (EXPORT_DIR / "breakdown.json").write_text(json.dumps(breakdown, ensure_ascii=False), encoding="utf-8")
print(f"{len(monthly)} months exported; partial months:",
      monthly.loc[monthly["days"] < monthly["month"].map(days_in_month), "month"].tolist())
monthly.head(12)
""")

md("""
### The product's first year
The lab scenario has **one year** of history: January to December 2021 (12 points). The
remaining 2022-2023 months are kept aside. The dashboard releases them one at a time as
"newly arriving" actuals (the real-time feed).
""")
code("""
first_year = [{**r, "source": "history"} for r in all_records[:FIRST_YEAR]]
fy = pd.DataFrame(first_year)
fy["per_day"] = fy["units"] / fy["days"]
t = np.arange(len(fy))

fig, axes = plt.subplots(1, 2, figsize=(12, 3.8))
axes[0].plot(fy["month"], fy["units"], color=INK, marker="o", ms=5, label="Monthly units")
axes[0].plot(fy["month"], np.poly1d(np.polyfit(t, fy["units"], 1))(t), color="#8a8986",
             ls="--", lw=1.5, label="Linear trend")
axes[0].set(title="Monthly units sold, 2021", xlabel="Month", ylabel="Units")
axes[1].plot(fy["month"], fy["per_day"], color=COLORS["random_forest"], marker="o", ms=5,
             label="Units per day")
axes[1].set(title="Units per day (calendar-adjusted), 2021", xlabel="Month", ylabel="Units per day")
for ax in axes:
    ax.tick_params(axis="x", rotation=45)
    ax.legend(frameon=False, loc="lower right")
fmt_units(*axes)
plt.tight_layout(); plt.show()

slope = np.polyfit(t, fy["per_day"], 1)[0]
cv = lambda s: 100 * s.std(ddof=0) / s.mean()
calendar_share = 100 * (1 - np.var(fy["per_day"] * fy["days"].mean()) / np.var(fy["units"]))
print(f"Trend: {100 * slope / fy['per_day'].mean():.2f}% per month | CV raw {cv(fy['units']):.2f}% "
      f"-> per day {cv(fy['per_day']):.2f}% | month length explains {calendar_share:.1f}% of the variation")
""")
md("""
**Reading.** Raw monthly sales move between about 146k and 167k units. The sharpest dip is
**February**, which has only 28 days. Dividing by the days in each month removes most of that
movement: month length alone explains about three-quarters of the month-to-month variation, and
the coefficient of variation halves. The trend is essentially flat (about +0.2% per month).
With only one year of data, a true seasonal pattern (for example a summer peak) **cannot be
identified**: every calendar month has been seen once.
""")

# ----------------------------------------------------------------------------------------
md("""
## 4. Task 1: Preprocessing, lag features and seasonal indicators
**Validation.** Months must be consecutive: a missing month would silently
shift every lag feature.
""")
engine("prepare")
md("""
**Feature engineering.**
* **Calendar adjustment**: model *units per day*, then multiply back by the days in the month.
  This is the most useful feature for this data, because it turns the February "dip" into what
  it is: fewer days.
* **Lag features**: `lag_1`, `lag_2` and `lag_3` (sales 1-3 months back) and `roll_mean_3`. They
  are built with `shift`, so a row only sees the past and nothing leaks from the future.
* **Seasonal indicators**: month-of-year as `sin` and `cos` (so December sits next to January),
  `quarter`, `days_in_month`, and a time index `t` for trend.

**Limits with 12 months.** A 12-month seasonal lag would need a full year *before* the first
training row, so it is impossible here. Three lags already use up 3 of the 12 rows.
""")
engine("features")
code("""
features = build_features(prepare_series(first_year), adjust=True)
display(features[["month", "units", "days", "target", "lag_1", "lag_2", "lag_3", "roll_mean_3",
                  "t", "month_sin", "month_cos", "quarter", "days_in_month"]].round(3))
""")
code("""
fig, ax = plt.subplots(figsize=(6, 3.6))
for d, g in fy.assign(dim=fy["month"].map(days_in_month)).groupby("dim"):
    ax.scatter(g["dim"], g["units"], s=60, color=INK if d != 28 else COLORS["arima"],
               edgecolor="white", linewidth=1.5, zorder=3)
ax.set(title="Units vs days in month (2021)", xlabel="Days in month", ylabel="Units",
       xticks=[28, 30, 31])
ax.annotate("February", (28, fy["units"].min()), xytext=(28.4, fy["units"].min() + 800))
fmt_units(ax)
plt.tight_layout(); plt.show()
""")
md("""
**Reading.** The first three rows have empty lags, so the Random Forest can learn only from the
rows that have all three lags. The scatter shows the calendar effect directly: the 28-day month
is clearly lowest, and 31-day months sit highest on average.
""")

# ----------------------------------------------------------------------------------------
md("""
## 5. Task 2: Choosing the forecasting models
We compare three models from the lab brief, from simplest to most flexible:

| Model | Why it is included | Fit for 12 months of data |
|---|---|---|
| **Naive** | Benchmark: next month = last month. Any useful model must beat it. | Always works |
| **ARIMA** | Classic statistical model for autocorrelation and trend. Orders (p,d,q) in {0,1} are chosen by **AICc** (AIC corrected for small samples). | Only small, non-seasonal orders can be estimated from about 9 points; seasonal ARIMA needs at least 2 years |
| **Random Forest** | ML model using the lag and seasonal-indicator features. Forecasts *recursively* (each prediction becomes the next lag). | Learns from very few rows; cannot extrapolate a trend |

XGBoost (also listed on the slide) is left out on purpose: a boosted model on about 6 training
rows adds complexity without information. Each model returns a point forecast and a 95% range.
""")
engine("models")

# ----------------------------------------------------------------------------------------
md(r"""
## 6. Task 5 (formulas): MAPE and WAPE
Defined before training so that every model is scored by exactly the same code.

$$\text{MAPE} = \frac{100}{n}\sum_{t=1}^{n}\frac{|A_t - F_t|}{|A_t|} \qquad
\text{WAPE} = 100\cdot\frac{\sum_t |A_t - F_t|}{\sum_t |A_t|} \qquad
\text{Bias} = 100\cdot\frac{\sum_t (F_t - A_t)}{\sum_t A_t}$$

* **Zero or near-zero actuals**: MAPE divides by $A_t$, so months with $|A_t| \le 1$ unit are
  skipped (and counted). WAPE is undefined only if *all* actuals are zero; then it returns `None`.
* **WAPE** weights errors by volume, which matches production planning (units, not %-per-month).
  **Bias** shows the direction: positive means over-forecasting (overstock risk).
""")
engine("metrics")
md("**Hand-calculation cross-check** on three made-up months, worked out by hand and compared with the code.")
code("""
A = [100, 200, 300]; F = [110, 190, 330]
# by hand: |errors| = 10, 10, 30
#   MAPE = (10/100 + 10/200 + 30/300) / 3 * 100 = (0.10 + 0.05 + 0.10) / 3 * 100 = 8.333...%
#   WAPE = (10 + 10 + 30) / (100 + 200 + 300) * 100 = 50 / 600 * 100 = 8.333...%
#   Bias = (10 - 10 + 30) / 600 * 100 = 5.0%
s = score(A, F)
assert abs(s["mape"] - 25 / 3) < 1e-9 and abs(s["wape"] - 50 / 6) < 1e-9 and abs(s["bias_pct"] - 5) < 1e-9

# zero actual: MAPE skips it, WAPE still works
m, skipped = mape([0, 100], [5, 90]); assert skipped == 1 and abs(m - 10) < 1e-9
assert abs(wape([0, 100], [5, 90]) - 15) < 1e-9          # (5 + 10) / 100
assert wape([0, 0], [1, 1]) is None and mape([0, 0], [1, 1])[0] is None
print("All metric checks passed:", {k: round(v, 4) for k, v in s.items() if isinstance(v, float)})
""")

# ----------------------------------------------------------------------------------------
md("""
## 7. Task 3: Chronological train-test split and training
The data is a time series, so the split is **chronological, never random**. A random split
would let a model train on October to predict September.

* **Train**: Jan-Sep 2021 (9 months). **Test**: Oct-Dec 2021 (3 months), the same length as the
  3-month forecast horizon, so the test mimics the real task.
* Every model gets the same split, horizon and calendar setting.
* For the *future* forecast (Task 4), each model is refitted on all 12 months.

The pipeline below runs Tasks 1-5 in one call. The dashboard calls the same function whenever
the user changes a setting or adds data.
""")
engine("analysis")
engine("pipeline")
code("""
result = run_pipeline(first_year, test_size=3, horizon=3, adjust=True, breakdown=breakdown)
print("Split:", result["split"])
for m in result["models"].values():
    print(f"{m['label']:<14}", m["details"])

# Export the default view so the dashboard can show it instantly while its Python engine loads
_ = (EXPORT_DIR / "default_results.json").write_text(json.dumps(result), encoding="utf-8")
""")
md("""
**Reading.** AICc picks **ARIMA(0,1,0)**: a random walk, which is *mathematically the same
forecast as Naive*. ARIMA found no autocorrelation worth modelling in 9 calendar-adjusted points.
That is a finding, not a bug. The Random Forest learned from only 6 rows.
""")

# ----------------------------------------------------------------------------------------
md("""
## 8. Task 4: Forecasts for the next 3 months (Jan-Mar 2022)
Each model is refitted on all of 2021. The ranges are 95% intervals: random-walk for Naive,
ARIMA's own prediction interval, and the spread of the 300 trees for Random Forest (labelled as
not calibrated).
""")
code("""
rows = []
for m in result["models"].values():
    for f in m["forecast"]:
        rows.append({"model": m["label"], "month": f["month"], "forecast": f["pred"],
                     "low_95": f["lo"], "high_95": f["hi"]})
fc_table = pd.DataFrame(rows)
display(fc_table.pivot(index="month", columns="model", values="forecast").round(0))

fig, axes = plt.subplots(1, 3, figsize=(14, 3.8), sharey=True)
hist = pd.DataFrame(result["series"])
for ax, (key, m) in zip(axes, result["models"].items()):
    f = pd.DataFrame(m["forecast"])
    ax.plot(hist["month"], hist["units"], color=INK, marker="o", ms=4, label="Actual 2021")
    ax.plot(f["month"], f["pred"], color=COLORS[key], marker="o", ms=5, label=f"{m['label']} forecast")
    ax.fill_between(f["month"], f["lo"], f["hi"], color=COLORS[key], alpha=0.18, label="95% range")
    ax.set(title=f"{m['label']}: next 3 months", xlabel="Month")
    ax.tick_params(axis="x", rotation=60, labelsize=8)
    ax.legend(frameon=False, fontsize=8, loc="upper left")
axes[0].set_ylabel("Units"); fmt_units(*axes)
plt.tight_layout(); plt.show()
""")
md("""
**Reading.** All three models forecast a dip in **February 2022**. That dip comes from the
calendar adjustment: per-day sales are held roughly flat and February has 28 days. Naive and
ARIMA agree exactly. Random Forest is slightly higher. The Naive and ARIMA ranges widen with
the horizon, as they should.
""")

# ----------------------------------------------------------------------------------------
md("""
## 9. Task 5: Evaluating performance with MAPE and WAPE
All models are scored on the same three test months (Oct-Dec 2021). To show the value of the
calendar feature, we also run the identical comparison **without** calendar adjustment.
""")
code("""
def metrics_table(res):
    return pd.DataFrame([{"model": m["label"], "MAPE %": m["metrics"]["mape"],
                          "WAPE %": m["metrics"]["wape"], "Bias %": m["metrics"]["bias_pct"]}
                         for m in res["models"].values()]).set_index("model")

result_raw = run_pipeline(first_year, test_size=3, horizon=3, adjust=False, breakdown=breakdown)
comparison = pd.concat({"calendar-adjusted": metrics_table(result),
                        "raw units": metrics_table(result_raw)}, axis=1)
display(comparison.round(2))
print("Best model (adjusted):", MODEL_LABELS[result["best_model"]],
      "| best model (raw):", MODEL_LABELS[result_raw["best_model"]])

fig, axes = plt.subplots(1, 2, figsize=(11, 3.6), sharey=True)
for ax, (name, res) in zip(axes, [("Calendar-adjusted", result), ("Raw units", result_raw)]):
    tbl = metrics_table(res)
    x = np.arange(len(tbl))
    for i, metric in enumerate(["MAPE %", "WAPE %"]):
        bars = ax.bar(x + (i - 0.5) * 0.38, tbl[metric], width=0.36,
                      color=[COLORS[k] for k in res["models"]], alpha=1 if i else 0.55,
                      edgecolor="white", linewidth=2, label=metric)
        ax.bar_label(bars, fmt="%.2f", fontsize=8, padding=2)
    ax.set_xticks(x, tbl.index); ax.set(title=f"{name}: test error (lower is better)")
    ax.legend(handles=[Patch(color="#b9b8b4", label="MAPE (light bar)"),
                       Patch(color="#52514e", label="WAPE (solid bar)")], frameon=False, fontsize=8)
axes[0].set_ylabel("Error, %")
plt.tight_layout(); plt.show()
""")
md("""
**Reading.**
* With calendar adjustment, **Naive and ARIMA tie for best (WAPE about 1.4%)**, ahead of Random
  Forest (about 1.8%).
* Without it, every simple model gets worse (Naive about 2.1%, ARIMA about 3.0%). Random Forest
  becomes the best raw model (about 1.6%), because its `days_in_month` feature partly learns the
  same calendar effect.
* **The feature engineering mattered more than the choice of algorithm.**
* MAPE and WAPE are nearly identical because monthly volumes are similar. They would diverge if
  some months were much smaller than others.
* All errors are under 3%: the series is stable. With only 3 test months, differences of a few
  tenths of a percent are **not statistically meaningful**.
""")

# ----------------------------------------------------------------------------------------
md("""
## 10. Task 6: Actual vs predicted sales
Test-period predictions (made from the training window only) next to the actual sales, one
panel per model, followed by all models together.
""")
code("""
fig, axes = plt.subplots(1, 3, figsize=(14, 3.8), sharey=True)
for ax, (key, m) in zip(axes, result["models"].items()):
    tst = pd.DataFrame(m["test"])
    ax.plot(hist["month"], hist["units"], color=INK, marker="o", ms=4, label="Actual")
    ax.plot(tst["month"], tst["pred"], color=COLORS[key], marker="s", ms=6, label="Predicted (test)")
    ax.fill_between(tst["month"], tst["lo"], tst["hi"], color=COLORS[key], alpha=0.15)
    ax.axvline(result["split"]["train_end"], color="#8a8986", ls=":", lw=1.2)
    ax.text(result["split"]["train_end"], ax.get_ylim()[0], "  train | test", fontsize=8, color="#52514e")
    ax.set(title=f"{m['label']}: WAPE {m['metrics']['wape']:.2f}%", xlabel="Month")
    ax.tick_params(axis="x", rotation=60, labelsize=8)
    ax.legend(frameon=False, fontsize=8, loc="upper left")
axes[0].set_ylabel("Units"); fmt_units(*axes)
plt.tight_layout(); plt.show()

fig, ax = plt.subplots(figsize=(9, 3.8))
tst_months = [t["month"] for t in result["models"]["naive"]["test"]]
ax.plot(tst_months, [t["actual"] for t in result["models"]["naive"]["test"]], color=INK,
        marker="o", lw=2.5, label="Actual")
for key, m in result["models"].items():
    ax.plot(tst_months, [t["pred"] for t in m["test"]], color=COLORS[key], marker="o",
            ls="--" if key == "arima" else "-", label=m["label"])
ax.set(title="Test period: actual vs predicted, all models", xlabel="Month", ylabel="Units")
ax.legend(frameon=False, ncol=4, fontsize=9); fmt_units(ax)
plt.tight_layout(); plt.show()
""")
md("""
**Reading.** November 2021 is forecast almost exactly. The misses are October (actual about 167k,
above the forecast) and December (below it), each about 2%. These are ordinary month-to-month
swings that no model can learn from 9 points. ARIMA is drawn dashed because it sits exactly on
top of Naive.
""")

# ----------------------------------------------------------------------------------------
md("""
## 11. Task 7: Interpreting the insights

**How well did the models capture seasonality or trends?**
There is almost no trend to capture (about +0.2% per month). The visible "seasonality" in 2021 is
mostly a **calendar effect**: month length explains about three-quarters of the month-to-month
variation. Once modelled per day, all models capture it, and every forecast correctly expects
a lower February. A real seasonal pattern (such as weather-driven summer demand) cannot be
learned from one year. The synthetic data does not contain one either, even across 2021-2023.

**Which model performed best and why?**
**Naive and ARIMA tie for best (WAPE about 1.4%)**, because AICc reduced ARIMA to a random walk
(0,1,0), which is the Naive forecast. On a short, stable series the last observed level is the
best available information. Random Forest (about 1.8%) has only 6 training rows and cannot
extrapolate. Without calendar adjustment, Random Forest wins (about 1.6%), but only because its
`days_in_month` feature partly recovers the calendar effect.

**What recommendations would you give the company?**
1. **Plan production per day of sales, not per month.** Schedule about 465k units for Jan-Mar 2022
   (Naive/ARIMA), with about 10% fewer units in February simply because it has fewer days.
2. **Size safety stock to the forecast error and range** (WAPE about 1.4%, i.e. a few thousand
   units a month), not to the point forecast.
3. **Distribution:** demand is spread evenly across the 16 regions (about 6-7% each). About
   three-quarters of units go to **B2B** customers, so wholesale replenishment drives
   distribution planning.
4. **Re-forecast every month as actuals arrive**, track bias, and revisit seasonal models once
   24 or more months exist.

*These interpretations are written for the default view. §12 generates them automatically with an
LLM from whatever numbers are current.*
""")

# ----------------------------------------------------------------------------------------
md("""
## 12. LLM interpretation based on real-time data
**How "real-time" is implemented.** New monthly actuals are treated as events. Each time data
changes, the pipeline reruns and the LLM receives a **fresh JSON payload** of the current numbers:
metrics, forecasts, trend and seasonality statistics, distribution shares and known limitations,
stamped with a data version and time. The LLM answers the three Task 7 questions from that
payload only.

**Guardrails.**
* The system prompt forbids inventing figures.
* The answer must follow a fixed JSON schema (structured output).
* Every number in the answer is **checked against the payload**.
* If the LLM is unavailable (no key, network error, rate limit), a **rule-based fallback** builds
  the answers from the same numbers.

The API key is read from the environment variable `ANTHROPIC_API_KEY` (or a local `.env` file,
which is git-ignored) and never appears in the notebook. The dashboard uses the same prompt
through a server-side Netlify function.
""")
engine("llm")
engine("grounding")
code("""
import anthropic
from pydantic import BaseModel

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

LLM_MODEL = "claude-haiku-5-5"   # fast and inexpensive; same model as the dashboard function


class Interpretation(BaseModel):
    seasonality_trends: str
    best_model: str
    recommendations: list[str]
    caveats: list[str]


def interpret(res):
    \"\"\"Answer the three Task 7 questions from the CURRENT results, with a safe fallback.\"\"\"
    payload = build_llm_payload(res, generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    source = "fallback (no ANTHROPIC_API_KEY set)"
    answer = None
    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            client = anthropic.Anthropic(timeout=30.0)
            resp = client.messages.parse(
                model=LLM_MODEL, max_tokens=4000, system=SYSTEM_PROMPT,
                messages=[{"role": "user",
                           "content": "Current forecasting results (JSON):\\n" + json.dumps(payload)}],
                output_format=Interpretation)
            if resp.stop_reason == "end_turn" and resp.parsed_output is not None:
                answer, source = resp.parsed_output.model_dump(), f"LLM ({LLM_MODEL})"
            else:
                source = f"fallback (LLM stop_reason: {resp.stop_reason})"
        except anthropic.RateLimitError:
            source = "fallback (LLM rate-limited)"
        except anthropic.APIStatusError as e:
            source = f"fallback (LLM error {e.status_code})"
        except anthropic.APIConnectionError:
            source = "fallback (LLM unreachable)"
    if answer is None:
        answer = fallback_interpretation(payload)
    texts = [answer["seasonality_trends"], answer["best_model"], *answer["recommendations"]]
    return {"source": source, "answer": answer, "grounding": check_grounding(texts, payload),
            "payload": payload}


def show(interp):
    a, g = interp["answer"], interp["grounding"]
    badge = "all numbers verified against the data" if g["grounded"] else f"unverified numbers: {g['ungrounded']}"
    display(Markdown(
        f"**Source:** {interp['source']} · data version `{interp['payload']['data_version']}` · "
        f"{interp['payload']['generated_at']} · {g['numbers_checked']} numbers checked, {badge}\\n\\n"
        f"**1. Seasonality and trends.** {a['seasonality_trends']}\\n\\n"
        f"**2. Best model and why.** {a['best_model']}\\n\\n"
        "**3. Recommendations.**\\n" + "\\n".join(f"- {r}" for r in a["recommendations"]) +
        "\\n\\n**Caveats.**\\n" + "\\n".join(f"- {c}" for c in a["caveats"])))


interp_2021 = interpret(result)
show(interp_2021)
""")
md("""
### Real-time update: a new month of actual sales arrives
January 2022 actuals now "arrive" from the held-out data. The pipeline reruns on 13 months.
First we score the forecast we made *before* January was known. Then the LLM interpretation is
regenerated from the new numbers. The dashboard does the same with its **Advance month** button
and the **add data** form.
""")
code("""
jan = {**all_records[FIRST_YEAR], "source": "live feed"}
before = {m["label"]: m["forecast"][0]["pred"] for m in result["models"].values()}
print(f"Actual {jan['month']}: {jan['units']:,.0f} units")
for label, pred in before.items():
    print(f"  {label:<14} forecast {pred:,.0f} -> error {100 * (pred - jan['units']) / jan['units']:+.2f}%")

result_live = run_pipeline(first_year + [jan], test_size=3, horizon=3, adjust=True, breakdown=breakdown)
print("\\nNew data version:", result_live["data_version"], "(was", result["data_version"] + ")")
display(metrics_table(result_live).round(2))
show(interpret(result_live))
""")
md("""
**Reading.** All three models under-forecast January 2022 (by roughly 2-4%): January was a strong
month. After the new month is added, the test window moves forward (Nov 2021-Jan 2022), the
metrics change, and the interpretation is regenerated from the new numbers with a new data
version. That is the "real-time" loop the slide asks for.
""")

md("""
## 13. Summary and limitations
* **Best approach:** calendar-adjusted Naive/ARIMA (WAPE about 1.4% on Oct-Dec 2021). The key
  modelling decision was the calendar feature, not the algorithm.
* **Forecast for Jan-Mar 2022:** about 465k units, with a calendar-driven February dip.
* **Limitations:**
  * Only 12 months of data, so seasonality cannot be identified and seasonal lags or seasonal
    ARIMA are impossible.
  * The test window is 3 months, so the metrics are noisy.
  * Random Forest has 6 training rows.
  * The data is **synthetic** and shows no weather-driven seasonality, so real flavored-water
    demand would likely be more volatile and seasonal than this.
* **Next steps:** collect 24 or more months, then add seasonal ARIMA or 12-month lags. Add
  drivers such as price, promotions and temperature, and keep re-forecasting monthly.
""")

nb = nbf.v4.new_notebook()
nb["cells"] = cells
nb["metadata"] = {"kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"},
                  "language_info": {"name": "python"}}
out = ROOT / "beverage_forecasting.ipynb"
nbf.write(nb, out)
print("Wrote", out, "with", len(cells), "cells")
