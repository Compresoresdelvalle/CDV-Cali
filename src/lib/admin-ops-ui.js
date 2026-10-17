/**
 * Helpers de presentación para las páginas operativas del Panel Admin
 * (diseño Lovable "cockpit", tema oscuro de `.admin-shell`).
 *
 * Solo presentación: formateo, mapeos de tokens semánticos e iniciales.
 * NO contiene lógica de datos ni fetching. Las páginas siguen consumiendo
 * sus queries/RPC reales (movimientos, conteos, cierres, notas crédito).
 */

/**
 * Token semántico para un tipo de movimiento de inventario.
 * Salidas → destructive, entradas → success, ajustes → warning, otro → muted.
 * @param {string|null|undefined} tipo
 * @returns {string} nombre de variable CSS sin `hsl(var(...))`
 */
export function movimientoToken(tipo) {
  const salidas = [
    "venta",
    "traspaso_salida",
    "ensamble_consumo",
    "orden_consumo",
    "garantia_salida",
  ];
  const entradas = [
    "compra",
    "traspaso_entrada",
    "devolucion",
    "ensamble_produccion",
    "garantia_entrada",
  ];
  if (salidas.includes(tipo)) return "--destructive";
  if (entradas.includes(tipo)) return "--success";
  if (tipo === "ajuste" || tipo === "conteo_ajuste") return "--warning";
  return "--muted-foreground";
}

/** Etiqueta legible (sin guiones bajos) de un tipo de movimiento. */
export function movimientoLabel(tipo) {
  if (!tipo) return "—";
  return tipo.replace(/_/g, " ");
}

/**
 * Iniciales (máx. 2) a partir de un nombre, para avatares de usuario.
 * @param {string|null|undefined} nombre
 * @returns {string}
 */
