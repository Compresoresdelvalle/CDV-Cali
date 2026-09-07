import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import BarraRango from "../../src/components/panel/BarraRango";

vi.mock("../../src/lib/supabase", () => {
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    then: (r) => Promise.resolve({ data: [], error: null }).then(r),
  };
  return {
    supabase: {
      from: () => q,
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

let perfilActual = { rol: "Admin", sede_id: "BODEGA", nombre: "Admin Maritza" };
vi.mock("../../src/stores/authStore", () => ({
  get useAuthStore() {
    const usar = (sel) =>
      typeof sel === "function"
        ? sel({ perfil: perfilActual })
        : { perfil: perfilActual };
    usar.getState = () => ({ perfil: perfilActual });
    usar.setState = () => {};
    usar.subscribe = () => () => {};
    return usar;
  },
}));

/**
 * Prueba de humo del panel.
 *
 * Ni el build ni eslint ejecutan un componente: un error de render pasa las dos
 * y llega a producción con la pantalla inservible. Ya ocurrió dos veces en este
 * proyecto. `renderToStaticMarkup` sí corre el cuerpo y sus hooks.
 *
 * No comprueba cómo se ve nada: responde si abre y si dice lo que debe decir.
 */

const montar = (props) =>
  renderToStaticMarkup(
    createElement(BarraRango, {
      rango: { desde: "2026-09-01", hasta: "2026-09-15" },
      atajo: "mes",
      onCambio() {},
      sede: "",
      sedes: [{ id: "CV", nombre: "Cali Valle" }],
      onSede() {},
      actualizado: new Date("2026-09-15T10:00:00Z"),
      cargando: false,
      onRefrescar() {},
      ...props,
    }),
  );

describe("BarraRango", () => {
  it("monta sin reventar", () => {
    expect(() => montar()).not.toThrow();
  });

  it("dice el rango en español, no solo las fechas", () => {
    // Es la frase que quita el tener que adivinar qué periodo está aplicado.
    expect(montar()).toContain("Del 1 al 15 de septiembre de 2026");
  });

  it("dice contra qué se compara", () => {
    expect(montar()).toContain("comparando contra");
  });

  it("avisa cuando no hay con qué comparar, en vez de callarse", () => {
    // Junio es el primer mes con datos: no hay mayo contra el cual comparar, y
    // pintar un −100% sería mentir.
    const html = montar({
      rango: { desde: "2026-06-01", hasta: "2026-06-30" },
      atajo: "mes_pasado",
    });
    expect(html).toContain("sin datos para comparar");
    expect(html).not.toContain("comparando contra");
  });

  it("trae los ocho atajos", () => {
    const html = montar();
    for (const t of [
      "Hoy",
      "Ayer",
      "Esta semana",
      "Este mes",
      "Mes pasado",
      "Este año",
      "Últimos 30",
      "Últimos 90",
    ]) {
      expect(html).toContain(t);
    }
  });

  it("muestra hace cuánto se actualizó", () => {
    // El botón del panel viejo parecía roto porque no daba ninguna señal.
    expect(montar()).toContain("Actualizado");
  });

  it("mientras carga lo dice y no deja pulsar de nuevo", () => {
    const html = montar({ cargando: true });
    expect(html).toContain("disabled");
    expect(html).toContain("Actualizando");
  });

  it("aguanta que no haya sedes ni fecha de actualización", () => {
    expect(() => montar({ sedes: [], actualizado: null })).not.toThrow();
  });
});

describe("Panel", () => {
  const montar = async () => {
    const Panel = (await import("../../src/pages/admin/Panel")).default;
    return renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(Panel)),
    );
  };

  it("monta como Admin", async () => {
    perfilActual = { rol: "Admin", sede_id: "BODEGA", nombre: "Admin Maritza" };
    await expect(montar()).resolves.toBeTruthy();
  });

  it("el rango manda desde el primer render", async () => {
    perfilActual = { rol: "Admin", sede_id: "BODEGA", nombre: "Admin Maritza" };
    const html = await montar();
    // La barra tiene que estar montada con su frase, no un placeholder.
    expect(html).toContain("Actualizado");
    expect(html).toContain("Este mes");
  });

  it("a una vendedora le explica por que no ve el margen, no le da error", async () => {
    // Un error de permisos parece una falla; una explicacion no.
    perfilActual = { rol: "Vendedor", sede_id: "CV", nombre: "Deyanira" };
    const html = await montar();
    expect(html).toContain("información de administración");
    expect(html).not.toContain("Reintentar");
  });
});

describe("Seccion", () => {
  const montar = async (props) => {
    const S = (await import("../../src/components/panel/Seccion")).default;
    return renderToStaticMarkup(
      createElement(S, { titulo: "Prueba", ...props }),
    );
  };

  it("cargando pinta un esqueleto con la forma del contenido", async () => {
    const html = await montar({ cargando: true, filasEsqueleto: 3 });
    expect(html).toContain('aria-busy="true"');
    expect((html.match(/animate-pulse/g) ?? []).length).toBe(3);
  });

  it("vacio explica, no deja la tarjeta en blanco", async () => {
    const html = await montar({
      vacio: true,
      mensajeVacio: "Ningún producto se vendió bajo costo.",
    });
    expect(html).toContain("Ningún producto se vendió bajo costo.");
  });

  it("el error se queda dentro de la seccion y ofrece reintentar solo esa", async () => {
    const html = await montar({
      error: "No se pudo cargar",
      onReintentar() {},
    });
    expect(html).toContain("No se pudo cargar");
    expect(html).toContain("Reintentar esta sección");
  });

  it("sin permiso explica en vez de parecer una falla", async () => {
    const html = await montar({ sinPermiso: true });
    expect(html).toContain("información de administración");
    expect(html).not.toContain("Reintentar");
  });
});

describe("ClasificarEgresos", () => {
  const montar = async () => {
    const P = (await import("../../src/pages/admin/ClasificarEgresos")).default;
    return renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(P)),
    );
  };

  it("monta como Admin", async () => {
    perfilActual = { rol: "Admin", sede_id: "BODEGA", nombre: "Admin Maritza" };
    await expect(montar()).resolves.toBeTruthy();
  });
});

