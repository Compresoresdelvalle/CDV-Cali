/**
 * Vitest global setup
 * Validates that the required environment variables are present before
 * any integration test runs. Fails fast with a clear error instead of
 * producing cryptic 401/network errors inside the tests.
 */

const REQUIRED = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];

for (const key of REQUIRED) {
  if (!process.env[key]) {
    throw new Error(
      `[setup] Variable de entorno faltante: ${key}\n` +
        `Asegúrate de que el archivo .env.local esté presente y tenga ${key} definido.`,
    );
  }
}
