import { useState, useEffect, useRef, useMemo } from "react";
import { Search, Check, ArrowRightLeft, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, sanitizeSearch } from "../../lib/utils";
import { avisarOk, avisarError } from "../../lib/notify";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import UbicacionChip from "../ui/UbicacionChip";

/**
 * Modal de CAMBIO de producto (Reporte clienta).
 *
 * El cliente devuelve un producto de ESTA venta y se lleva otro de distinto
 * precio; el sistema reingresa el devuelto, entrega el nuevo y gestiona la
 * DIFERENCIA (cobra si el nuevo es más caro, devuelve si es más barato).
 *
 * Reutiliza por completo el backend `fn_registrar_cambio`, que a su vez compone
 * fn_registrar_devolucion + fn_registrar_venta (trade-in) + fn_registrar_caja_menor.
 * No crea documentos nuevos a mano ni toca el cierre.
 *
 * Props:
 *   - venta:  fila de la venta original (numero, iva_pct, cliente_nombre…)
 *   - items:  detalle_venta de la venta (con producto:{nombre,referencia})
 *   - sedeId: sede donde se realiza el cambio (sede del usuario)
 *   - onClose: () => void
 *   - onDone:  (resultado) => void   // resultado del RPC
 */
export default function ModalCambioProducto({
  venta,
  items,
  sedeId,
  onClose,
  onDone,
}) {
  // Solo PRODUCTOS (no servicios) pueden devolverse en un cambio. Se agrupan por
  // producto (sumando líneas) para reflejar EXACTAMENTE lo que hace el backend:
  // crédito = subtotal_total / cantidad_total (promedio ponderado) y tope = total
  // vendido del producto. Así el preview coincide con fn_registrar_cambio.
  const productosDevolubles = useMemo(() => {
    const map = new Map();
    for (const it of items ?? []) {
      if (it.producto_id == null) continue;
      const g = map.get(it.producto_id) ?? {
        producto_id: it.producto_id,
        nombre: it.producto?.nombre ?? it.descripcion ?? "—",
        referencia: it.producto?.referencia ?? "",
        cantidad: 0,
        subtotal: 0,
      };
      g.cantidad += Number(it.cantidad) || 0;
      g.subtotal +=
        Number(it.subtotal) ||
        Number(it.precio_unitario) * Number(it.cantidad) ||
        0;
      map.set(it.producto_id, g);
    }
    return [...map.values()].map((g) => ({
      ...g,
      precio: g.cantidad ? g.subtotal / g.cantidad : 0,
    }));
  }, [items]);

  // Unidades YA devueltas de esta venta (por producto). El backend
  // (fn_registrar_devolucion) topa la devolución en vendido − ya_devuelto; aquí
  // se refleja para no permitir pedir de más en la UI.
  const [devPrev, setDevPrev] = useState(null); // Map producto_id -> qty (null=cargando)
  const disponibles = useMemo(
    () =>
      productosDevolubles
        .map((g) => ({
          ...g,
          restante: Math.max(
            0,
            g.cantidad - (devPrev?.get(g.producto_id) ?? 0),
          ),
        }))
        .filter((g) => g.restante > 0),
    [productosDevolubles, devPrev],
  );

  const [prodDevId, setProdDevId] = useState(
    productosDevolubles.length === 1 ? productosDevolubles[0].producto_id : "",
  );
  const [cantDev, setCantDev] = useState(1);

  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [nuevo, setNuevo] = useState(null); // { id, nombre, referencia, precio_venta }
  const [cantNuevo, setCantNuevo] = useState(1);

  const [metodo, setMetodo] = useState("Efectivo");
  // #S1-15: cuenta bancaria destino cuando la diferencia se cobra por transferencia
  // (igual que en Nueva Venta; antes se enviaba siempre null y el ingreso quedaba
  // sin cuenta identificable para el arqueo).
  const [cuenta, setCuenta] = useState("");
  const [cuentasBanco, setCuentasBanco] = useState([]);
  // Por qué se hace el cambio. Hasta ahora el motivo iba escrito a fuego y
  // siempre decía lo mismo, así que en el historial no había forma de saber
  // qué había pasado en cada cambio.
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const guardandoRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    supabase
      .from("cuentas_bancarias")
      .select("id, banco, tipo, numero, titular")
      .eq("activo", true)
      .order("banco")
      .then(({ data }) => setCuentasBanco(data ?? []));
  }, []);

  // Carga lo ya devuelto de esta venta para topar correctamente la cantidad.
  useEffect(() => {
    if (!venta?.id) return;
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("devoluciones")
        .select("producto_id, cantidad")
        .eq("venta_id", venta.id);
      if (!alive) return;
      const m = new Map();
      for (const d of data ?? [])
        m.set(
          d.producto_id,
          (m.get(d.producto_id) ?? 0) + (Number(d.cantidad) || 0),
        );
      setDevPrev(m);
    })();
    return () => {
      alive = false;
    };
  }, [venta?.id]);

  const devSel = disponibles.find((p) => p.producto_id === prodDevId) || null;

  // Buscar producto nuevo (reusa el patrón de búsqueda saneada del resto de la app).
  const buscar = async (q) => {
    if ((q ?? "").trim().length < 2) {
      setResultados([]);
      return;
    }
    const term = sanitizeSearch(q);
    if (term.length < 2) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    const { data, error: e } = await supabase
      .from("productos")
      .select("id, nombre, referencia, unidad_medida, precio_venta")
      .eq("activo", true)
      .or(`nombre.ilike.%${term}%,referencia.ilike.%${term}%`)
      .limit(1000);
    let ubicMap = {};
    if (!e && data?.length && sedeId) {
      const { data: inv } = await supabase
        .from("inventario")
        .select("producto_id, ubicacion_id")
        .eq("sede_id", sedeId)
        .in(
          "producto_id",
          data.map((p) => p.id),
        );
      ubicMap = Object.fromEntries(
        (inv ?? []).map((i) => [i.producto_id, i.ubicacion_id]),
      );
    }
    if (mountedRef.current) {
      setResultados(
        e
          ? []
          : (data ?? []).map((p) => ({
              ...p,
              ubicacion_id: ubicMap[p.id] ?? null,
            })),
      );
      setBuscando(false);
    }
  };
  const buscarDebounced = useDebouncedCallback(buscar, 400);

  // ── Cálculo de la diferencia (espejo exacto del backend) ──────────────────
  const ivaPct = Number(venta?.iva_pct ?? 0);
  const factor = 1 + ivaPct / 100;
  // Proporción realmente pagada en la venta original (espejo del backend): si tuvo
  // descuento global, el crédito por lo devuelto se reduce en esa misma proporción.
  const ratioPagado = useMemo(() => {
    const sub = Number(venta?.subtotal) || 0;
    if (sub <= 0) return 1;
    const descRaw =
      venta?.descuento_valor != null
        ? Number(venta.descuento_valor)
        : (sub * (Number(venta?.descuento_pct) || 0)) / 100;
    const desc = Math.max(0, Math.min(descRaw, sub));
    return (sub - desc) / sub;
  }, [venta]);
  const precioDev = devSel ? devSel.precio : 0;
  const valorDev = Math.round(precioDev * cantDev * ratioPagado);
  const valorNuevo = nuevo
    ? Math.round(Number(nuevo.precio_venta) * cantNuevo)
    : 0;
  const difNeta = valorNuevo - valorDev;
  const difConIva = Math.round(difNeta * factor);
  const accion = difNeta > 0 ? "cobro" : difNeta < 0 ? "devolucion" : "par";

  const maxDev = devSel ? Number(devSel.restante) : 1;
  const puedeGuardar =
    !!devSel &&
    cantDev >= 1 &&
    cantDev <= maxDev &&
    !!nuevo &&
    cantNuevo >= 1 &&
    nuevo.id !== devSel.producto_id &&
    // #S1-15: si se cobra por transferencia, la cuenta destino es obligatoria.
    (accion !== "cobro" || metodo !== "Transferencia" || !!cuenta) &&
    !guardando;

  const registrar = async () => {
    if (!puedeGuardar || guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc(
        "fn_registrar_cambio",
        {
          p_venta_original_id: venta.id,
          p_producto_devuelto_id: devSel.producto_id,
          p_cant_dev: cantDev,
          p_producto_nuevo_id: nuevo.id,
          p_cant_nuevo: cantNuevo,
          p_sede_id: sedeId,
          // El método/cuenta solo aplican cuando se COBRA la diferencia. En una
          // devolución a favor del cliente o un cambio par, el egreso va en
          // efectivo (como indica la UI), evitando un método obsoleto y el nuevo
          // requisito de cuenta para transferencias en la venta interna.
          p_metodo: accion === "cobro" ? metodo : "Efectivo",
          p_cuenta_bancaria:
            accion === "cobro" && metodo === "Transferencia"
              ? cuenta || null
              : null,
          // Se concatena en vez de sustituir: el vínculo con la venta original
          // es lo que permite rastrear el cambio, y no se puede perder porque
          // alguien escriba un motivo.
          p_motivo: motivo.trim()
            ? `Cambio desde venta #${venta.numero} — ${motivo.trim()}`
            : `Cambio desde venta #${venta.numero}`,
        },
      );
      if (rpcErr) throw new Error(rpcErr.message);
      avisarOk("Cambio de producto registrado correctamente");
      onDone?.(data);
    } catch (e) {
      avisarError(e, "No se pudo registrar el cambio");
    } finally {
      if (mountedRef.current) setGuardando(false);
      guardandoRef.current = false;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <div className="flex items-center gap-2.5">
            <ArrowRightLeft
              className="h-4 w-4"
              style={{ color: "hsl(var(--primary))" }}
            />
            <div>
              <p
                className="text-sm font-semibold"
                style={{ color: "hsl(var(--foreground))" }}
              >
                Registrar cambio de producto
              </p>
              <p
                className="text-xs"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Sobre la venta #{venta?.numero}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="grid h-11 w-11 place-items-center rounded-md"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* 1 · Producto que DEVUELVE */}
          <Section titulo="1 · Producto que devuelve el cliente">
            {productosDevolubles.length === 0 ? (
              <p
                className="text-sm"
                style={{ color: "hsl(var(--destructive))" }}
              >
                Esta venta no tiene productos (solo servicios): no admite
                cambio.
              </p>
            ) : disponibles.length === 0 ? (
              <p
                className="text-sm"
                style={{ color: "hsl(var(--destructive))" }}
              >
                Todos los productos de esta venta ya fueron devueltos: no queda
                nada por cambiar.
              </p>
            ) : (
              <div className="space-y-2">
                {disponibles.map((g) => {
                  const on = g.producto_id === prodDevId;
                  return (
                    <button
                      key={g.producto_id}
                      onClick={() => {
                        setProdDevId(g.producto_id);
                        setCantDev(1);
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left"
                      style={{
                        borderColor: on
                          ? "hsl(var(--primary))"
                          : "hsl(var(--border))",
                        backgroundColor: on
                          ? "hsl(var(--primary) / 0.06)"
                          : "hsl(var(--card))",
                      }}
                    >
                      <div className="min-w-0">
                        <p
                          className="truncate text-sm font-medium"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {g.nombre}
                        </p>
                        <p
                          className="font-mono text-[11px]"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {g.referencia} · quedan {g.restante} ·{" "}
                          {formatCOP(Math.round(g.precio * ratioPagado))}
                        </p>
                      </div>
                      {on && (
                        <Check
                          className="h-4 w-4 shrink-0"
                          style={{ color: "hsl(var(--primary))" }}
                        />
                      )}
                    </button>
                  );
                })}
                {devSel && (
                  <div className="flex items-center gap-2 pt-1">
                    <span
                      className="text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      Cantidad a devolver
                    </span>
                    <Stepper
                      value={cantDev}
                      min={1}
                      max={maxDev}
                      onChange={setCantDev}
                    />
                    <span
                      className="text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      de {maxDev}
                    </span>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* 2 · Producto que SE LLEVA */}
          <Section titulo="2 · Producto que se lleva">
            <div
              className="flex h-11 items-center gap-2 rounded-lg border px-3"
              style={{ borderColor: "hsl(var(--border))" }}
            >
              <Search
                className="h-4 w-4 shrink-0"
                style={{ color: "hsl(var(--muted-foreground))" }}
              />
              <input
                value={busqueda}
                onChange={(e) => {
                  setBusqueda(e.target.value);
                  setNuevo(null);
                  buscarDebounced(e.target.value);
                }}
                placeholder="Buscar producto nuevo por nombre o referencia…"
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: "hsl(var(--foreground))" }}
              />
            </div>
            {buscando && (
              <p
                className="mt-1 text-xs"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Buscando…
              </p>
            )}
            {resultados.length > 0 && !nuevo && (
              <div
                className="mt-1 max-h-56 overflow-y-auto rounded-lg border"
                style={{ borderColor: "hsl(var(--border))" }}
              >
                {resultados.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setNuevo(p);
                      setBusqueda(p.nombre);
                      setResultados([]);
                    }}
                    className="flex w-full items-center justify-between gap-3 border-b px-3 py-2.5 text-left last:border-b-0"
                    style={{ borderColor: "hsl(var(--border))" }}
                  >
                    <div className="min-w-0">
                      <p
                        className="flex items-center gap-1.5 truncate text-sm font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {p.nombre}
                        <UbicacionChip codigo={p.ubicacion_id} />
                      </p>
                      <p
                        className="font-mono text-[11px]"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {p.referencia} · {formatCOP(p.precio_venta)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {/* #S1-24: sin resultados — mensaje explícito en vez de nada. */}
            {!buscando &&
              busqueda.trim().length >= 2 &&
              resultados.length === 0 &&
              !nuevo && (
                <p
                  className="mt-1 text-xs"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  No se encontraron productos para “{busqueda.trim()}”. Prueba
                  con otra palabra o la referencia.
                </p>
              )}
            {nuevo && (
              <div className="mt-2 flex items-center gap-2">
                <div
                  className="flex flex-1 items-center justify-between rounded-lg border px-3 py-2.5"
                  style={{
                    borderColor: "hsl(var(--success) / 0.4)",
                    backgroundColor: "hsl(var(--success) / 0.08)",
                  }}
                >
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-semibold"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {nuevo.nombre}
                    </p>
                    <p
                      className="font-mono text-[11px]"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {nuevo.referencia} · {formatCOP(nuevo.precio_venta)}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setNuevo(null);
                      setBusqueda("");
                    }}
                    className="text-xs font-medium"
                    style={{ color: "hsl(var(--primary))" }}
                  >
                    Cambiar
                  </button>
                </div>
                <Stepper
                  value={cantNuevo}
                  min={1}
                  max={9999}
                  onChange={setCantNuevo}
                />
              </div>
            )}
            {nuevo && devSel && nuevo.id === devSel.producto_id && (
              <p
                className="mt-1 text-xs"
                style={{ color: "hsl(var(--destructive))" }}
              >
                El producto nuevo debe ser distinto al devuelto.
              </p>
            )}
          </Section>

          {/* 3 · Diferencia */}
          {devSel && nuevo && nuevo.id !== devSel.producto_id && (
            <Section titulo="3 · Diferencia y pago">
              <div className="space-y-1.5 text-sm">
                <Row
                  label={`Crédito por lo devuelto (×${cantDev})`}
                  value={`−${formatCOP(valorDev)}`}
                />
                <Row
                  label={`Valor del nuevo (×${cantNuevo})`}
                  value={formatCOP(valorNuevo)}
                />
                {ivaPct > 0 && (
                  <Row
                    label={`IVA ${ivaPct}% sobre la diferencia`}
                    value={formatCOP(difConIva - difNeta)}
                  />
                )}
                <div
                  className="mt-1 flex items-center justify-between rounded-lg px-3 py-2.5"
                  style={{
                    backgroundColor:
                      accion === "cobro"
                        ? "hsl(var(--primary) / 0.08)"
                        : accion === "devolucion"
                          ? "hsl(var(--warning) / 0.12)"
                          : "hsl(var(--muted) / 0.4)",
                  }}
                >
                  <span
                    className="text-sm font-semibold"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {accion === "cobro"
                      ? "Cobrar al cliente"
                      : accion === "devolucion"
                        ? "Devolver al cliente (efectivo)"
                        : "Cambio par — sin diferencia"}
                  </span>
                  <span
                    className="text-base font-bold tabular-nums"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {formatCOP(Math.abs(difConIva))}
                  </span>
                </div>
              </div>

              {accion === "cobro" && (
                <div className="mt-3 flex gap-2">
                  {["Efectivo", "Transferencia"].map((m) => {
                    const on = metodo === m;
                    return (
                      <button
                        key={m}
                        onClick={() => setMetodo(m)}
                        className="min-h-[48px] flex-1 rounded-lg border py-2.5 text-sm font-medium"
                        style={{
                          borderColor: on
                            ? "hsl(var(--primary))"
                            : "hsl(var(--border))",
                          backgroundColor: on
                            ? "hsl(var(--primary) / 0.08)"
                            : "hsl(var(--card))",
                          color: "hsl(var(--foreground))",
                        }}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              )}
              {/* #S1-15: cuenta destino obligatoria si el cobro es por transferencia. */}
              {accion === "cobro" && metodo === "Transferencia" && (
                <div className="mt-2">
                  <select
                    value={cuenta}
                    onChange={(e) => setCuenta(e.target.value)}
                    className="h-12 w-full rounded-lg border px-3 text-sm outline-none"
                    style={{
                      borderColor: "hsl(var(--border))",
                      color: "hsl(var(--foreground))",
                      backgroundColor: "hsl(var(--card))",
                    }}
                  >
                    <option value="">¿A qué cuenta entró el pago?…</option>
                    {cuentasBanco.map((c) => {
                      // Mismo formato exacto que Nueva Venta para no fragmentar
                      // el arqueo por cuenta en el cierre.
                      const ref = `${c.banco} ${c.tipo} ${c.numero}${
                        c.titular ? " · " + c.titular : ""
                      }`;
                      return (
                        <option key={c.id} value={ref}>
                          {ref}
                        </option>
                      );
                    })}
                  </select>
                  {!cuenta && (
                    <p
                      className="mt-1 text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      Elige la cuenta bancaria para poder cuadrarla después.
                    </p>
                  )}
                </div>
              )}
              {accion === "devolucion" && (
                <p
                  className="mt-2 text-xs"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  La diferencia a favor se devuelve en efectivo y queda como
                  egreso de caja del día, vinculado a la venta #{venta.numero}.
                </p>
              )}
            </Section>
          )}

          <Section titulo="Motivo del cambio">
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="Por qué se hace el cambio — opcional, pero ayuda a entender el historial después"
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--foreground))",
              }}
            />
          </Section>
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 border-t px-5 py-4"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <button
            onClick={onClose}
            className="min-h-[48px] rounded-lg border px-4 py-2.5 text-sm font-medium"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={registrar}
            disabled={!puedeGuardar}
            className="min-h-[48px] rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            {guardando ? "Registrando…" : "Confirmar cambio"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Subcomponentes ─────────────────────────── */

function Section({ titulo, children }) {
  return (
    <div>
      <p
        className="mb-2 text-xs font-semibold uppercase tracking-wide"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {titulo}
      </p>
      {children}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: "hsl(var(--muted-foreground))" }}>{label}</span>
      <span
        className="font-medium tabular-nums"
        style={{ color: "hsl(var(--foreground))" }}
      >
        {value}
      </span>
    </div>
  );
}

function Stepper({ value, min, max, onChange }) {
  const set = (n) => onChange(Math.max(min, Math.min(max, n)));
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => set(value - 1)}
        aria-label="Disminuir"
        className="grid h-12 w-12 place-items-center rounded-lg border text-lg font-bold"
        style={{
          borderColor: "hsl(var(--border))",
          color: "hsl(var(--foreground))",
        }}
      >
        −
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => set(parseInt(e.target.value, 10) || min)}
        className="h-12 w-14 rounded-lg border text-center font-mono text-sm font-bold outline-none"
        style={{
          borderColor: "hsl(var(--border))",
          color: "hsl(var(--foreground))",
          backgroundColor: "hsl(var(--card))",
        }}
      />
      <button
        onClick={() => set(value + 1)}
        aria-label="Aumentar"
        className="grid h-12 w-12 place-items-center rounded-lg border text-lg font-bold"
        style={{
          borderColor: "hsl(var(--border))",
          color: "hsl(var(--foreground))",
        }}
      >
        +
      </button>
    </div>
  );
}