describe("agruparEgresos", () => {
  it("junta los conceptos escritos distinto", async () => {
    // El caso real: 'NOMIN', 'NOMINAS', 'NOM E' son todos nomina. Sin agrupar,
    // clasificar 465 movimientos uno por uno no lo hace nadie.
    const { agruparEgresos } = await import("../../src/lib/panel-egresos");
    const g = agruparEgresos([
      { id: "1", concepto: "NOMINA", total: 100 },
      { id: "2", concepto: "NOMINAS", total: 200 },
      { id: "3", concepto: "nomina m", total: 300 },
      { id: "4", concepto: "GASOLINA", total: 50 },
    ]);
    const nomina = g.find((x) => x.clave === "NOMINA");
    expect(nomina.items).toHaveLength(2); // NOMINA y nomina m
    expect(g.find((x) => x.clave === "NOMINAS").items).toHaveLength(1);
  });

  it("ordena por monto: bajar los pesos del margen de error es lo que importa", async () => {
    // Por CANTIDAD manda gasolina (71 movimientos chicos); por MONTO manda la
    // nomina. Se ordena por monto porque el aviso del Resultado se mide en
    // pesos, no en cuantos movimientos faltan.
    const { agruparEgresos } = await import("../../src/lib/panel-egresos");
    const g = agruparEgresos([
      { id: "1", concepto: "GASOLINA", total: 1000 },
      { id: "2", concepto: "GASOLINA", total: 1000 },
      { id: "3", concepto: "GASOLINA", total: 1000 },
      { id: "4", concepto: "NOMINA", total: 10000 },
    ]);
    expect(g[0].clave).toBe("NOMINA");
    expect(g[0].monto).toBe(10000);
    expect(g[1].items).toHaveLength(3);
  });

  it("un concepto vacio no se pierde: cae en SIN CONCEPTO", async () => {
    const { agruparEgresos } = await import("../../src/lib/panel-egresos");
    const g = agruparEgresos([
      { id: "1", concepto: null, total: 100 },
      { id: "2", concepto: "   ", total: 200 },
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].clave).toBe("SIN CONCEPTO");
    expect(g[0].items).toHaveLength(2);
  });

  it("aguanta una lista vacia", async () => {
    const { agruparEgresos } = await import("../../src/lib/panel-egresos");
    expect(agruparEgresos([])).toEqual([]);
  });
});

