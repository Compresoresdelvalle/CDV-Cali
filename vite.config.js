import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Puerto fijo: alinea el dev server con playwright.config.js (webServer 5174).
  server: { port: 5174, strictPort: true },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
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
