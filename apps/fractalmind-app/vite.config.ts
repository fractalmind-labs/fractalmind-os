import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "production-csp",
      apply: "build",
      transformIndexHtml: () =>
        process.env.TAURI_ENV_PLATFORM
          ? []
          : [
              {
                tag: "meta",
                attrs: {
                  "http-equiv": "Content-Security-Policy",
                  content:
                    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https: http://127.0.0.1:* http://localhost:* http://[::1]:*; img-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'none'",
                },
                injectTo: "head-prepend",
              },
            ],
    },
  ],
  base: "./",
  server: { host: "127.0.0.1", port: 4189, strictPort: true },
  build: { target: "es2022" },
});