const RESULTADO = {
  ventas_netas: 436524418,
  costo_vendido: 116922362,
  margen_bruto: 319602056,
  margen_pct: 73.2,
  gastos: 111085943,
  gastos_clasificados: 0,
  resultado: 208516113,
  n_ventas: 1879,
  margen_productos: {
    venta: 333310259,
    costo: 116922362,
    margen: 216387897,
    pct: 64.9,
  },
  margen_servicios: { venta: 72189460, costo: 0, margen: 72189460, pct: 100 },
  sin_clasificar: { n: 465, monto: 111085943, resultado_mejor_caso: 319602056 },
};

describe("Cascada", () => {
  const montar = async (datos) => {
    const C = (await import("../../src/components/panel/Cascada")).default;
    return renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(C, { datos })),
    );
  };

  it("muestra los cinco renglones", async () => {
    const html = await montar(RESULTADO);
    for (const t of [
      "Ventas netas",
      "Costo de lo vendido",
      "Margen bruto",
      "Gastos operativos",
      "Resultado",
    ]) {
      expect(html).toContain(t);
    }
  });

  it("separa el margen de productos del de servicios", async () => {
    // Mezclados dan 73,2%, que engaña: los servicios entran con costo cero.
    const html = await montar(RESULTADO);
    expect(html).toContain("productos 64.9%");
    expect(html).toContain("servicios 100%");
  });

  it("el aviso es un incentivo, no una amenaza", async () => {
    // Los sin clasificar YA están restados, así que el número mostrado es el
    // peor caso y clasificar solo puede subirlo.
    const html = await montar(RESULTADO);
    expect(html).toContain("puede subir hasta");
    expect(html).not.toContain("bajaría");
    expect(html).toContain("Clasificarlos");
  });

  it("cuando no falta nada por clasificar, el aviso desaparece", async () => {
    const html = await montar({
      ...RESULTADO,
      sin_clasificar: { n: 0, monto: 0, resultado_mejor_caso: 208516113 },
    });
    expect(html).not.toContain("Clasificarlos");
    expect(html).toContain("Solo los egresos clasificados");
  });

  it("un resultado negativo se pinta en destructive", async () => {
    const html = await montar({ ...RESULTADO, resultado: -5000000 });
    expect(html).toContain("--destructive");
  });
});

const PERDIDAS = {
  bajo_costo: {
    monto: 6535825,
    n: 103,
    etiqueta: "Vendido bajo costo",
    unidad: "líneas",
    suma_al_total: true,
  },
  descuentos: {
    monto: 1522551,
    n: 32,
    etiqueta: "Descuentos otorgados",
    unidad: "ventas",
    suma_al_total: true,
  },
  devoluciones: {
    monto: 0,
    n: 0,
    etiqueta: "Devoluciones reembolsadas",
    unidad: "casos",
    suma_al_total: true,
  },
  garantias: {
    monto: 270000,
    n: 4,
    etiqueta: "Garantías reembolsadas",
    unidad: "casos",
    suma_al_total: true,
  },
  retenciones: {
    monto: 0,
    n: 0,
    etiqueta: "Retenciones",
    unidad: "facturas",
    suma_al_total: true,
  },
  ot_no_autorizadas: {
    monto: 1150300,
    n: 54,
    etiqueta: "OT diagnosticadas sin autorizar",
    unidad: "OT",
    suma_al_total: false,
  },
  total: 8328376,
};

describe("Perdidas", () => {
  const montar = async (datos = PERDIDAS) => {
    const P = (await import("../../src/components/panel/Perdidas")).default;
    return renderToStaticMarkup(createElement(P, { datos, onAbrir() {} }));
  };

  it("ordena de mayor a menor: lo que más duele va primero", async () => {
    const html = await montar();
    expect(html.indexOf("Vendido bajo costo")).toBeLessThan(
      html.indexOf("Descuentos otorgados"),
    );
  });

  it("un concepto en cero se muestra: es una respuesta, no un hueco", async () => {
    const html = await montar();
    expect(html).toContain("Devoluciones reembolsadas");
    expect(html).toContain("Retenciones");
  });

  it("las OT sin autorizar van DESPUÉS del total y dicen que no suman", async () => {
    const html = await montar();
    expect(html.indexOf("Total")).toBeLessThan(
      html.indexOf("OT diagnosticadas sin autorizar"),
    );
    expect(html).toContain("no suma al total");
  });
});

