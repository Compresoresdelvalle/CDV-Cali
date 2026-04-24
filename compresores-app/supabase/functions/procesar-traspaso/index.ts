/**
 * Edge Function: procesar-traspaso
 *
 * Gestiona las transiciones de estado del flujo de traspasos:
 *   Pendiente (borrador) → En Picking → Verificado → En Tránsito → Recibido
 *
 * Delega la lógica transaccional y las validaciones de negocio
 * a la función PostgreSQL fn_procesar_traspaso (SECURITY DEFINER).
 *
 * Acciones soportadas:
 *   iniciar_picking   — asigna picker, cambia borrador→picking
 *   actualizar_items  — guarda progreso del picking (sin cambio de estado)
 *   verificar         — picker≠verificador, picking→verificado
 *   enviar            — verificado→en_transito (trigger descuenta stock origen)
 *   recibir           — en_transito→recibido/con_diferencia (trigger suma stock destino)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const VALID_ACTIONS = new Set([
  "iniciar_picking",
  "actualizar_items",
  "verificar",
  "enviar",
  "recibir",
]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "No autorizado" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const body = await req.json();
    const { traspaso_id, accion, items } = body;

    if (!traspaso_id) return json({ error: "Falta traspaso_id" }, 400);
    if (!accion) return json({ error: "Falta accion" }, 400);
    if (!VALID_ACTIONS.has(accion)) {
      return json(
        {
          error: `Acción inválida: ${accion}. Opciones: ${[...VALID_ACTIONS].join(", ")}`,
        },
        400,
      );
    }

    const { data, error } = await supabase.rpc("fn_procesar_traspaso", {
      p_traspaso_id: traspaso_id,
      p_accion: accion,
      p_items: items ?? null,
    });

    if (error) {
      return json({ error: error.message }, 400);
    }

    return json({ ok: true, data });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Error interno" },
      500,
    );
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
