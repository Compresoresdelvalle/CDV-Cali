/**
 * Vitest global setup
 * Valida que las variables de entorno requeridas existan antes de correr
 * cualquier test de integración. Falla rápido con un error claro en vez de
 * producir errores 401/de red crípticos dentro de los tests. Esto es un
 * problema de configuración (falta .env.local) — distinto de que el
 * entorno de fixtures no exista, que se maneja abajo.
 */
/* global process */

import { checkIntegrationEnv } from "./helpers/env-check.js";

const REQUIRED = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];

for (const key of REQUIRED) {
  if (!process.env[key]) {
    throw new Error(
      `[setup] Variable de entorno faltante: ${key}\n` +
        `Asegúrate de que el archivo .env.local esté presente y tenga ${key} definido.`,
    );
  }
}

// Detecta UNA sola vez (compartido entre archivos vía cache en disco, ver
// tests/helpers/env-check.js) si el entorno de fixtures de integración está
// disponible. Se expone en globalThis para que cada archivo de test decida
// con describe.skipIf/it.skipIf si debe correr o saltarse, sin repetir la
// petición de login por archivo.
globalThis.__INTEGRATION_ENV__ = await checkIntegrationEnv();

if (!globalThis.__INTEGRATION_ENV__.available) {
  console.warn(`\n[integración] ${globalThis.__INTEGRATION_ENV__.reason}\n`);
}