describe("PanelDetalle", () => {
  const montar = async (props) => {
    const P = (await import("../../src/components/panel/PanelDetalle")).default;
    return renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(P, props)),
    );
  };

  it("cerrado no pinta nada", async () => {
    expect(await montar({ abierto: false, titulo: "x", onCerrar() {} })).toBe(
      "",
    );
  });

  it("abierto lista las filas y enlaza a su documento", async () => {
    const html = await montar({
      abierto: true,
      titulo: "Vendido bajo costo",
      subtitulo: "Del 1 al 6 de septiembre de 2026",
      filas: [
        {
          fecha: "2026-09-05",
          referencia: "Venta #1234",
          descripcion: "FILTRO × 2",
          monto: 45000,
          doc_tipo: "venta",
          doc_id: "abc",
        },
      ],
      onCerrar() {},
    });
    expect(html).toContain("Vendido bajo costo");
    expect(html).toContain("/ops/ventas/abc");
  });

  it("una garantía enlaza a /ops/garantias/venta/:id, no a /ops/garantias/:id", async () => {
    const html = await montar({
      abierto: true,
      titulo: "Garantías",
      filas: [
        {
          fecha: "2026-09-05",
          referencia: "Garantía #7",
          descripcion: "Motivo",
          monto: 1000,
          doc_tipo: "garantia_venta",
          doc_id: "g7",
        },
      ],
      onCerrar() {},
    });
    expect(html).toContain("/ops/garantias/venta/g7");
  });

  it("vacío lo dice como buena noticia, no como hueco", async () => {
    const html = await montar({
      abierto: true,
      titulo: "Vendido bajo costo",
      filas: [],
      onCerrar() {},
    });
    expect(html).toContain("buena noticia");
  });
});

describe("Composicion", () => {
  const FILAS = [
    {
      clave: "CV",
      etiqueta: "Cali Valle",
      venta: 80000000,
      costo: 20000000,
      margen: 60000000,
      margen_pct: 75,
      n: 400,
    },
    {
      clave: "CHV",
      etiqueta: "Chipichape",
      venta: 45000000,
      costo: 15000000,
      margen: 30000000,
      margen_pct: 66.7,
      n: 250,
    },
    {
      clave: "L3",
      etiqueta: "Local 3",
      venta: 20000000,
      costo: 12000000,
      margen: 8000000,
      margen_pct: 40,
      n: 120,
    },
  ];

  const montar = async (props) => {
    const C = (await import("../../src/components/panel/Composicion")).default;
    return renderToStaticMarkup(
      createElement(C, {
        dimension: "sede",
        onDimension() {},
        filas: FILAS,
        peores: false,
        onPeores() {},
        ...props,
      }),
    );
  };

  it("trae las siete dimensiones para escoger", async () => {
    const html = await montar();
    for (const t of [
      "Sede",
      "Vendedora",
      "Producto",
      "Categoría",
      "Tipo",
      "Método de pago",
      "Cliente",
    ]) {
      expect(html).toContain(t);
    }
  });

  it("muestra el total al pie para poder verificar que las partes suman", async () => {
    const html = await montar();
    expect(html).toContain("Total");
    // 80 + 45 + 20 millones. Si el pie no suma las filas, el desglose no sirve
    // para verificar la cascada.
    expect(html).toContain("145.000.000");
  });

  it("puede invertir el orden para ver los peores", async () => {
    const html = await montar({ peores: true });
    // Con "ver los peores" el de menor margen queda de primero.
    expect(html.indexOf("Local 3")).toBeLessThan(html.indexOf("Cali Valle"));
  });

  it("por defecto ordena por venta, de mayor a menor", async () => {
    const html = await montar();
    expect(html.indexOf("Cali Valle")).toBeLessThan(html.indexOf("Local 3"));
  });

  it("sin ser Admin no se pintan costo ni margen", async () => {
    const html = await montar({ admin: false });
    expect(html).toContain("Cali Valle");
    // 12.000.000 solo aparece como costo; 20.000.000 tambien es una venta.
    expect(html).not.toContain("12.000.000");
    expect(html).not.toContain("66.7%");
    expect(html).not.toContain("Ver los peores");
  });

  it("sin ventas lo dice en vez de dejar una tabla vacía", async () => {
    const html = await montar({ filas: [] });
    expect(html).toContain("No hubo ventas en este rango");
  });
});

