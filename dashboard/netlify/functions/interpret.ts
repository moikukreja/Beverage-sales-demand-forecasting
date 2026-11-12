/**
 * POST /api/interpret - server-side LLM interpretation.
 *
 * The browser sends the grounded payload (current metrics, forecasts, trend stats,
 * limitations). This function adds the fixed system prompt, calls Claude with a strict
 * JSON schema, and returns the structured answer. The API key lives only in the
 * Netlify environment variable ANTHROPIC_API_KEY - never in the browser or in Git.
 * LLM-side failures return HTTP 200 with { code } (an expected, handled outcome, so the
 * browser console stays clean); the dashboard then shows its rule-based fallback.
 * Malformed or foreign requests get real 4xx errors.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import promptFile from "../lib/system_prompt.json";

const MODEL = "claude-haiku-5-5"; // fast enough for the 10 s function limit
const MAX_BODY_BYTES = 40_000;

const Interpretation = z.object({
  seasonality_trends: z.string(),
  best_model: z.string(),
  recommendations: z.array(z.string()),
  caveats: z.array(z.string()),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/** Only accept calls from this site (production, deploy previews) or local dev. */
function originAllowed(origin: string | null): boolean {
  if (!origin) return true; // same-origin requests may omit it
  const allowed = [process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL].filter(
    Boolean,
  ) as string[];
  return allowed.some((u) => origin === u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ code: "method_not_allowed" }, 405);
  if (!originAllowed(req.headers.get("origin"))) return json({ code: "forbidden_origin" }, 403);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ code: "not_configured" });

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ code: "payload_too_large" }, 413);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw).payload;
    if (!payload || typeof payload !== "object" || !("models" in payload) || !("trend_and_seasonality" in payload)) {
      throw new Error("bad payload");
    }
  } catch {
    return json({ code: "bad_request" }, 400);
  }

  // 8.5 s timeout and no retries keep us inside Netlify's 10 s synchronous limit.
  const client = new Anthropic({ apiKey, timeout: 8_500, maxRetries: 0 });
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 3_000,
      system: promptFile.system_prompt,
      output_config: { format: zodOutputFormat(Interpretation), effort: "low" },
      messages: [
        { role: "user", content: "Current forecasting results (JSON):\n" + JSON.stringify(payload) },
      ],
    });
    if (response.stop_reason !== "end_turn" || !response.parsed_output) {
      return json({ code: "bad_output", message: `stop_reason: ${response.stop_reason}` });
    }
    return json({ interpretation: response.parsed_output, model: response.model });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json({ code: "rate_limited" });
    if (error instanceof Anthropic.APIConnectionTimeoutError) return json({ code: "timeout" });
    if (error instanceof Anthropic.AuthenticationError) return json({ code: "bad_api_key" });
    if (error instanceof Anthropic.APIError) {
      return json({ code: "llm_error", message: `LLM API error ${error.status ?? ""}`.trim() });
    }
    return json({ code: "server_error" });
  }
};

export const config = { path: "/api/interpret" };
