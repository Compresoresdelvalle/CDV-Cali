import { supabase } from "./supabase";

/**
 * upsertCliente — guarda/reutiliza un cliente vía RPC fn_upsert_cliente.
 *
 * El backend busca por identificación y reutiliza si existe, o crea uno nuevo.
 * Se usa al guardar ventas, cotizaciones y órdenes para que el cliente quede
 * registrado y aparezca en el autocompletado la próxima vez.
 *
 * NUNCA lanza: si falla (RLS, red, etc.) loguea y devuelve null para no romper
 * el guardado del documento principal.
 *
 * @returns {Promise<object|null>} la fila completa de clientes, o null si falló.
 */
export async function upsertCliente({
  nombre,
  identificacion,
  telefono,
  email,
  direccion,
} = {}) {
  const p_nombre = (nombre ?? "").trim();
  if (!p_nombre) return null;
  try {
    const { data, error } = await supabase.rpc("fn_upsert_cliente", {
      p_nombre,
      p_identificacion: (identificacion ?? "").trim() || null,
      p_telefono: (telefono ?? "").trim() || null,
      p_email: (email ?? "").trim() || null,
      p_direccion: (direccion ?? "").trim() || null,
    });
    if (error) throw error;
    // fn_upsert_cliente devuelve la fila (puede venir como objeto o array de 1).
    return Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
  } catch (err) {
    console.warn("[upsertCliente] no se pudo guardar/reutilizar cliente:", err);
    return null;
  }
}
