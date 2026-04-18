/**
 * Auth helpers — iniciar sesión como cada usuario de prueba.
 *
 * Los usuarios de Supabase Auth usan:
 *   email: <usuario>@compresores.local
 *   password: PIN de 4 dígitos (como string)
 *
 * Credenciales (seed: 20260404000003_fase1_03_seed_data.sql):
 *   Carlos Admin   — carlos@compresores.local  / 0001 / BOD-PRINCIPAL
 *   Pedro Bodeguero— pedro@compresores.local   / 1234 / BOD-PRINCIPAL
 *   María Vendedor — maria@compresores.local   / 5678 / ALM-01
 *   Juan  Vendedor — juan@compresores.local    / 9012 / ALM-02
 *   Ana   Vendedor — ana@compresores.local     / 3456 / ALM-03
 *   Luis  Técnico  — luis@compresores.local    / 7890 / BOD-PRINCIPAL
 *
 * Sesiones en caché para evitar rate-limiting de Supabase Auth cuando
 * múltiples suites de test se ejecutan en el mismo proceso.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

export const USERS = {
  carlos: {
    email: "carlos@compresores.local",
    password: "0001",
    sede: "BOD-PRINCIPAL",
    rol: "Admin",
  },
  pedro: {
    email: "pedro@compresores.local",
    password: "1234",
    sede: "BOD-PRINCIPAL",
    rol: "Bodeguero",
  },
  maria: {
    email: "maria@compresores.local",
    password: "5678",
    sede: "ALM-01",
    rol: "Vendedor",
  },
  juan: {
    email: "juan@compresores.local",
    password: "9012",
    sede: "ALM-02",
    rol: "Vendedor",
  },
  ana: {
    email: "ana@compresores.local",
    password: "3456",
    sede: "ALM-03",
    rol: "Vendedor",
  },
  luis: {
    email: "luis@compresores.local",
    password: "7890",
    sede: "BOD-PRINCIPAL",
    rol: "Tecnico",
  },
};

// Cache de sesiones — una por usuario, reutilizadas durante todo el proceso de test
const _sessionCache = new Map();
// Cache de clientes Supabase — reutiliza el mismo cliente autenticado
const _clientCache = new Map();

/**
 * Inicia sesión como el usuario indicado.
 * La sesión se guarda en caché para evitar llamadas repetidas a signInWithPassword.
 * @param {'carlos'|'pedro'|'maria'|'juan'|'ana'|'luis'} nombre
 * @returns {{ client: SupabaseClient, session: Session, user: User }}
 */
export async function loginAs(nombre) {
  const creds = USERS[nombre];
  if (!creds) throw new Error(`Usuario desconocido: ${nombre}`);

  // Devolver desde caché si ya existe una sesión válida
  if (_sessionCache.has(nombre)) {
    return {
      client: _clientCache.get(nombre),
      session: _sessionCache.get(nombre).session,
      user: _sessionCache.get(nombre).user,
    };
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await client.auth.signInWithPassword({
    email: creds.email,
    password: creds.password,
  });

  if (error) {
    throw new Error(
      `[auth] Error al iniciar sesión como ${nombre}: ${error.message}`,
    );
  }

  _sessionCache.set(nombre, { session: data.session, user: data.user });
  _clientCache.set(nombre, client);

  return { client, session: data.session, user: data.user };
}

/**
 * Devuelve el Authorization header Bearer para un usuario.
 */
export async function getAuthHeader(nombre) {
  const { session } = await loginAs(nombre);
  return `Bearer ${session.access_token}`;
}

/**
 * URL base de las Edge Functions del proyecto.
 */
export function edgeFunctionUrl(fnName) {
  return `${SUPABASE_URL}/functions/v1/${fnName}`;
}

/**
 * Invoca una Edge Function autenticado como el usuario indicado.
 * @param {string} fnName - Nombre de la Edge Function
 * @param {string} usuario - Nombre del usuario ('carlos', 'pedro', etc.)
 * @param {object} body - Cuerpo de la petición
 * @returns {{ status: number, data: any }}
 */
export async function invokeAs(fnName, usuario, body) {
  const authHeader = await getAuthHeader(usuario);
  const url = edgeFunctionUrl(fnName);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });

  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { status: res.status, data };
}
