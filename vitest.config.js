import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Load .env.local so VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are available
  const env = loadEnv(mode ?? "test", process.cwd(), "");

  return {
    test: {
      globals: true,
      environment: "node",
      setupFiles: ["./tests/setup.js"],
      env,
      // Run integration tests sequentially in a single fork to avoid
      // Supabase rate limits and to keep stock assertions deterministic
      singleThread: true,
      testTimeout: 30_000,
      hookTimeout: 30_000,
      include: ["tests/integration/**/*.test.js"],
      coverage: {
        provider: "v8",
        reporter: ["text", "json-summary"],
        include: ["src/**/*.{js,jsx}"],
      },
    },
  };
});
