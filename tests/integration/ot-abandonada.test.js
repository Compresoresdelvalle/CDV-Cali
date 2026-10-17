import { describe, it, expect } from "vitest";
import {
  otCerrada,
  otAbandonada,
  puedeAnular,
  puedeMarcarAbandonada,
  grupoTableroOT,
  GRUPOS_TABLERO,
  estadoEstilo,
  estadoEstiloOT,
  pasoActual,
  ESTADO_LABEL,
  sedeEquipoActual,
  sedeParaAbandonar,
  MOTIVO_ABANDONADA_MIN,
} from "../../src/lib/ot-flujo";
import {
  ordenEstadoPill,
  diasEnEstado,
  construirHistorialOT,
} from "../../src/lib/ordenes-ui";

/**
 * Bloque 5: estado FINAL `abandonada` (equipo que el cliente nunca recogió).
 * Es cerrada e inmutable como entregada/cancelada, pero va en su propio grupo
 * del tablero y en tono de advertencia, no de error.
 */
const admin = { rol: "Admin", sede_id: "BODEGA" };
const vendedora = { rol: "Vendedor", sede_id: "CV" };

describe("OT abandonada: cerrada e inmutable", () => {
  it("cuenta como cerrada junto a entregada y cancelada", () => {
    expect(otCerrada({ estado: "abandonada" })).toBe(true);
    expect(otCerrada({ estado: "entregada" })).toBe(true);
    expect(otCerrada({ estado: "cancelada" })).toBe(true);
    expect(otCerrada({ estado: "terminada" })).toBe(false);
    expect(otCerrada(null)).toBe(false);
  });

  it("otAbandonada solo reconoce ese estado", () => {
    expect(otAbandonada({ estado: "abandonada" })).toBe(true);
    expect(otAbandonada({ estado: "cancelada" })).toBe(false);
  });

  it("una abandonada ya no se puede anular", () => {
    expect(puedeAnular(admin, { estado: "abandonada" })).toBe(false);
  });

  it("queda en el último paso, como una entregada", () => {
    expect(pasoActual({ estado: "abandonada" })).toBe(6);
  });
});

describe("puedeMarcarAbandonada", () => {
  it("solo Admin y solo sobre OT abiertas", () => {
    expect(puedeMarcarAbandonada(admin, { estado: "terminada" })).toBe(true);
    expect(puedeMarcarAbandonada(admin, { estado: "autorizada" })).toBe(true);
    expect(puedeMarcarAbandonada(vendedora, { estado: "terminada" })).toBe(
      false,
    );
    for (const estado of ["entregada", "cancelada", "abandonada"]) {
      expect(puedeMarcarAbandonada(admin, { estado })).toBe(false);
    }
    expect(puedeMarcarAbandonada(admin, null)).toBe(false);
  });
});

describe("grupos del tablero", () => {
  it("abandonada y cancelada tienen grupo propio, no se mezclan con entregada", () => {
    expect(grupoTableroOT("abandonada")).toBe("abandonada");
    expect(grupoTableroOT("cancelada")).toBe("cancelada");
    expect(grupoTableroOT("entregada")).toBe("entregada");
  });

  it("los estados legacy caen en el grupo de su paso", () => {
    expect(grupoTableroOT("pendiente_recogida")).toBe("terminada");
    expect(grupoTableroOT("completada")).toBe("terminada");
    expect(grupoTableroOT("esperando_repuesto")).toBe("en_proceso");
    expect(grupoTableroOT("abierta")).toBe("recepcion");
    expect(grupoTableroOT("desconocido")).toBe("recepcion");
  });

  it("el filtro ofrece Abandonada y va después del flujo normal", () => {
    expect(GRUPOS_TABLERO).toContain("abandonada");
    expect(GRUPOS_TABLERO.indexOf("abandonada")).toBeGreaterThan(
      GRUPOS_TABLERO.indexOf("entregada"),
    );
    expect(ESTADO_LABEL.abandonada).toBe("Abandonada");
  });
});

describe("estilo de la píldora", () => {
  it("usa el token de advertencia, no el rojo de error", () => {
    const s = estadoEstilo("abandonada");
    expect(s.label).toBe("Abandonada");
    expect(s.fg).toBe("hsl(var(--warning))");
    expect(estadoEstiloOT({ estado: "abandonada" }).label).toBe("Abandonada");
  });

  it("la píldora vieja (ordenes-ui) también la reconoce", () => {
    expect(ordenEstadoPill("abandonada").label).toBe("Abandonada");
  });
});

describe("helpers de ordenes-ui", () => {
  it("una cerrada no cuenta días en estado", () => {
    for (const estado of ["entregada", "cancelada", "abandonada"]) {
      expect(diasEnEstado({ estado, fecha: "2020-01-01" }).dias).toBeNull();
    }
  });

  it("el historial marca el cierre como abandonada", () => {
    const ev = construirHistorialOT(
      { estado: "abandonada", fecha: "2026-01-01", cliente_nombre: "X" },
      (d) => d,
    );
    expect(ev.at(-1).act).toBe("Cerrada como abandonada");
  });
});

describe("dónde queda el equipo al abandonar", () => {
  const enSuSede = { sede_id: "CV", sede_equipo_id: null };
  const enBodega = { sede_id: "CV", sede_equipo_id: "BODEGA" };

  it("la sede actual es la de custodia si existe, si no la de la OT", () => {
    expect(sedeEquipoActual(enSuSede)).toBe("CV");
    expect(sedeEquipoActual(enBodega)).toBe("BODEGA");
    expect(sedeEquipoActual(null)).toBeNull();
  });

  it("si no cambia la sede se manda null (el servidor no lo mueve)", () => {
    expect(sedeParaAbandonar(enSuSede, "CV")).toBeNull();
    expect(sedeParaAbandonar(enBodega, "BODEGA")).toBeNull();
    expect(sedeParaAbandonar(enBodega, "")).toBeNull();
  });

  it("si cambia, se manda la sede destino (también para devolverlo a su sede)", () => {
    expect(sedeParaAbandonar(enSuSede, "BODEGA")).toBe("BODEGA");
    expect(sedeParaAbandonar(enBodega, "CV")).toBe("CV");
  });

  it("el mínimo del motivo es el mismo del servidor", () => {
    expect(MOTIVO_ABANDONADA_MIN).toBe(5);
  });
});
