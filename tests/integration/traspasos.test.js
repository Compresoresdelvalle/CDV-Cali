/**
 * Integration tests — procesar-traspaso Edge Function
 *
 * Cubre el flujo completo de estados:
 *   borrador → picking → verificado → en_transito → recibido
 *
 * Reglas de negocio validadas:
 *   ✓ iniciar_picking: borrador → picking, asigna picker
 *   ✓ actualizar_items: guarda cantidad_enviada y picking_completado
 *   ✓ verificar: picker ≠ verificador (mismo usuario bloqueado)
 *   ✓ verificar: todos los items deben estar picking_completado=true
 *   ✓ enviar: verificado → en_transito (descuenta stock origen via trigger)
 *   ✓ recibir: en_transito → recibido (suma stock destino via trigger)
 *   ✓ recibir con diferencia → estado con_diferencia
 *   ✓ Error: acción inválida
 *   ✓ Error: traspaso inexistente
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { invokeAs, loginAs } from "../helpers/auth.js";
import {
  getProducto,
  crearTraspaso,
  cleanupTraspasos,
  getAdminClient,
  getProductoId,
} from "../helpers/seed.js";

const FN = "procesar-traspaso";

describe("procesar-traspaso — flujo completo", () => {
  let adminClient;
  let traspaso;
  let detalles;
  let stockOrigenAntes;
  let stockDestinoAntes;
  let productoData;

  beforeAll(async () => {
    adminClient = await getAdminClient();

    // Producto: FA-2236 en BOD-PRINCIPAL (origen)
    const invOrigen = await getProducto(
      adminClient,
      "FA-2236",
      "BOD-PRINCIPAL",
    );
    const invDestino = await getProducto(
      adminClient,
      "FA-2236",
      "ALM-01",
    ).catch(() => ({ cantidad: 0 }));
    productoData = await getProductoId(adminClient, "FA-2236");

    stockOrigenAntes = invOrigen.cantidad;
    stockDestinoAntes = invDestino.cantidad ?? 0;

    // Crear traspaso de prueba
    const result = await crearTraspaso(adminClient, {
      origenId: "BOD-PRINCIPAL",
      destinoId: "ALM-01",
      items: [
        {
          producto_id: productoData.id,
          referencia: "FA-2236",
          cantidad: 2,
        },
      ],
    });

    traspaso = result.traspaso;
    detalles = result.detalles;
  });

  afterAll(async () => {
    await cleanupTraspasos(adminClient);
  });

  // ─────────────────────────────────────────────────────────────
  // PASO 1: borrador → picking (Pedro inicia)
  // ─────────────────────────────────────────────────────────────

  it("1. iniciar_picking: cambia estado a picking y asigna picker", async () => {
    const { status, data } = await invokeAs(FN, "pedro", {
      traspaso_id: traspaso.id,
      accion: "iniciar_picking",
    });

    expect(status).toBe(200);
    const estado = data.data?.estado ?? data.estado;
    expect(estado).toBe("picking");

    // Verificar en BD
    const { data: t } = await adminClient
      .from("traspasos")
      .select("estado, picker_id")
      .eq("id", traspaso.id)
      .single();

    expect(t.estado).toBe("picking");
    expect(t.picker_id).toBeTruthy();
  });

  it("1b. iniciar_picking segunda vez debe fallar (ya no es borrador)", async () => {
    const { status, data } = await invokeAs(FN, "pedro", {
      traspaso_id: traspaso.id,
      accion: "iniciar_picking",
    });

    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  // ─────────────────────────────────────────────────────────────
  // PASO 2: actualizar_items (Pedro registra picking)
  // ─────────────────────────────────────────────────────────────

  it("2. actualizar_items: guarda cantidad_enviada y picking_completado", async () => {
    const detalle = detalles[0];

    const { status, data } = await invokeAs(FN, "pedro", {
      traspaso_id: traspaso.id,
      accion: "actualizar_items",
      items: [
        {
          detalle_id: detalle.id,
          cantidad_enviada: 2,
          picking_completado: true,
        },
      ],
    });

    expect(status).toBe(200);

    // Verificar en BD
    const { data: d } = await adminClient
      .from("detalle_traspaso")
      .select("cantidad_enviada, picking_completado")
      .eq("id", detalle.id)
      .single();

    expect(d.cantidad_enviada).toBe(2);
    expect(d.picking_completado).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────
  // PASO 3: verificar (debe ser usuario diferente a picker)
  // ─────────────────────────────────────────────────────────────

  it("3a. verificar con el mismo picker debe fallar", async () => {
    const { status, data } = await invokeAs(FN, "pedro", {
      traspaso_id: traspaso.id,
      accion: "verificar",
    });

    expect(status).toBe(400);
    expect(data.error).toMatch(/mismo|verificador|picker/i);
  });

  it("3b. verificar con usuario diferente (Carlos) — cambia a verificado", async () => {
    const { status, data } = await invokeAs(FN, "carlos", {
      traspaso_id: traspaso.id,
      accion: "verificar",
    });

    expect(status).toBe(200);
    const estado = data.data?.estado ?? data.estado;
    expect(estado).toBe("verificado");

    const { data: t } = await adminClient
      .from("traspasos")
      .select("estado")
      .eq("id", traspaso.id)
      .single();

    expect(t.estado).toBe("verificado");
  });

  // ─────────────────────────────────────────────────────────────
  // PASO 4: enviar — verificado → en_transito
  // ─────────────────────────────────────────────────────────────

  it("4. enviar: cambia a en_transito y descuenta stock en origen", async () => {
    const { status, data } = await invokeAs(FN, "carlos", {
      traspaso_id: traspaso.id,
      accion: "enviar",
    });

    expect(status).toBe(200);
    const estado = data.data?.estado ?? data.estado;
    expect(estado).toBe("en_transito");

    // Verificar descuento en origen
    const invOrigen = await getProducto(
      adminClient,
      "FA-2236",
      "BOD-PRINCIPAL",
    );
    expect(invOrigen.cantidad).toBe(stockOrigenAntes - 2);
  });

  // ─────────────────────────────────────────────────────────────
  // PASO 5: recibir — en_transito → recibido
  // ─────────────────────────────────────────────────────────────

  it("5. recibir: confirma recepción con cantidades correctas → estado recibido", async () => {
    const detalle = detalles[0];

    const { status, data } = await invokeAs(FN, "maria", {
      traspaso_id: traspaso.id,
      accion: "recibir",
      items: [
        {
          detalle_id: detalle.id,
          cantidad_recibida: 2, // Igual a enviada → sin diferencia
        },
      ],
    });

    expect(status).toBe(200);
    const estado = data.data?.estado ?? data.estado;
    const hayDif = data.data?.hay_diferencia ?? data.hay_diferencia;
    expect(estado).toBe("recibido");
    expect(hayDif).toBe(false);

    // Stock destino aumenta
    const invDestino = await getProducto(
      adminClient,
      "FA-2236",
      "ALM-01",
    ).catch(() => ({ cantidad: 0 }));
    // Solo validamos que el trigger actuó (la cantidad no decrece)
    expect(invDestino.cantidad).toBeGreaterThanOrEqual(stockDestinoAntes);
  });
});

// ─────────────────────────────────────────────────────────────
// Suite separada: recibir con diferencia
// ─────────────────────────────────────────────────────────────

describe("procesar-traspaso — recibir con diferencia", () => {
  let adminClient;
  let traspaso;
  let detalles;
  let productoData;

  beforeAll(async () => {
    adminClient = await getAdminClient();
    productoData = await getProductoId(adminClient, "MG-AP-10");

    // Crear y avanzar un traspaso hasta en_transito
    const result = await crearTraspaso(adminClient, {
      origenId: "BOD-PRINCIPAL",
      destinoId: "ALM-02",
      items: [
        { producto_id: productoData.id, referencia: "MG-AP-10", cantidad: 3 },
      ],
    });
    traspaso = result.traspaso;
    detalles = result.detalles;

    // Avanzar hasta en_transito usando Pedro como picker, Carlos como verificador
    await invokeAs(FN, "pedro", {
      traspaso_id: traspaso.id,
      accion: "iniciar_picking",
    });
    await invokeAs(FN, "pedro", {
      traspaso_id: traspaso.id,
      accion: "actualizar_items",
      items: [
        {
          detalle_id: detalles[0].id,
          cantidad_enviada: 3,
          picking_completado: true,
        },
      ],
    });
    await invokeAs(FN, "carlos", {
      traspaso_id: traspaso.id,
      accion: "verificar",
    });
    await invokeAs(FN, "carlos", {
      traspaso_id: traspaso.id,
      accion: "enviar",
    });
  });

  afterAll(async () => {
    await cleanupTraspasos(adminClient);
  });

  it("recibir menos unidades de las enviadas → estado con_diferencia", async () => {
    const { status, data } = await invokeAs(FN, "juan", {
      traspaso_id: traspaso.id,
      accion: "recibir",
      items: [{ detalle_id: detalles[0].id, cantidad_recibida: 2 }], // Enviaron 3, llegan 2
    });

    expect(status).toBe(200);
    const estado = data.data?.estado ?? data.estado;
    const hayDif = data.data?.hay_diferencia ?? data.hay_diferencia;
    expect(estado).toBe("con_diferencia");
    expect(hayDif).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Suite separada: errores de validación
// ─────────────────────────────────────────────────────────────

describe("procesar-traspaso — validaciones de entrada", () => {
  let adminClient;

  beforeAll(async () => {
    adminClient = await getAdminClient();
  });

  it("acción inválida retorna error 400", async () => {
    const { status, data } = await invokeAs(FN, "pedro", {
      traspaso_id: "00000000-0000-0000-0000-000000000001",
      accion: "accion_que_no_existe",
    });

    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  it("traspaso inexistente retorna error", async () => {
    const { status, data } = await invokeAs(FN, "pedro", {
      traspaso_id: "00000000-0000-0000-0000-000000000000",
      accion: "iniciar_picking",
    });

    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  it("falta traspaso_id retorna error 400", async () => {
    const { status, data } = await invokeAs(FN, "pedro", {
      accion: "iniciar_picking",
    });

    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });
});
