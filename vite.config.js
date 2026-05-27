import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Alias "@/..." -> "src/..." requerido por los componentes shadcn/ui.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Puerto fijo: alinea el dev server con playwright.config.js (webServer 5174).
  server: { port: 5174, strictPort: true },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        // El bundle principal ronda los ~2 MiB; el límite por defecto de
        // Workbox (2 MiB) deja el chunk sin precachear y rompe el build.
        // Lo subimos a 3 MiB para precachear el bundle completo.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      manifest: {
        name: "Compresores del Valle - Gestión",
        short_name: "CDV Gestión",
        start_url: "/",
        display: "standalone",
        background_color: "#F6F8FA",
        theme_color: "#245A8C",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
});
