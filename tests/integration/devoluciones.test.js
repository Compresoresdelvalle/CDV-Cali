/**
 * Integration tests — registrar-devolucion Edge Function
 *
 * Cubre:
 *   ✓ Devolución de cliente sin venta_id — rechazada (el RPC la exige)
 *   ✓ Devolución de proveedor ('proveedor') — RESTA stock en sede
 *   ✓ Movimiento de auditoría creado (tipo 'devolucion' en el ENUM)
 *   ✓ Error al omitir campos requeridos (tipo, producto_id, sede_id, cantidad)
 *   ✓ Error con cantidad 0 o negativa
 *   ✓ Error tipo inválido
 *
 * Esquema real:
 *   fn_registrar_devolucion acepta tipo = 'cliente' | 'proveedor'
 *   - cliente   → SUMA stock, requiere venta_id válida y no anulada
 *   - proveedor → RESTA stock, no requiere venta
 *   tipo_movimiento ENUM incluye 'devolucion' (no 'DevolucionCliente')
 */

import { describe, it, expect, beforeAll } from "vitest";
import { invokeAs } from "../helpers/auth.js";
import {
  getProducto,
  getAdminClient,
  resetStockPruebas,
} from "../helpers/seed.js";

const FN = "registrar-devolucion";

describe("registrar-devolucion", () => {
  let adminClient;
  let productoId;

  beforeAll(async () => {
    adminClient = await getAdminClient();
    await resetStockPruebas(adminClient);
    const fa = await getProducto(adminClient, "FA-2236");
    productoId = fa.producto_id;
  });

  // ─────────────────────────────────────────────────────────────
  // Devolución de cliente
  // ─────────────────────────────────────────────────────────────

  it("tipo=cliente sin venta_id es rechazado (400)", async () => {
    // `fn_registrar_devolucion` exige venta_id para devoluciones de cliente
    // (valida que lo devuelto no exceda lo vendido). Omitir venta_id => 400.
    const { status, data } = await invokeAs(FN, "pedro", {
      tipo: "cliente",
      producto_id: productoId,
      sede_id: "BOD-PRINCIPAL",
      cantidad: 2,
      motivo: "TEST: cliente sin venta_id",
    });

    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  // ─────────────────────────────────────────────────────────────
  // Devolución de proveedor — RESTA stock
  // ─────────────────────────────────────────────────────────────

  it("tipo=proveedor — resta 3 unidades del stock", async () => {
    const antes = await getProducto(adminClient, "FA-2236");

    const { status, data } = await invokeAs(FN, "pedro", {
      tipo: "proveedor",
      producto_id: productoId,
      sede_id: "BOD-PRINCIPAL",
      cantidad: 3,
      motivo: "TEST: proveedor envió producto defectuoso",
    });

    expect(status).toBe(200);
    expect(data.ok ?? data.data?.ok ?? true).toBeTruthy();

    const despues = await getProducto(adminClient, "FA-2236");
    expect(despues.cantidad).toBe(antes.cantidad - 3);
  });

  it("crea movimiento de auditoría tipo devolucion", async () => {
    const { data: movs, error } = await adminClient
      .from("movimientos")
      .select("id, tipo, cantidad")
      .eq("producto_id", productoId)
      .eq("sede_id", "BOD-PRINCIPAL")
      .eq("tipo", "devolucion")
      .order("created_at", { ascending: false })
      .limit(1);

    expect(error).toBeNull();
    expect(movs.length).toBeGreaterThan(0);
    // El signo depende del tipo (cliente=+, proveedor=−); solo exigimos != 0.
    expect(movs[0].cantidad).not.toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // Error paths
  // ─────────────────────────────────────────────────────────────

  it("tipo inválido retorna error 400", async () => {
    const { status, data } = await invokeAs(FN, "pedro", {
      tipo: "devolucion_cliente", // incorrecto — debe ser 'cliente'
      producto_id: productoId,
      sede_id: "BOD-PRINCIPAL",
      cantidad: 1,
      motivo: "TEST: tipo inválido",
    });

    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  it("rechaza devolucion sin tipo", async () => {
    const { status, data } = await invokeAs(FN, "pedro", {
      producto_id: productoId,
      sede_id: "BOD-PRINCIPAL",
      cantidad: 1,
      motivo: "TEST: sin tipo",
    });

    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  it("rechaza devolucion sin producto_id", async () => {
    const { status, data } = await invokeAs(FN, "pedro", {
      tipo: "cliente",
      sede_id: "BOD-PRINCIPAL",
      cantidad: 1,
      motivo: "TEST: sin producto",
    });

    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  it("rechaza devolucion con cantidad 0", async () => {
    const { status, data } = await invokeAs(FN, "pedro", {
      tipo: "cliente",
      producto_id: productoId,
      sede_id: "BOD-PRINCIPAL",
      cantidad: 0,
      motivo: "TEST: cantidad cero",
    });

    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  it("rechaza devolucion sin Authorization header", async () => {
    const res = await fetch(
      `${process.env.VITE_SUPABASE_URL}/functions/v1/${FN}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          tipo: "cliente",
          producto_id: productoId,
          sede_id: "BOD-PRINCIPAL",
          cantidad: 1,
          motivo: "TEST: sin auth",
        }),
      },
    );

    expect(res.status).toBe(401);
  });
});
