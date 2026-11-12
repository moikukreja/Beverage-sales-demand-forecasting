# FlowCast: Forecasting Monthly Sales for a New Beverage Product

AI in Operations, Session II lab (MAIB, SP Jain). This repository holds two deliverables:

| Deliverable | Path |
|---|---|
| Jupyter notebook (all 7 tasks plus the LLM interpretation) | `notebook/beverage_forecasting.ipynb` |
| Interactive React dashboard (Netlify) | `dashboard/` |

**Data.** Kaggle "Beverage Sales" by SWillm (2025, MIT licence), about 9M synthetic order lines.
Volvic Touch (the only flavored water in the data) stands in for the new product, and 2021 is
its first year. The raw 790 MB CSV is not committed. The notebook aggregates it into small JSON
files in `dashboard/public/data/`.

## Architecture: where each part runs

| Computation | Runs in | Why |
|---|---|---|
| Aggregating the raw CSV to monthly | Notebook, once (precomputed JSON) | The 790 MB file cannot go to GitHub or a browser |
| Features, Naive / ARIMA / Random Forest, MAPE / WAPE, forecasts | Browser, via Pyodide (Python in WebAssembly) running `dashboard/public/py/forecast_core.py` | Live and interactive on Netlify's free static hosting. It is the same code as the notebook, so the numbers match |
| First paint before the engine loads | `default_results.json`, exported by the notebook | Instant first view; controls unlock when the engine is ready (about 15-20 s on the first visit, cached afterwards) |
| LLM interpretation | Netlify Function `/api/interpret` (Claude `claude-haiku-5-5`) | The API key stays server-side in an environment variable |
| LLM fallback and number check | Browser (Python engine) | Works with no key or on errors. Every number in the answer is checked against the data |

The notebook's engine cells are generated from `forecast_core.py` by `notebook/build_notebook.py`,
and the LLM system prompt is exported from the same file to `dashboard/netlify/lib/system_prompt.json`.

## Run locally

```bash
# Notebook (Python 3.11+). These versions match Pyodide 0.29.5.
pip install -r notebook/requirements.txt
# put synthetic_beverage_sales_data.csv in data/, then run the notebook top to bottom
```

```bash
cd dashboard
npm install
npm run dev        # http://localhost:5173, also serves /api/interpret locally
```

For a live LLM locally, create `dashboard/.env` containing `ANTHROPIC_API_KEY=...`. The file is
git-ignored. Without a key, the dashboard uses its offline interpretation.

## Deploy (GitHub + Netlify free tier)

1. Push this folder to your GitHub repository. `.gitignore` already excludes the raw data,
   `.env`, `node_modules` and the build output.
2. In Netlify, go to **Add new site → Import an existing project → GitHub** and pick the repo.
3. Build settings come from `netlify.toml` at the repo root: base `dashboard`, command
   `npm run build`, publish `dashboard/dist`, functions `dashboard/netlify/functions`. Leave the
   UI fields empty or matching these.
4. Go to **Site configuration → Environment variables → Add a variable**:
   * Key: `ANTHROPIC_API_KEY`
   * Value: your key
   * Scope: Functions

   Then trigger a redeploy.
5. Open the site. The AI panel should show the model name (not "Offline interpretation"), and
   each answer shows how many of its numbers were verified against the data.
