/**
 * Seed helpers — crea y limpia datos de prueba aislados.
 *
 * Convención de aislamiento:
 *   • observaciones de traspasos prefijadas con "TEST_"
 *   • cliente_nombre de ventas/cotizaciones prefijado con "TEST_"
 *
 * Productos de producción usados como read-only reference:
 *   FA-2236  (15 u en BOD-PRINCIPAL)  — filamento
 *   MG-AP-10 (12 u en BOD-PRINCIPAL)  — manguera
 *   MN-150   ( 7 u en BOD-PRINCIPAL)  — manómetro
 *   CMP-2HP-24 (4 u en BOD-PRINCIPAL) — compresor
 *
 * Esquema real (extraído de migraciones):
 *   traspasos.solicitado_por  UUID NOT NULL
 *   detalle_traspaso          NO tiene columna "referencia"
 *   cotizaciones.vendedor_id  UUID NOT NULL
 *   cotizaciones.estado       ENUM ('borrador','enviada','aprobada','rechazada','vencida')
 *   fn_registrar_devolucion   tipo = 'cliente' | 'proveedor'
 */

import { loginAs } from "./auth.js";

// UUIDs reales del seed de producción (20260404000003_fase1_03_seed_data.sql)
export const USER_IDS = {
  carlos: "1eea3d55-e287-42a7-8f5c-8d9c8a03d1c3",
  pedro: "1e787dc7-815c-44d1-b6a5-2c894c473c34",
  maria: "88ecac37-f3dc-4e11-8d13-1771ecc94a2d",
};

export const PROD_ITEMS = {
  FA2236: { referencia: "FA-2236", sede: "BOD-PRINCIPAL", stockInicial: 15 },
  MGAP10: { referencia: "MG-AP-10", sede: "BOD-PRINCIPAL", stockInicial: 12 },
  MN150: { referencia: "MN-150", sede: "BOD-PRINCIPAL", stockInicial: 7 },
  CMP2HP: { referencia: "CMP-2HP-24", sede: "BOD-PRINCIPAL", stockInicial: 4 },
};

/**
 * Obtiene inventario (id, cantidad, estado_stock, producto_id) por referencia y sede.
 */
export async function getProducto(
  client,
  referencia,
  sedeId = "BOD-PRINCIPAL",
) {
  // inventario.referencia does not exist — lookup producto_id first via productos table
  const prod = await getProductoId(client, referencia);

  const { data, error } = await client
    .from("inventario")
    .select("id, cantidad, estado_stock, producto_id")
    .eq("sede_id", sedeId)
    .eq("producto_id", prod.id)
    .single();

  if (error)
    throw new Error(
      `[seed] getProducto(${referencia}@${sedeId}): ${error.message}`,
    );
  return data;
}

/**
 * Obtiene el registro de la tabla `productos` por referencia.
 */
export async function getProductoId(client, referencia) {
  const { data, error } = await client
    .from("productos")
    .select("id, nombre, precio_venta")
    .eq("referencia", referencia)
    .single();

  if (error)
    throw new Error(`[seed] getProductoId(${referencia}): ${error.message}`);
  return data;
}

/**
 * Crea un traspaso de prueba en estado borrador.
 * Incluye `solicitado_por` (requerido NOT NULL en la tabla).
 *
 * @param {object} opts
 * @param {string} opts.origenId
 * @param {string} opts.destinoId
 * @param {{ producto_id: string, cantidad: number }[]} opts.items
 * @param {string} [opts.solicitadoPor] — UUID del usuario. Por defecto Carlos.
 */
export async function crearTraspaso(
  client,
  {
    origenId = "BOD-PRINCIPAL",
    destinoId = "ALM-01",
    items,
    solicitadoPor = USER_IDS.carlos,
  },
) {
  const { data: traspaso, error: errT } = await client
    .from("traspasos")
    .insert({
      sede_origen_id: origenId,
      sede_destino_id: destinoId,
      estado: "borrador",
      solicitado_por: solicitadoPor,
      observaciones: "TEST_traspaso_automatico",
    })
    .select()
    .single();

  if (errT) throw new Error(`[seed] crearTraspaso insert: ${errT.message}`);

  // detalle_traspaso NO tiene columna "referencia" — schema real
  const detalles = items.map((it) => ({
    traspaso_id: traspaso.id,
    producto_id: it.producto_id,
    cantidad_solicitada: it.cantidad,
    picking_completado: false,
  }));

  const { data: det, error: errD } = await client
    .from("detalle_traspaso")
    .insert(detalles)
    .select();

  if (errD) throw new Error(`[seed] crearTraspaso detalles: ${errD.message}`);

  return { traspaso, detalles: det };
}

/**
 * Elimina traspasos de prueba (observaciones ILIKE 'TEST_%') y sus detalles.
 */
export async function cleanupTraspasos(adminClient) {
  const { data: ts } = await adminClient
    .from("traspasos")
    .select("id")
    .ilike("observaciones", "TEST_%");

  if (!ts?.length) return;

  const ids = ts.map((t) => t.id);
  await adminClient.from("detalle_traspaso").delete().in("traspaso_id", ids);
  await adminClient.from("traspasos").delete().in("id", ids);
}

/**
 * Elimina ventas de prueba (cliente_nombre ILIKE 'TEST_%').
 * movimientos es append-only — no se borra.
 */
export async function cleanupVentas(adminClient) {
  const { data: vs } = await adminClient
    .from("ventas")
    .select("id")
    .ilike("cliente_nombre", "TEST_%");

  if (!vs?.length) return;

  const ids = vs.map((v) => v.id);
  await adminClient.from("detalle_venta").delete().in("venta_id", ids);
  await adminClient.from("ventas").delete().in("id", ids);
}

/**
 * Devuelve un cliente Supabase autenticado como Carlos (Admin).
 */
export async function getAdminClient() {
  const { client } = await loginAs("carlos");
  return client;
}
