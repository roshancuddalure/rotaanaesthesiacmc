import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  let apiOrigin = "";
  if (env.VITE_API_BASE_URL) {
    const api = new URL(env.VITE_API_BASE_URL);
    if (!["http:", "https:"].includes(api.protocol) || api.username || api.password)
      throw new Error("VITE_API_BASE_URL must be an HTTP(S) origin without credentials");
    apiOrigin = api.origin;
  }
  const workerPolicy = "default-src 'none'; script-src 'self'; connect-src 'none'; object-src 'none'";
  const policy = `default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' http://127.0.0.1:* ${apiOrigin}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;
  return {
    // Build identity contains no environment values, repository paths or user information.
    define: { __FRONTEND_BUILD_ID__: JSON.stringify(new Date().toISOString().replace(/[^0-9TZ]/g, "")) },
    preview: { headers: {
      "Content-Security-Policy": policy, "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY",
    } },
    plugins: [{ name: "compute-worker-network-boundary", configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0].match(/^\/assets\/compute-worker-[\w-]+\.js$/)) {
          // Keep the stricter worker policy when the static middleware adds its headers.
          const setHeader = res.setHeader.bind(res);
          res.setHeader = (name, value) => setHeader(name, name.toLowerCase() === "content-security-policy" ? workerPolicy : value);
          res.setHeader("Content-Security-Policy", workerPolicy);
        }
        next();
      });
    } }],
    server: {
      proxy: {
        "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
      },
    },
  };
});
