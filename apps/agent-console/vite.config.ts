import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri and Capacitor both load this Vite-built web app.
export default defineConfig({
  plugins: [react()],
  // Relative base so the bundle works from file:// (Capacitor) and Tauri.
  base: "./",
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", target: "es2021" },
});
