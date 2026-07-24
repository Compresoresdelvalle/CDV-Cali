/**
 * Detección del entorno de fixtures para tests de integración.
 *
 * Los tests de integración inician sesión como usuarios ficticios (carlos,
 * pedro, maria, juan, ana, luis — ver tests/helpers/auth.js) que solo
 * existen en el seed de desarrollo (20260404000003_fase1_03_seed_data.sql).
 * La ÚNICA base de datos que existe hoy es PRODUCCIÓN, con usuarios reales
 * (Admin Maritza, Bodega, Bodega2, Bladimir, Deyanira, Edna, Sofía, Luis) —
 * nunca se crean cuentas de prueba ahí.
 *
 * `checkIntegrationEnv()` detecta, con UNA sola petición de login (de solo
 * lectura: no crea ni modifica nada), si ese entorno de fixtures está
 * disponible. El resultado se cachea en disco (TTL corto) para que TODOS
 * los archivos de test de una misma corrida de `npm test` compartan el
 * mismo resultado sin repetir la petición por archivo: Vitest aísla el
 * registro de módulos de cada archivo de test, así que una variable en
 * memoria de este módulo NO sobrevive entre archivos, pero un archivo en
 * disco sí.
 *
 * Si algún día existe un proyecto/branch de Supabase propio para pruebas
 * con este seed, este chequeo pasará solo y los tests de integración
 * correrán con normalidad — no hace falta tocar nada más.
 */
/* global process */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const CACHE_FILE = path.join(
  os.tmpdir(),
  "compresores-integration-env-check.json",
);
// 2 minutos alcanza de sobra para que corran todos los archivos de una
// misma invocación de `npm test`, y evita que un cache viejo de una corrida
// anterior quede "pegado" para siempre.
const CACHE_TTL_MS = 2 * 60 * 1000;

// Usuario de sondeo — cualquiera de los fixtures sirve, se usa el mismo que
// ya usan la mayoría de los tests como "admin".
const PROBE_CREDS = { email: "carlos@compresores.local", password: "0001" };

export const MOTIVO_SIN_FIXTURES =
  "Tests de integración omitidos: requieren los usuarios de prueba " +
  "(carlos, pedro, maria, juan, ana, luis), que no existen en esta base. " +
  "La única base es producción y no se crean cuentas de prueba en ella.\n" +
  `Si acabas de apuntar .env.local a una base con esos usuarios y sigue saliendo este aviso, el sondeo está cacheado ${CACHE_TTL_MS / 1000}s: espera un momento o borra ${CACHE_FILE}.`;

let _memo = null; // memoiza dentro del mismo archivo, evita releer el disco varias veces

function leerCache() {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
    if (typeof raw.timestamp !== "number") return null;
    if (Date.now() - raw.timestamp > CACHE_TTL_MS) return null;
    // El veredicto vale para UNA base concreta. El archivo de caché vive en la
    // carpeta temporal del usuario, compartida por toda la máquina: sin esta
    // comparación, dos worktrees del mismo repo apuntando a bases distintas
    // (el día que exista un proyecto de pruebas) se pisarían el resultado —
    // el de producción heredaría el "sí hay fixtures" del otro e intentaría
    // loguearse como carlos/pedro contra producción, poniéndose rojo justo
    // como se quería evitar.
    if (raw.url !== process.env.VITE_SUPABASE_URL) return null;
    return raw;
  } catch {
    return null; // cache corrupto o ilegible: se vuelve a sondear
  }
}

function escribirCache(resultado) {
  try {
    writeFileSync(
      CACHE_FILE,
      JSON.stringify({
        ...resultado,
        url: process.env.VITE_SUPABASE_URL,
        timestamp: Date.now(),
      }),
      "utf-8",
    );
  } catch {
    // No es fatal: si no se puede persistir, el siguiente archivo simplemente
    // vuelve a sondear (peor caso: una petición extra, no un fallo).
  }
}

async function sondearLogin() {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return { available: false, reason: MOTIVO_SIN_FIXTURES };
  }

  // El try/catch no es decorativo: un fallo de red devuelve `{error}` y se
  // maneja abajo, pero una URL mal formada (un typo al editar .env.local que
  // deje el valor sin https:// o con una comilla colgada) hace que
  // `createClient` lance una excepción SÍNCRONA. Sin capturarla, se propaga
  // hasta el setup de Vitest y tumba la corrida entera con un error críptico,
  // en vez de degradarse a "no hay entorno de fixtures".
  try {
    const client = createClient(url, anonKey);
    const { error } = await client.auth.signInWithPassword(PROBE_CREDS);

    if (error) {
      return { available: false, reason: MOTIVO_SIN_FIXTURES };
    }

    await client.auth.signOut();
    return { available: true, reason: "" };
  } catch {
    return { available: false, reason: MOTIVO_SIN_FIXTURES };
  }
}

/**
 * Devuelve { available, reason }. `available: false` significa que los
 * tests de integración deben saltarse con describe.skipIf/it.skipIf.
 */
export async function checkIntegrationEnv() {
  if (_memo) return _memo;

  const cached = leerCache();
  if (cached) {
    _memo = cached;
    return cached;
  }

  const resultado = await sondearLogin();
  escribirCache(resultado);
  _memo = resultado;
  return resultado;
}

/**
 * Helper de conveniencia para usar directamente en describe.skipIf/it.skipIf
 * dentro de los archivos de test. Requiere que tests/setup.js ya haya
 * corrido (deja el resultado en globalThis.__INTEGRATION_ENV__).
 */
export function integrationEnvNoDisponible() {
  return globalThis.__INTEGRATION_ENV__?.available !== true;
}
