import { describe, it, expect } from "vitest";
import { puedeReclamarGarantia, puedeManipular } from "../../src/lib/ot-flujo";

/**
 * Reclamo de garantía sobre una OT entregada.
 *
 * El motor (fn_abrir_garantia_venta) siempre aceptó `orden_servicio_id`, y el
 * modal siempre tuvo la rama `tipo: "ot"`, pero ningún botón la usaba: el único
 * que abría el modal era VentaDetalle, siempre con `tipo: "venta"`. Estos tests
 * cubren la regla de la puerta nueva.
 *
 * Lo que se está protegiendo es que la pantalla y el servidor digan lo MISMO.
 * Si divergen aparece el peor de los dos mundos: un botón que se ve, se pulsa y
 * revienta contra la RPC.
 */

const DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date("2026-09-05T18:00:00-05:00").getTime();

const otEntregada = (extra = {}) => ({
  estado: "entregada",
  sede_id: "CV",
  fecha: "2026-06-01T10:00:00-05:00",
  fecha_entrega: "2026-08-20T10:00:00-05:00",
  ...extra,
});

const usuario = (rol, sede_id = "CV") => ({ rol, sede_id });

describe("puedeReclamarGarantia — quién", () => {
  it("deja a Admin, Vendedor y Técnico, que son los tres roles que acepta la RPC", () => {
    for (const rol of ["Admin", "Vendedor", "Tecnico"]) {
      expect(
        puedeReclamarGarantia(usuario(rol), otEntregada(), 90, AHORA).puede,
      ).toBe(true);
    }
  });

  it("no deja al Bodeguero: la RPC lo rechaza, así que el botón no debe existir", () => {
    expect(
      puedeReclamarGarantia(usuario("Bodeguero"), otEntregada(), 90, AHORA)
        .puede,
    ).toBe(false);
  });

  /**
   * Este es el caso por el que la regla NO se apoya en `puedeManipular`: esa
   * función le dice que no al Técnico porque no ejecuta el flujo de la OT, pero
   * la RPC sí lo deja abrir garantías. Gatear con ella le habría escondido el
   * botón sin motivo.
   */
  it("le deja al Técnico reclamar aunque puedeManipular le diga que no", () => {
    const tecnico = usuario("Tecnico");
    const ot = otEntregada();
    expect(puedeManipular(tecnico, ot)).toBe(false);
    expect(puedeReclamarGarantia(tecnico, ot, 90, AHORA).puede).toBe(true);
  });

  it("no deja reclamar sobre una OT de otra sede si no es Admin", () => {
    const ot = otEntregada({ sede_id: "L3" });
    expect(
      puedeReclamarGarantia(usuario("Vendedor", "CV"), ot, 90, AHORA).puede,
    ).toBe(false);
    expect(
      puedeReclamarGarantia(usuario("Admin", "BODEGA"), ot, 90, AHORA).puede,
    ).toBe(true);
  });

  it("no deja reclamar sobre una OT que todavía no se entrega", () => {
    for (const estado of ["abierta", "en_proceso", "terminada", "cancelada"]) {
      expect(
        puedeReclamarGarantia(
          usuario("Vendedor"),
          otEntregada({ estado }),
          90,
          AHORA,
        ).puede,
      ).toBe(false);
    }
  });
});

describe("puedeReclamarGarantia — hasta cuándo", () => {
  it("cuenta desde la ENTREGA, no desde la apertura de la OT", () => {
    // Abierta el 1 de junio y entregada el 20 de agosto. Contando desde la
    // apertura ya estaría vencida; contando desde la entrega está viva. En
    // producción hay OT que tardaron semanas, así que la diferencia es real.
    const r = puedeReclamarGarantia(usuario("Admin"), otEntregada(), 90, AHORA);
    expect(r.vigente).toBe(true);
    expect(r.vence.toISOString().slice(0, 10)).toBe("2026-11-18");
  });

  it("cae de vuelta a la fecha de apertura si no hubiera fecha_entrega", () => {
    const ot = otEntregada({ fecha_entrega: null });
    const r = puedeReclamarGarantia(usuario("Admin"), ot, 90, AHORA);
    expect(r.vence.toISOString().slice(0, 10)).toBe("2026-08-30");
    expect(r.vigente).toBe(false);
  });

  it("vencida: no da permiso pero sí la fecha, para poder explicarla", () => {
    const ot = otEntregada({ fecha_entrega: "2026-01-10T10:00:00-05:00" });
    const r = puedeReclamarGarantia(usuario("Admin"), ot, 90, AHORA);
    expect(r.puede).toBe(false);
    // `habilitado` sigue en true: no es que no le toque, es que se le pasó el
    // plazo. La pantalla usa esa diferencia para decir el porqué.
    expect(r.habilitado).toBe(true);
    expect(r.vence).toBeInstanceOf(Date);
  });

  it("el último día todavía cuenta, y el siguiente ya no", () => {
    const entrega = "2026-06-07T18:00:00-05:00";
    const ot = otEntregada({ fecha_entrega: entrega });
    const justo = new Date(entrega).getTime() + 90 * DIA;
    expect(puedeReclamarGarantia(usuario("Admin"), ot, 90, justo).vigente).toBe(
      true,
    );
    expect(
      puedeReclamarGarantia(usuario("Admin"), ot, 90, justo + 1000).vigente,
    ).toBe(false);
  });

  it("respeta un plazo distinto al de 90 días", () => {
    // El plazo sale de parametros_sistema.dias_garantia_venta. Si algún día se
    // configura otro, la pantalla tiene que moverse con él y no quedarse en 90.
    const ot = otEntregada({ fecha_entrega: "2026-08-20T10:00:00-05:00" });
    expect(puedeReclamarGarantia(usuario("Admin"), ot, 10, AHORA).vigente).toBe(
      false,
    );
    expect(
      puedeReclamarGarantia(usuario("Admin"), ot, 365, AHORA).vigente,
    ).toBe(true);
  });

  it("sin ninguna fecha no inventa una ventana abierta", () => {
    const ot = { estado: "entregada", sede_id: "CV", fecha: null };
    const r = puedeReclamarGarantia(usuario("Admin"), ot, 90, AHORA);
    expect(r.vence).toBeNull();
    expect(r.puede).toBe(false);
  });
});
