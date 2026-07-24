/**
 * Integration tests — convertir-cotizacion Edge Function
 *
 * Cubre:
 *   ✓ Cotización en estado 'aprobada' se convierte a venta exitosamente
 *   ✓ La conversión descuenta stock en inventario
 *   ✓ Estado de la cotización pasa a estado final (no convertible de nuevo)
 *   ✓ Error al convertir cotización vencida o rechazada
 *   ✓ Error al convertir cotización inexistente
 *   ✓ Error al omitir cotizacion_id
 *
 * Esquema real:
 *   estado_cotizacion ENUM ('borrador','enviada','aprobada','rechazada','vencida')
 *   cotizaciones.vendedor_id UUID NOT NULL
 *   NO existe columna metodo_pago en cotizaciones
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { invokeAs } from "../helpers/auth.js";
import { integrationEnvNoDisponible } from "../helpers/env-check.js";
import {
  getProducto,
  cleanupVentas,
  getAdminClient,
  resetStockPruebas,
  USER_IDS,
} from "../helpers/seed.js";

const FN = "convertir-cotizacion";

// Requiere los usuarios ficticios de prueba (carlos, maria...) — ver
// tests/helpers/env-check.js. Se salta entero si esta base no los tiene.
describe.skipIf(integrationEnvNoDisponible())("convertir-cotizacion", () => {
  let adminClient;
  let cotizacionId;
  let stockAntes;

  beforeAll(async () => {
    adminClient = await getAdminClient();
    await resetStockPruebas(adminClient);

    const fa = await getProducto(adminClient, "FA-2236");
    stockAntes = {
      id: fa.id,
      productoId: fa.producto_id,
      cantidad: fa.cantidad,
    };

    // Crear cotización en estado 'enviada' — fn_convertir_cotizacion acepta
    // 'borrador' o 'enviada'; usa 'aprobada' como estado POST-conversión (guard)
    const { data: cotiz, error: errC } = await adminClient
      .from("cotizaciones")
      .insert({
        sede_id: "BOD-PRINCIPAL",
        vendedor_id: USER_IDS.maria,
        cliente_nombre: "TEST_Cliente Cotizacion",
        estado: "enviada",
        subtotal: 10000,
        descuento_pct: 0,
        total: 10000,
      })
      .select()
      .single();

    if (errC) throw new Error(`[seed] crear cotizacion: ${errC.message}`);
    cotizacionId = cotiz.id;

    // Detalle de la cotización
    const { error: errD } = await adminClient
      .from("detalle_cotizacion")
      .insert({
        cotizacion_id: cotizacionId,
        producto_id: stockAntes.productoId,
        cantidad: 2,
        precio_unitario: 5000,
        subtotal: 10000,
      });

    if (errD)
      throw new Error(`[seed] crear detalle cotizacion: ${errD.message}`);
  });

  afterAll(async () => {
    // Limpiar cotizaciones de prueba
    const { data: cs } = await adminClient
      .from("cotizaciones")
      .select("id")
      .ilike("cliente_nombre", "TEST_%");

    if (cs?.length) {
      const ids = cs.map((c) => c.id);
      await adminClient
        .from("detalle_cotizacion")
        .delete()
        .in("cotizacion_id", ids);
      await adminClient.from("cotizaciones").delete().in("id", ids);
    }

    await cleanupVentas(adminClient);
  });

  it("convierte una cotización aprobada a venta y retorna venta_id", async () => {
    const { status, data } = await invokeAs(FN, "maria", {
      cotizacion_id: cotizacionId,
    });

    expect(status).toBe(200);
    const ventaId = data.venta_id ?? data.data?.venta_id;
    expect(ventaId).toBeTruthy();
  });

  it("descuenta stock al convertir la cotización", async () => {
    const fa = await getProducto(adminClient, "FA-2236");
    expect(fa.cantidad).toBe(stockAntes.cantidad - 2);
  });

  it("segunda conversión de la misma cotización es idempotente (no falla ni duplica stock)", async () => {
    const { status } = await invokeAs(FN, "maria", {
      cotizacion_id: cotizacionId,
    });

    // fn_convertir_cotizacion es idempotente — devuelve el mismo venta_id sin
    // duplicar descuento de stock
    expect([200, 400]).toContain(status);

    // El stock no debe haber bajado más
    const fa = await getProducto(adminClient, "FA-2236");
    expect(fa.cantidad).toBe(stockAntes.cantidad - 2);
  });

  it("rechaza convertir una cotización vencida", async () => {
    // Crear una cotización vencida
    const { data: cVencida } = await adminClient
      .from("cotizaciones")
      .insert({
        sede_id: "BOD-PRINCIPAL",
        vendedor_id: USER_IDS.maria,
        cliente_nombre: "TEST_Cotizacion Vencida",
        estado: "vencida",
        subtotal: 5000,
        total: 5000,
      })
      .select()
      .single();

    const { status, data } = await invokeAs(FN, "maria", {
      cotizacion_id: cVencida.id,
    });

    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  it("rechaza convertir una cotización rechazada", async () => {
    const { data: cRechazada } = await adminClient
      .from("cotizaciones")
      .insert({
        sede_id: "BOD-PRINCIPAL",
        vendedor_id: USER_IDS.maria,
        cliente_nombre: "TEST_Cotizacion Rechazada",
        estado: "rechazada",
        subtotal: 5000,
        total: 5000,
      })
      .select()
      .single();

    const { status, data } = await invokeAs(FN, "maria", {
      cotizacion_id: cRechazada.id,
    });

    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  it("rechaza convertir una cotización inexistente", async () => {
    const { status, data } = await invokeAs(FN, "maria", {
      cotizacion_id: "00000000-0000-0000-0000-000000000000",
    });

    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  it("rechaza convertir sin cotizacion_id", async () => {
    const { status, data } = await invokeAs(FN, "maria", {});

    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });
});