describe("Composicion — el total de facturas no puede contar de mas", () => {
  const FILAS = [
    {
      clave: "a",
      etiqueta: "Filtro",
      venta: 100,
      costo: 40,
      margen: 60,
      margen_pct: 60,
      n: 9,
    },
    {
      clave: "b",
      etiqueta: "Manguera",
      venta: 50,
      costo: 20,
      margen: 30,
      margen_pct: 60,
      n: 7,
    },
  ];
  const montar = async (dimension) => {
    const C = (await import("../../src/components/panel/Composicion")).default;
    return renderToStaticMarkup(
      createElement(C, {
        dimension,
        onDimension() {},
        filas: FILAS,
        peores: false,
        onPeores() {},
      }),
    );
  };

  it("por sede suma las facturas: cada venta cae en un renglon", async () => {
    expect(await montar("sede")).toContain(">16<");
  });

  it("por producto NO las suma: una factura sale en varios renglones", async () => {
    const html = await montar("producto");
    expect(html).not.toContain(">16<");
    expect(html).toContain("contaría de más");
  });
});

describe("Cartera", () => {
  const DATOS = {
    total: 5_000_000,
    tramos: [
      { rango: "0-30", monto: 3_000_000, n: 4 },
      { rango: "31-60", monto: 2_000_000, n: 2 },
      { rango: "61-90", monto: 0, n: 0 },
      { rango: "+90", monto: 0, n: 0 },
    ],
    detalle: [
      {
        doc_tipo: "venta",
        doc_id: "11111111-1111-1111-1111-111111111111",
        referencia: "Venta #900",
        descripcion: "TALLERES DEL SUR",
        fecha: "2026-08-20",
        monto: 3_000_000,
        dias: 17,
      },
    ],
  };

  const montar = async (datos = DATOS) => {
    const C = (await import("../../src/components/panel/Cartera")).default;
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(C, { datos, onVerTodas() {} }),
      ),
    );
  };

  it("muestra los cuatro tramos aunque dos estén en cero", async () => {
    const html = await montar();
    for (const t of [
      "Hasta 30 días",
      "De 31 a 60",
      "De 61 a 90",
      "Más de 90 días",
    ]) {
      expect(html).toContain(t);
    }
  });

  it("avisa que es una foto de hoy y que el rango no la filtra", async () => {
    expect(await montar()).toContain("el rango de arriba no la filtra");
  });

  it("cada factura lleva directo a su venta", async () => {
    expect(await montar()).toContain(
      "/ops/ventas/11111111-1111-1111-1111-111111111111",
    );
  });

  it("sin cartera lo dice como la buena noticia que es", async () => {
    const html = await montar({ total: 0, tramos: [], detalle: [] });
    expect(html).toContain("Nadie debe nada");
  });
});

describe("Inventario", () => {
  const montar = async (datos) => {
    const I = (await import("../../src/components/panel/Inventario")).default;
    return renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(I, { datos })),
    );
  };

  it("dice qué parte del capital está dormida, en plata y en porcentaje", async () => {
    const html = await montar({
      valor_costo: 400_000_000,
      dormido: 300_000_000,
      n_dormido: 1500,
      agotados_a: 150,
    });
    expect(html).toContain("1500 productos sin salir en 90 días");
    expect(html).toContain("75% del capital");
  });

  it("cada cifra que exige actuar lleva a dónde hacerlo", async () => {
    const html = await montar({
      valor_costo: 1,
      dormido: 0,
      n_dormido: 0,
      agotados_a: 0,
    });
    expect(html).toContain("/admin/reorden");
    expect(html).toContain("/admin/alertas");
  });

  it("no revienta si la RPC todavía no trajo nada", async () => {
    const html = await montar(undefined);
    expect(html).toContain("Capital en inventario");
  });
});

describe("BotonExportar", () => {
  const montar = async (props) => {
    const B = (await import("../../src/components/panel/BotonExportar"))
      .default;
    return renderToStaticMarkup(
      createElement(B, {
        columnas: [{ clave: "a", titulo: "A" }],
        base: "panel-x",
        rango: { desde: "2026-09-01", hasta: "2026-09-30" },
        ...props,
      }),
    );
  };

  it("se apaga cuando no hay nada que bajar", async () => {
    const html = await montar({ filas: [] });
    expect(html).toContain("disabled");
    expect(html).toContain("No hay nada que exportar");
  });

  it("con filas queda activo", async () => {
    const html = await montar({ filas: [{ a: 1 }] });
    expect(html).not.toContain("disabled");
  });
});
