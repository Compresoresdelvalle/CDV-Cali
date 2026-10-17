/**
 * Bloque 2 — trazabilidad de insumos: para qué se convierte cada unidad de
 * venta a insumo (OT, ensamble, préstamo de herramienta u "Otro").
 *
 * Funciones puras (sin Supabase) para la pantalla que pide el destino, la
 * campana y Auditoría. El contrato del servidor está en
 * `supabase/migrations/20261017190047_conversion_destino.sql`
 * (`fn_convertir_a_insumo(..., p_destino jsonb)`).
 */

/** Estados de OT que ya no aceptan insumo (los mismos que rechaza el RPC). */
export const OT_ESTADOS_CERRADOS = ["entregada", "cancelada", "abandonada"];

/** Etiqueta corta por tipo de destino. */
export const DESTINO_TIPO_LABEL = {
  orden: "OT",
  ensamble: "Ensamble",
  prestamo: "Préstamo de herramienta",
  otro: "Otro",
};

const NOTA_MIN_OTRO = 3;

/**
 * Valida lo que eligió el operario y arma el `p_destino` para el RPC.
 *
 * `sel` = { tipo: 'orden'|'ensamble'|'prestamo'|'otro'|'ninguno'|'',
 *           id?: uuid|'' , nota?: string }
 * - orden: exige id.
 * - ensamble / prestamo: id, o nota (ensamble que aún no existe / para quién).
 * - otro: nota de al menos 3 letras.
 * - ninguno ("Sin destino"): solo válido para Admin → payload null.
 *
 * @returns {{ ok: boolean, motivo: string, payload: object|null }}
 *   `motivo` explica por qué no se puede confirmar todavía (vacío si ok).
 */
export function validarDestinoInsumo(sel, { esAdmin = false } = {}) {
  const tipo = sel?.tipo ?? "";
  const id = (sel?.id ?? "").toString().trim();
  const nota = (sel?.nota ?? "").trim();

  if (!tipo) {
    return {
      ok: false,
      motivo: esAdmin
        ? "Escoge para qué es el insumo, o «Sin destino»."
        : "Escoge para qué es el insumo: así el administrador sabe en qué se usó.",
      payload: null,
    };
  }
  if (tipo === "ninguno") {
    return esAdmin
      ? { ok: true, motivo: "", payload: null }
      : {
          ok: false,
          motivo: "Solo el Admin puede convertir sin indicar el destino.",
          payload: null,
        };
  }
  if (tipo === "orden") {
    return id
      ? { ok: true, motivo: "", payload: { tipo, id } }
      : { ok: false, motivo: "Escoge la OT para la que es.", payload: null };
  }
  if (tipo === "ensamble" || tipo === "prestamo") {
    if (id) return { ok: true, motivo: "", payload: { tipo, id } };
    if (nota) return { ok: true, motivo: "", payload: { tipo, nota } };
    return {
      ok: false,
      motivo:
        tipo === "ensamble"
          ? "Escoge el ensamble o escribe cuál vas a crear."
          : "Escoge el préstamo o escribe para quién es la herramienta.",
      payload: null,
    };
  }
  if (tipo === "otro") {
    return nota.length >= NOTA_MIN_OTRO
      ? { ok: true, motivo: "", payload: { tipo, nota } }
      : {
          ok: false,
          motivo: `Con «Otro» escribe una nota corta (mínimo ${NOTA_MIN_OTRO} letras) de para qué es.`,
          payload: null,
        };
  }
  return { ok: false, motivo: "Destino desconocido.", payload: null };
}

