import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftCircle,
  ArrowRight,
  Search,
  Check,
  CheckCircle2,
  Inbox,
  Info,
  Package,
  ClipboardList,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { sanitizeSearch, safeError } from "../../lib/utils";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import UbicacionChip from "../../components/ui/UbicacionChip";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function DevolucionNueva() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [tipo, setTipo] = useState("cliente");

  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [productoSeleccionado, setProductoSeleccionado] = useState(null);

  const [cantidad, setCantidad] = useState(1);
  const [motivo, setMotivo] = useState("");
  const [ventaId, setVentaId] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(null);
  const guardandoRef = useRef(false);

  const buscarProductos = useCallback(
    async (q) => {
      if (!q || q.trim().length < 2) {
        setResultados([]);
        return;
      }
      setBuscando(true);
      try {
        const safe = sanitizeSearch(q.trim());
        const { data, error: e } = await supabase
          .from("productos")
          .select("id, nombre, referencia, unidad_medida")
          .eq("activo", true)
          .or(`nombre.ilike.%${safe}%,referencia.ilike.%${safe}%`)
          .limit(1000);
        if (e) throw e;
        // Ubicación física en la sede del usuario (solo referencia visual).
        let ubicMap = {};
        if (data?.length && perfil?.sede_id) {
          const { data: inv } = await supabase
            .from("inventario")
            .select("producto_id, ubicacion_id")
            .eq("sede_id", perfil.sede_id)
            .in(
              "producto_id",
              data.map((p) => p.id),
            );
          ubicMap = Object.fromEntries(
            (inv ?? []).map((i) => [i.producto_id, i.ubicacion_id]),
          );
        }
        setResultados(
          (data ?? []).map((p) => ({
            ...p,
            ubicacion_id: ubicMap[p.id] ?? null,
          })),
        );
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    },
    [perfil?.sede_id],
  );

  const buscarDebounced = useDebouncedCallback(buscarProductos, 400);

  const handleBusquedaChange = (e) => {
    const val = e.target.value;
    setBusqueda(val);
    setProductoSeleccionado(null);
    buscarDebounced(val);
  };

  const seleccionarProducto = (prod) => {
    setProductoSeleccionado(prod);
    setBusqueda(prod.nombre);
    setResultados([]);
  };

  const registrar = async () => {
    if (!productoSeleccionado) {
      setError("Selecciona un producto.");
      return;
    }
    if (cantidad < 1) {
      setError("La cantidad debe ser al menos 1.");
      return;
    }
    const ventaTrim = ventaId.trim();
    if (tipo === "cliente") {
      if (!ventaTrim) {
        setError(
          "La devolución de cliente requiere el ID de la venta original.",
        );
        return;
      }
      if (!UUID_RE.test(ventaTrim)) {
        setError("El ID de venta no tiene un formato válido (UUID).");
        return;
      }
    }
    // Guard síncrono contra doble-submit (el `disabled` no es inmediato).
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setError(null);
    setExito(null);
    setGuardando(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc(
        "fn_registrar_devolucion",
        {
          p_tipo: tipo,
          p_producto_id: productoSeleccionado.id,
          p_sede_id: perfil?.sede_id,
          p_cantidad: cantidad,
          p_motivo: motivo.trim() || "Sin motivo especificado",
          p_venta_id: ventaTrim || null,
        },
      );
      if (rpcErr) throw new Error(rpcErr.message);
      if (!data?.numero) throw new Error("Respuesta inesperada del servidor.");
      const delta = tipo === "cliente" ? `+${cantidad}` : `-${cantidad}`;
      setExito(
        `Devolución #${data.numero} registrada. Stock ajustado: ${delta} unidades.`,
      );
      // Reset form
      setProductoSeleccionado(null);
      setBusqueda("");
      setCantidad(1);
      setMotivo("");
      setVentaId("");
    } catch (e) {
      setError(safeError(e, "Error al registrar la devolución"));
    } finally {
      setGuardando(false);
      guardandoRef.current = false;
    }
  };

  const tipoInfo =
    tipo === "cliente"
      ? {
          eyebrow: "Devolución de cliente",
          desc: "Reingresa stock al inventario tras validar el estado físico.",
          signo: "+",
          tone: "var(--succ-700)",
        }
      : {
          eyebrow: "Devolución a proveedor",
          desc: "Devuelve mercancía al proveedor por defecto, vencimiento o error de pedido.",
          signo: "−",
          tone: "var(--warn-700)",
        };

  // Pasos del wizard. El backend pide producto + (UUID de venta para cliente);
  // se reflejan en el stepper aunque la lógica real no use buscador de venta.
  const pasoProducto = !!productoSeleccionado;
  const pasoDetalle =
    pasoProducto &&
    cantidad >= 1 &&
    (tipo === "proveedor" || UUID_RE.test(ventaId.trim()));

  const puedeRegistrar = pasoProducto && cantidad >= 1 && !guardando;

  return (
    <div className="flex h-full flex-col animate-fade-in">
      {/* ── Breadcrumb ──────────────────────────────────────────────── */}
      <div
        className="border-b px-4 pt-5 sm:px-7"
        style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
      >
        <button
          onClick={() => navigate("/ops/devoluciones")}
          className="back-btn inline-flex items-center gap-1.5"
        >
          <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
          Volver a Devoluciones
        </button>
      </div>

      {/* ── Encabezado + toggle tipo ────────────────────────────────── */}
      <div
        className="flex flex-wrap items-end justify-between gap-4 border-b px-4 pb-5 pt-3 sm:px-7"
        style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
      >
        <div className="min-w-0">
          <p
            className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em]"
            style={{ color: "var(--n-500)" }}
          >
            Operaciones · Post-venta · {perfil?.sede_id ?? "—"}
          </p>
          <h1
            className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--n-950)" }}
          >
            Nueva devolución ·{" "}
            {tipo === "cliente" ? "De cliente" : "A proveedor"}
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: "var(--n-500)" }}>
            {tipoInfo.desc}
          </p>
        </div>
        <div
          className="flex h-9 overflow-hidden rounded-md border text-[12px] font-medium"
          style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
        >
          {[
            { value: "cliente", label: "Cliente" },
            { value: "proveedor", label: "Proveedor" },
          ].map((t) => {
            const on = tipo === t.value;
            return (
              <button
                key={t.value}
                onClick={() => setTipo(t.value)}
                className="px-4 transition-colors"
                style={{
                  backgroundColor: on ? "var(--n-950)" : "transparent",
                  color: on ? "var(--n-0)" : "var(--n-500)",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Cuerpo ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-4 pb-14 pt-5 sm:px-7">
        {/* Stepper */}
        <div className="stepper mb-5 overflow-x-auto">
          <Step
            n={1}
            label="Producto"
            state={pasoProducto ? "done" : "active"}
          />
          <Line done={pasoProducto} />
          <Step
            n={2}
            label={tipo === "cliente" ? "Detalle y venta origen" : "Detalle"}
            state={pasoDetalle ? "done" : pasoProducto ? "active" : "todo"}
          />
          <Line done={pasoDetalle} />
          <Step
            n={3}
            label="Confirmar"
            state={pasoDetalle ? "active" : "todo"}
          />
        </div>

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_340px]">
          {/* ── Columna principal ─────────────────────────────────── */}
          <div className="flex flex-col gap-3.5">
            {/* Producto */}
            <div className="iblock flex flex-col gap-3.5">
              <div className="ib-head">
                <div className="ib-ico">
                  <Package className="h-3.5 w-3.5" strokeWidth={2} />
                </div>
                <div className="ib-title">Producto a devolver</div>
              </div>

              <div
                className="flex h-12 items-center gap-2.5 rounded-lg border px-3.5"
                style={{
                  borderColor: "var(--n-200)",
                  backgroundColor: "var(--n-0)",
                }}
              >
                <Search
                  className="h-4 w-4 shrink-0"
                  strokeWidth={1.5}
                  style={{ color: "var(--n-500)" }}
                />
                <input
                  type="text"
                  value={busqueda}
                  onChange={handleBusquedaChange}
                  placeholder="Buscar por nombre o referencia del catálogo…"
                  className="flex-1 border-none bg-transparent text-[14px] outline-none"
                  style={{ color: "var(--n-950)" }}
                />
              </div>

              {buscando && (
                <p className="text-xs" style={{ color: "var(--n-500)" }}>
                  Buscando…
                </p>
              )}

              {resultados.length > 0 && (
                <div
                  className="max-h-80 overflow-y-auto rounded-lg border"
                  style={{ borderColor: "var(--n-150)" }}
                >
                  {resultados.map((r, idx) => (
                    <button
                      key={r.id}
                      onClick={() => seleccionarProducto(r)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors"
                      style={{
                        borderTop:
                          idx === 0 ? "none" : "1px solid var(--n-100)",
                        backgroundColor: "var(--n-0)",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = "var(--n-50)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = "var(--n-0)")
                      }
                    >
                      <div>
                        <p
                          className="flex items-center gap-1.5 text-sm font-medium"
                          style={{ color: "var(--n-950)" }}
                        >
                          {r.nombre}
                          <UbicacionChip codigo={r.ubicacion_id} />
                        </p>
                        <p
                          className="font-mono text-[11px]"
                          style={{ color: "var(--n-500)" }}
                        >
                          {r.referencia} · {r.unidad_medida}
                        </p>
                      </div>
                      <Check
                        className="h-4 w-4 shrink-0"
                        style={{ color: "var(--n-400)" }}
                      />
                    </button>
                  ))}
                </div>
              )}

              {productoSeleccionado && (
                <div
                  className="flex items-center gap-3 rounded-xl border px-4 py-3"
                  style={{
                    backgroundColor: "var(--succ-50)",
                    borderColor: "var(--succ-border)",
                  }}
                >
                  <CheckCircle2
                    className="h-5 w-5 shrink-0"
                    style={{ color: "var(--succ-600)" }}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm font-semibold"
                      style={{ color: "var(--n-950)" }}
                    >
                      {productoSeleccionado.nombre}
                    </p>
                    <p
                      className="font-mono text-xs"
                      style={{ color: "var(--n-500)" }}
                    >
                      {productoSeleccionado.referencia}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setProductoSeleccionado(null);
                      setBusqueda("");
                    }}
                    className="text-xs font-medium"
                    style={{ color: "var(--p-600)" }}
                  >
                    Cambiar
                  </button>
                </div>
              )}
            </div>

            {/* Detalle y motivo */}
            <div className="iblock flex flex-col gap-3.5">
              <div className="ib-head">
                <div className="ib-ico">
                  <ClipboardList className="h-3.5 w-3.5" strokeWidth={2} />
                </div>
                <div className="ib-title">Detalle de la devolución</div>
              </div>

              <div className="flex flex-col gap-4">
                <Field label="Cantidad" req>
                  <div className="flex items-center gap-2">
                    <QtyBtn
                      onClick={() => setCantidad((n) => Math.max(1, n - 1))}
                    >
                      −
                    </QtyBtn>
                    <input
                      type="number"
                      min="1"
                      value={cantidad}
                      onChange={(e) =>
                        setCantidad(
                          Math.max(1, parseInt(e.target.value, 10) || 1),
                        )
                      }
                      className="w-20 rounded-xl border py-2.5 text-center font-mono text-lg font-bold outline-none"
                      style={{
                        borderColor: "var(--n-150)",
                        color: "var(--n-950)",
                        backgroundColor: "var(--n-0)",
                      }}
                    />
                    <QtyBtn onClick={() => setCantidad((n) => n + 1)}>+</QtyBtn>
                  </div>
                </Field>

                <Field label="Motivo (opcional)">
                  <textarea
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Describe el motivo de la devolución…"
                    rows={3}
                    className="ftextarea"
                  />
                </Field>

                {tipo === "cliente" && (
                  <Field label="ID de venta relacionada" req>
                    <input
                      type="text"
                      value={ventaId}
                      onChange={(e) => setVentaId(e.target.value)}
                      placeholder="UUID de la venta original"
                      className="finput sans"
                    />
                    {/* Nuestro flujo vincula por UUID de venta (no por buscador
                        de venta-origen como el diseño Lovable). Lógica real
                        intacta: fn_registrar_devolucion exige este p_venta_id. */}
                    <div
                      className="mt-1.5 flex items-center gap-2 rounded-md px-3 py-2 text-[11.5px]"
                      style={{
                        backgroundColor: "var(--info-50)",
                        color: "var(--info-700)",
                      }}
                    >
                      <Info className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        La devolución de cliente debe vincularse a la venta
                        original mediante su identificador (UUID).
                      </span>
                    </div>
                  </Field>
                )}
              </div>
            </div>

            {exito && (
              <div
                className="rounded-[10px] border px-4 py-3"
                style={{
                  backgroundColor: "var(--succ-50)",
                  borderColor: "var(--succ-border)",
                }}
              >
                <p
                  className="text-sm font-medium"
                  style={{ color: "var(--succ-700)" }}
                >
                  {exito}
                </p>
              </div>
            )}

            {error && (
              <div
                className="rounded-[10px] border px-4 py-3"
                style={{
                  backgroundColor: "var(--dang-50)",
                  borderColor: "var(--dang-border)",
                }}
              >
                <p className="text-sm" style={{ color: "var(--dang-700)" }}>
                  {error}
                </p>
              </div>
            )}
          </div>

          {/* ── Resumen (sticky) ──────────────────────────────────── */}
          <aside className="cart">
            <span className="cart-eyebrow">Resumen de la devolución</span>
            {productoSeleccionado ? (
              <>
                <div className="cart-line">
                  <span>{tipoInfo.eyebrow}</span>
                </div>
                <p
                  className="text-[12.5px] font-medium leading-tight"
                  style={{ color: "var(--n-950)" }}
                >
                  {productoSeleccionado.nombre}
                </p>
                <p
                  className="font-mono text-[11px]"
                  style={{ color: "var(--n-500)" }}
                >
                  {productoSeleccionado.referencia}
                </p>
                <div className="cart-line tot">
                  <span>Ajuste de stock</span>
                  <span className="v" style={{ color: tipoInfo.tone }}>
                    {tipoInfo.signo}
                    {cantidad} ud.
                  </span>
                </div>
                <button
                  onClick={registrar}
                  disabled={!puedeRegistrar}
                  className="btn btn-pri mt-2 w-full justify-center disabled:opacity-40"
                  style={{ height: 48 }}
                >
                  {guardando ? (
                    "Registrando…"
                  ) : (
                    <>
                      Registrar devolución
                      <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                    </>
                  )}
                </button>
              </>
            ) : (
              <div
                className="flex flex-col items-center justify-center gap-3 px-3 py-10 text-center"
                style={{ color: "var(--n-500)" }}
              >
                <Inbox className="h-7 w-7" strokeWidth={1.5} />
                <div className="max-w-[220px] text-[12.5px] leading-[1.5]">
                  Selecciona un producto para continuar
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function Step({ n, label, state }) {
  return (
    <div className={`step ${state}`}>
      <div className="step-dot">
        {state === "done" ? <Check className="h-3 w-3" strokeWidth={3} /> : n}
      </div>
      <div className="step-lbl">{label}</div>
    </div>
  );
}

function Line({ done }) {
  return <div className={`step-line ${done ? "done" : ""}`} />;
}

function Field({ label, req, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flbl">
        {label}
        {req && <span className="req">*</span>}
      </label>
      {children}
    </div>
  );
}

function QtyBtn({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="grid h-12 w-12 place-items-center rounded-xl border text-xl font-bold transition-colors"
      style={{
        borderColor: "var(--n-150)",
        color: "var(--n-700)",
        backgroundColor: "var(--n-0)",
      }}
    >
      {children}
    </button>
  );
}
