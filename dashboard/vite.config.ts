import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Dev only: serve the Netlify function at /api/interpret from the Vite dev server, so
 * `npm run dev` behaves like production (`netlify dev` works too). Reads the key from
 * dashboard/.env, which is git-ignored.
 */
function netlifyFunctionDev(): Plugin {
  return {
    name: "netlify-function-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/interpret", async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const mod = await server.ssrLoadModule("/netlify/functions/interpret.ts");
        const request = new Request(`http://localhost${req.url ?? ""}`, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
        });
        const response: Response = await mod.default(request);
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(await response.text());
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  return {
    plugins: [react(), netlifyFunctionDev()],
    build: { chunkSizeWarningLimit: 900 },
  };
});
