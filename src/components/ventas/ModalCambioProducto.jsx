import { useState, useEffect, useRef, useMemo } from "react";
import { Search, Check, ArrowRightLeft, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError, sanitizeSearch } from "../../lib/utils";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";

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
  // Solo líneas de PRODUCTO (no servicios) pueden devolverse en un cambio.
  const lineasProducto = useMemo(
    () => (items ?? []).filter((i) => i.producto_id != null),
    [items],
  );

  const [lineaId, setLineaId] = useState(
    lineasProducto.length === 1 ? lineasProducto[0].id : "",
  );
  const [cantDev, setCantDev] = useState(1);

  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [nuevo, setNuevo] = useState(null); // { id, nombre, referencia, precio_venta }
  const [cantNuevo, setCantNuevo] = useState(1);

  const [metodo, setMetodo] = useState("Efectivo");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const guardandoRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const lineaDev = lineasProducto.find((l) => l.id === lineaId) || null;

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
    if (mountedRef.current) {
      setResultados(e ? [] : (data ?? []));
      setBuscando(false);
    }
  };
  const buscarDebounced = useDebouncedCallback(buscar, 400);

  // ── Cálculo de la diferencia (espejo exacto del backend) ──────────────────
  const ivaPct = Number(venta?.iva_pct ?? 0);
  const factor = 1 + ivaPct / 100;
  const precioDev = lineaDev
    ? Number(lineaDev.precio_unitario) ||
      Number(lineaDev.subtotal) / Number(lineaDev.cantidad || 1)
    : 0;
  const valorDev = Math.round(precioDev * cantDev);
  const valorNuevo = nuevo
    ? Math.round(Number(nuevo.precio_venta) * cantNuevo)
    : 0;
  const difNeta = valorNuevo - valorDev;
  const difConIva = Math.round(difNeta * factor);
  const accion = difNeta > 0 ? "cobro" : difNeta < 0 ? "devolucion" : "par";

  const maxDev = lineaDev ? Number(lineaDev.cantidad) : 1;
  const puedeGuardar =
    !!lineaDev &&
    cantDev >= 1 &&
    cantDev <= maxDev &&
    !!nuevo &&
    cantNuevo >= 1 &&
    nuevo.id !== lineaDev.producto_id &&
    !guardando;

  const registrar = async () => {
    if (!puedeGuardar || guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    setError("");
    try {
      const { data, error: rpcErr } = await supabase.rpc(
        "fn_registrar_cambio",
        {
          p_venta_original_id: venta.id,
          p_producto_devuelto_id: lineaDev.producto_id,
          p_cant_dev: cantDev,
          p_producto_nuevo_id: nuevo.id,
          p_cant_nuevo: cantNuevo,
          p_sede_id: sedeId,
          p_metodo: metodo,
          p_cuenta_bancaria: null,
          p_motivo: `Cambio desde venta #${venta.numero}`,
        },
      );
      if (rpcErr) throw new Error(rpcErr.message);
      onDone?.(data);
    } catch (e) {
      setError(safeError(e, "No se pudo registrar el cambio"));
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
            className="rounded-md p-1"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* 1 · Producto que DEVUELVE */}
          <Section titulo="1 · Producto que devuelve el cliente">
            {lineasProducto.length === 0 ? (
              <p
                className="text-sm"
                style={{ color: "hsl(var(--destructive))" }}
              >
                Esta venta no tiene productos (solo servicios): no admite
                cambio.
              </p>
            ) : (
              <div className="space-y-2">
                {lineasProducto.map((l) => {
                  const on = l.id === lineaId;
                  return (
                    <button
                      key={l.id}
                      onClick={() => {
                        setLineaId(l.id);
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
                          {l.producto?.nombre ?? l.descripcion ?? "—"}
                        </p>
                        <p
                          className="font-mono text-[11px]"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {l.producto?.referencia ?? ""} · ×{l.cantidad} ·{" "}
                          {formatCOP(l.precio_unitario)}
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
                {lineaDev && (
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
                        className="truncate text-sm font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {p.nombre}
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
            {nuevo && lineaDev && nuevo.id === lineaDev.producto_id && (
              <p
                className="mt-1 text-xs"
                style={{ color: "hsl(var(--destructive))" }}
              >
                El producto nuevo debe ser distinto al devuelto.
              </p>
            )}
          </Section>

          {/* 3 · Diferencia */}
          {lineaDev && nuevo && nuevo.id !== lineaDev.producto_id && (
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
                        className="flex-1 rounded-lg border py-2.5 text-sm font-medium"
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

          {error && (
            <div
              className="rounded-lg border px-3 py-2.5"
              style={{
                backgroundColor: "hsl(var(--destructive) / 0.08)",
                borderColor: "hsl(var(--destructive) / 0.3)",
              }}
            >
              <p
                className="text-sm"
                style={{ color: "hsl(var(--destructive))" }}
              >
                {error}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 border-t px-5 py-4"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <button
            onClick={onClose}
            className="rounded-lg border px-4 py-2.5 text-sm font-medium"
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
            className="rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
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
        className="grid h-9 w-9 place-items-center rounded-lg border text-lg font-bold"
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
        className="w-14 rounded-lg border py-2 text-center font-mono text-sm font-bold outline-none"
        style={{
          borderColor: "hsl(var(--border))",
          color: "hsl(var(--foreground))",
          backgroundColor: "hsl(var(--card))",
        }}
      />
      <button
        onClick={() => set(value + 1)}
        className="grid h-9 w-9 place-items-center rounded-lg border text-lg font-bold"
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
