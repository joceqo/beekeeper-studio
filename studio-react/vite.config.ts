import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  // Absolute asset URLs (served from the origin root). In a packaged build the
  // app-react:// protocol serves index.html at app-react://./index.html, and
  // WindowBuilder appends a trailing slash when there's no query string. With a
  // relative base ("./"), assets would wrongly resolve under .../index.html/ and
  // 404 (white screen). An absolute base resolves "/assets/…" from the origin
  // root regardless, matching the Vue renderer (apps/studio uses base "/").
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5273,
    open: true,
  },
});