/** "OT #285 · Cliente · Equipo" (omite las partes vacías). */
export function etiquetaOT(o) {
  if (!o) return "";
  return [
    `OT #${o.numero ?? "?"}`,
    o.cliente_nombre?.trim(),
    o.equipo_descripcion?.trim(),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "Ensamble #12 · Producto". */
export function etiquetaEnsamble(e) {
  if (!e) return "";
  return [`Ensamble #${e.numero ?? "?"}`, e.producto?.nombre?.trim()]
    .filter(Boolean)
    .join(" · ");
}

/** "Llave de torque · prestada a Luis". */
export function etiquetaPrestamo(h) {
  if (!h) return "";
  const quien = h.usuario?.nombre?.trim();
  return [
    h.herramienta_nombre?.trim() || "Herramienta",
    quien ? `prestada a ${quien}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Ruta de la app para abrir el documento de destino. null si no hay a dónde
 * ir (sin id, u "Otro").
 */
export function rutaDestino(tipo, id) {
  if (tipo === "orden") return id ? `/ops/ordenes/${id}` : null;
  if (tipo === "ensamble") return id ? `/ops/ensambles/${id}` : null;
  // Los préstamos no tienen pantalla de detalle propia: se abre Herramientas.
  if (tipo === "prestamo") return "/ops/herramientas";
  return null;
}

/**
 * Texto del destino de una fila de `conversion_destino` ya resuelta.
 * `docs` = { orden: Map(id → etiqueta), ensamble: Map, prestamo: Map }.
 */
export function textoConversionDestino(fila, docs = {}) {
  if (!fila) return "Sin destino";
  const { tipo, nota } = fila;
  const id =
    tipo === "orden"
      ? fila.orden_id
      : tipo === "ensamble"
        ? fila.ensamble_id
        : tipo === "prestamo"
          ? fila.prestamo_id
          : null;
  const doc = id ? docs[tipo]?.get?.(id) : null;
  if (doc) return doc;
  if (tipo === "ensamble") {
    if (nota) return `Ensamble nuevo · ${nota}`;
    return "Ensamble";
  }
  if (tipo === "prestamo") return nota ? `Préstamo · ${nota}` : "Préstamo";
  if (tipo === "otro") return `Otro · ${nota ?? ""}`.trim();
  if (tipo === "orden") return "OT";
  return "Sin destino";
}

/**
 * Líneas de `data.detalle` de una notificación `conversion_insumo`, listas para
 * pintar. Devuelve [] si la notificación es vieja (sin detalle).
 * Cada línea: { key, quien: "08:15 · Sofía", que: "2 × FILTRO", destino, ruta }.
 */
export function lineasDetalleConversion(data) {
  const det = Array.isArray(data?.detalle) ? data.detalle : [];
  return det.map((d, i) => ({
    key: `${i}-${d?.hora ?? ""}-${d?.producto ?? ""}`,
    quien: [d?.hora, d?.usuario].filter(Boolean).join(" · "),
    que: `${d?.cantidad ?? "?"} × ${d?.producto ?? "producto"}`,
    destino: d?.destino || "Sin destino",
    ruta: rutaDestino(d?.destino_tipo, d?.destino_id),
  }));
}

/**
 * La notificación guarda solo las 40 conversiones más recientes en `detalle`,
 * pero `eventos` cuenta todas las del día. Si hay más eventos que detalle, se
 * dice cuántas se están mostrando de cuántas; si no, "" (no hace falta aviso).
 */
export function avisoDetalleRecortado(data) {
  const n = Array.isArray(data?.detalle) ? data.detalle.length : 0;
  const total = Number(data?.eventos) || 0;
  if (n === 0 || total <= n) return "";
  return `Mostrando las últimas ${n} de ${total}`;
}

/* ── Conversiones hechas antes de que exista el ensamble ───────────────────
 * En "Nuevo ensamble" se convierte a insumo antes de crear el ensamble; los
 * `destino_id` que devuelve el RPC se guardan POR PRODUCTO para amarrarlos al
 * ensamble al crearlo. Así, si se quita un componente, se sueltan solo los
 * suyos, y si se cambia el producto a ensamblar se sueltan todos (la receta
 * era del producto anterior). Las tres funciones devuelven un objeto nuevo.
 */

/** Agrega el destino de una conversión del componente `productoId`. */
export function agregarDestinoConversion(mapa, productoId, destinoId) {
  if (destinoId == null || productoId == null) return { ...(mapa ?? {}) };
  const previos = mapa?.[productoId] ?? [];
  return { ...(mapa ?? {}), [productoId]: [...previos, destinoId] };
}

/** Suelta los destinos del componente que se quitó de la receta. */
export function quitarDestinosProducto(mapa, productoId) {
  const copia = { ...(mapa ?? {}) };
  delete copia[productoId];
  return copia;
}

/** Todos los destino_id pendientes, para fn_vincular_conversiones_ensamble. */
export function idsDestinoConversion(mapa) {
  return Object.values(mapa ?? {}).flat();
}

/**
 * ¿Puede este usuario convertir a insumo el stock de `sedeId`? Espeja
 * fn_convertir_a_insumo: lo usan Admin, Bodeguero, Técnico y Vendedor, pero
 * solo Admin y Técnico (que descarga en ensambles de otras sedes) pueden
 * hacerlo fuera de su sede. Si no puede, la pantalla no ofrece el botón.
 */
export function puedeConvertirAInsumo(perfil, sedeId) {
  const rol = perfil?.rol;
  if (!["Admin", "Bodeguero", "Tecnico", "Vendedor"].includes(rol))
    return false;
  if (rol === "Admin" || rol === "Tecnico") return true;
  return Boolean(sedeId) && sedeId === perfil?.sede_id;
}