export function iniciales(nombre) {
  const partes = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "—";
  return partes
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Token semántico según el signo de una diferencia/delta de stock.
 * 0 → success (cuadrado), positivo → info (sobrante), negativo → destructive.
 * @param {number} diff
 * @returns {string} nombre de variable CSS sin `hsl(var(...))`
 */
export function diferenciaToken(diff) {
  if (diff === 0) return "--success";
  if (diff > 0) return "--info";
  return "--destructive";
}

/**
 * Estilos inline (fondo translúcido + texto + borde) para un badge/pill
 * a partir de un token semántico, respetando el tema oscuro.
 * @param {string} token nombre de variable CSS sin `hsl(var(...))`
 * @returns {{ backgroundColor: string, color: string, borderColor: string }}
 */
export function pillStyle(token) {
  return {
    backgroundColor: `hsl(var(${token}) / 0.12)`,
    color: `hsl(var(${token}))`,
    borderColor: `hsl(var(${token}) / 0.4)`,
  };
}

/**
 * Estilos inline para un input/select en superficie de card (tema oscuro).
 * @returns {{ backgroundColor: string, borderColor: string, color: string }}
 */
export const surfaceInputStyle = {
  backgroundColor: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
  color: "hsl(var(--foreground))",
};

/**
 * Módulo legible (origen funcional) de un tipo de movimiento de inventario.
 * Sirve para la columna "Módulo" del registro de actividad (diseño Lovable),
 * derivado del `tipo` real — no es un campo inventado.
 * @param {string|null|undefined} tipo
 * @returns {string}
 */
export function movimientoModulo(tipo) {
  const map = {
    venta: "Ventas",
    compra: "Compras",
    traspaso_salida: "Traspasos",
    traspaso_entrada: "Traspasos",
    ajuste: "Inventario",
    conteo_ajuste: "Conteo",
    ensamble_consumo: "Ensambles",
    ensamble_produccion: "Ensambles",
    devolucion: "Devoluciones",
    orden_consumo: "Órdenes de trabajo",
    // Pasar unidades entre stock de venta y stock de insumo (ProductoDetalle,
    // descarga de OT). Antes caían en "Sistema".
    conversion_a_insumo: "Insumos",
    conversion_a_venta: "Insumos",
    // Salida/reingreso de piezas por garantía de venta o de compra.
    garantia_salida: "Garantías",
    garantia_entrada: "Garantías",
  };
  return map[tipo] ?? "Sistema";
}

/**
 * Estilos inline (pill redondeada estilo Lovable) para la clasificación ABC.
 * A → destructive (alto valor), B → warning (medio), C → muted (cola larga).
 * @param {string|null|undefined} clase
 * @returns {{ backgroundColor: string, color: string, borderColor: string }}
 */
export function clasePillStyle(clase) {
  const token =
    clase === "A" ? "--destructive" : clase === "B" ? "--warning" : null;
  if (!token) {
    return {
      backgroundColor: "hsl(var(--muted) / 0.5)",
      color: "hsl(var(--muted-foreground))",
      borderColor: "hsl(var(--border))",
    };
  }
  return pillStyle(token);
}

/* ── Auditoría: origen en palabras y valor en pesos ─────────────────────── */

/**
 * De dónde sale el documento de cada `referencia_tipo` de `movimientos`.
 * `tabla`/`select` se usan para resolver en lote (un `.in()` por tipo y por
 * página). Los tipos sin tabla (conteo, conversion) no se consultan.
 */
export const ORIGEN_FUENTES = {
  orden_servicio: {
    tabla: "ordenes_servicio",
    select: "id, numero, cliente_nombre",
  },
  venta: { tabla: "ventas", select: "id, numero" },
  compra: { tabla: "compras", select: "id, numero" },
  ensamble: { tabla: "ensambles", select: "id, numero" },
  traspaso: { tabla: "traspasos", select: "id, numero" },
  devolucion: { tabla: "devoluciones", select: "id, numero" },
  garantia_compra: { tabla: "garantias_compra", select: "id, numero" },
  garantia_venta: { tabla: "garantias_venta", select: "id, numero" },
  herramienta: {
    tabla: "herramientas_prestamo",
    select: "id, herramienta_nombre",
  },
};

/**
 * Documento de origen en palabras: "OT #285 · cliente", "Venta #12"...
 * `doc` es la fila ya resuelta (o null si no se encontró).
 * @returns {string}
 */
export function etiquetaOrigen(referenciaTipo, doc) {
  const n = doc?.numero != null ? ` #${doc.numero}` : "";
  switch (referenciaTipo) {
    case "orden_servicio": {
      const cliente = doc?.cliente_nombre?.trim();
      return `OT${n}${cliente ? ` · ${cliente}` : ""}`;
    }
    case "venta":
      return `Venta${n}`;
    case "compra":
      return `Compra${n}`;
    case "ensamble":
      return `Ensamble${n}`;
    case "traspaso":
      return `Traslado${n}`;
    case "devolucion":
      return `Devolución${n}`;
    case "garantia_compra":
      return `Garantía de compra${n}`;
    case "garantia_venta":
      return `Garantía de venta${n}`;
    case "herramienta": {
      const nombre = doc?.herramienta_nombre?.trim();
      return `Herramienta${nombre ? ` · ${nombre}` : ""}`;
    }
    case "conteo":
      return "Conteo cíclico";
    case "conversion":
      return "Conversión venta ↔ insumo";
    default:
      return referenciaTipo ? referenciaTipo.replace(/_/g, " ") : "—";
  }
}

/**
 * Ruta de la app para abrir el documento de origen; null si no tiene pantalla.
 * Solo se arma con id (salvo los tipos que abren un listado).
 */
export function rutaOrigen(referenciaTipo, id) {
  switch (referenciaTipo) {
    case "orden_servicio":
      return id ? `/ops/ordenes/${id}` : null;
    case "venta":
      return id ? `/ops/ventas/${id}` : null;
    case "compra":
      return id ? `/ops/compras/${id}` : null;
    case "ensamble":
      return id ? `/ops/ensambles/${id}` : null;
    case "traspaso":
      return id ? `/ops/traspasos/${id}` : null;
    case "devolucion":
      return id ? `/ops/devoluciones/${id}` : null;
    case "garantia_compra":
      return id ? `/ops/garantias/compra/${id}` : null;
    case "garantia_venta":
      return id ? `/ops/garantias/venta/${id}` : null;
    // Sin pantalla de detalle por id: se abre el listado.
    case "herramienta":
      return "/ops/herramientas";
    case "conteo":
      return "/admin/conteo";
    default:
      return null;
  }
}

/**
 * Precio unitario de un producto dentro de un documento (venta o compra) a
 * partir de sus líneas. Si el producto aparece en varias líneas con precios
 * distintos no se puede saber cuál movió este stock: devuelve null (no se
 * inventa un promedio).
 * @param {Array<{precio: number|string|null}>} lineas
 * @returns {number|null}
 */
export function precioUnicoDeLineas(lineas) {
  const precios = [
    ...new Set(
      (lineas ?? [])
        .map((l) => (l?.precio == null ? null : Number(l.precio)))
        .filter((p) => p != null && Number.isFinite(p)),
    ),
  ];
  return precios.length === 1 ? precios[0] : null;
}

/**
 * Valor en pesos de un movimiento: unidades × precio.
 * - `precio` null/no numérico → null (se muestra "—").
 * - `aCosto` = el precio es el costo promedio del producto, no el del documento.
 *   Un costo ≤ 0 se trata como desconocido (costo sin cargar), no como $0.
 * @returns {{unidades:number, precio:number, total:number, aCosto:boolean}|null}
 */
export function valorMovimiento(cantidad, precio, { aCosto = false } = {}) {
  const unidades = Math.abs(Number(cantidad));
  const p = precio == null ? NaN : Number(precio);
  if (!Number.isFinite(unidades) || unidades === 0 || !Number.isFinite(p)) {
    return null;
  }
  if (aCosto && p <= 0) return null;
  return { unidades, precio: p, total: unidades * p, aCosto };
}

const fmtPesos = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Pesos COP sin decimales ("$ 45.000"). */
export function formatPesos(n) {
  return fmtPesos.format(Math.round(Number(n) || 0));
}

/** "2 uds × $ 45.000 = $ 90.000" o "—" si no se pudo determinar. */
export function textoValorMovimiento(v) {
  if (!v) return "—";
  const uds = `${v.unidades} ${v.unidades === 1 ? "ud" : "uds"}`;
  return `${uds} × ${formatPesos(v.precio)} = ${formatPesos(v.total)}`;
}
