import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftCircle,
  ArrowRight,
  Check,
  Search,
  Trash2,
  Truck,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, sanitizeSearch, safeError } from "../../lib/utils";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";

const IVA_PCT = 19;

export default function CompraNueva() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [proveedor, setProveedor] = useState("");
  const [facturaProveedor, setFacturaProveedor] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [recibirAhora, setRecibirAhora] = useState(false);
  // estado_compra removido del form: se asigna 'completada' en BD por default.
  // Las garantías se gestionarán desde la compra ya recibida (Fase 13).

  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);

  const [carrito, setCarrito] = useState([]);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const guardandoRef = useRef(false);

  const buscarProductos = useCallback(async (q) => {
    if (!q || q.trim().length < 2) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    try {
      const safe = sanitizeSearch(q.trim());
      const { data, error: e } = await supabase
        .from("productos")
        .select("id, nombre, referencia, costo_promedio, unidad_medida")
        .eq("activo", true)
        .or(`nombre.ilike.%${safe}%,referencia.ilike.%${safe}%`)
        .limit(8);
      if (e) throw e;
      setResultados(data ?? []);
    } catch {
      setResultados([]);
    } finally {
      setBuscando(false);
    }
  }, []);

  const buscarDebounced = useDebouncedCallback(buscarProductos, 400);

  const handleBusquedaChange = (e) => {
    const val = e.target.value;
    setBusqueda(val);
    buscarDebounced(val);
  };

  const agregarAlCarrito = (prod) => {
    setBusqueda("");
    setResultados([]);
    setCarrito((prev) => {
      const idx = prev.findIndex((i) => i.producto_id === prod.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], cantidad: updated[idx].cantidad + 1 };
        return updated;
      }
      return [
        ...prev,
        {
          producto_id: prod.id,
          nombre: prod.nombre,
          referencia: prod.referencia,
          unidad: prod.unidad_medida,
          cantidad: 1,
          costo_unitario: prod.costo_promedio ?? 0,
        },
      ];
    });
  };

  const actualizarCantidad = (productoId, delta) => {
    setCarrito((prev) =>
      prev
        .map((i) => {
          if (i.producto_id !== productoId) return i;
          return { ...i, cantidad: Math.max(0, i.cantidad + delta) };
        })
        .filter((i) => i.cantidad > 0),
    );
  };

  const setCantidadDirecta = (productoId, valor) => {
    const n = parseInt(valor, 10);
    if (isNaN(n)) return;
    // Se clampa a [1, 100000]; teclear 0 NO elimina la fila (eso es la X).
    const clamped = Math.min(100000, Math.max(1, n));
    setCarrito((prev) =>
      prev.map((i) =>
        i.producto_id !== productoId ? i : { ...i, cantidad: clamped },
      ),
    );
  };

  const setCostoDirecto = (productoId, valor) => {
    const n = parseFloat(valor);
    if (isNaN(n) || n < 0 || n > 99999999) return;
    setCarrito((prev) =>
      prev.map((i) =>
        i.producto_id !== productoId ? i : { ...i, costo_unitario: n },
      ),
    );
  };

  const eliminarItem = (productoId) => {
    setCarrito((prev) => prev.filter((i) => i.producto_id !== productoId));
  };

  const subtotal = carrito.reduce(
    (s, i) => s + i.cantidad * i.costo_unitario,
    0,
  );
  const iva = subtotal * (IVA_PCT / 100);
  const total = subtotal + iva;
  const totalItems = carrito.reduce((s, i) => s + i.cantidad, 0);

  // Pasos del wizard: el paso "Proveedor" se considera completo cuando hay
  // nombre; "Productos" activo cuando hay al menos un item; el envío final
  // (registrar) hace las veces del paso "Confirmación".
  const pasoProveedor = proveedor.trim().length > 0;
  const pasoProductos = carrito.length > 0;

  const guardarCompra = async () => {
    if (!proveedor.trim()) {
      setError("El proveedor es obligatorio.");
      return;
    }
    if (carrito.length === 0) {
      setError("Agrega al menos un producto.");
      return;
    }
    // Guard síncrono: el `disabled` de React no evita el doble-clic veloz.
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setError(null);
    setGuardando(true);
    try {
      // RPC server-authoritative: registra compra + detalle en una sola
      // transacción, fija `registrado_por` y recalcula los totales.
      const { error: rpcErr } = await supabase.rpc("fn_registrar_compra", {
        p_sede_id: perfil?.sede_id,
        p_proveedor: proveedor.trim(),
        p_factura_proveedor: facturaProveedor.trim() || null,
        p_observaciones: observaciones.trim() || null,
        p_recibir: recibirAhora,
        p_items: carrito.map((i) => ({
          producto_id: i.producto_id,
          cantidad: i.cantidad,
          costo_unitario: i.costo_unitario,
        })),
      });
      if (rpcErr) throw new Error(rpcErr.message);

      navigate("/ops/compras");
    } catch (e) {
      setError(safeError(e, "Error al guardar la compra"));
    } finally {
      setGuardando(false);
      guardandoRef.current = false;
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 px-4 pb-14 pt-5 sm:px-7 animate-fade-in">
      <button
        onClick={() => navigate("/ops/compras")}
        className="back-btn inline-flex w-fit items-center gap-1.5"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver a Compras
      </button>

      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-end justify-between gap-4 border-b pb-3.5"
        style={{ borderColor: "var(--n-100)" }}
      >
        <div>
          <h1
            className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--n-950)" }}
          >
            Nueva compra
          </h1>
          <div className="mt-1 text-[13px]" style={{ color: "var(--n-500)" }}>
            Sede destino{" "}
            <b className="font-medium" style={{ color: "var(--n-700)" }}>
              {perfil?.sede_id ?? "—"}
            </b>{" "}
            · IVA {IVA_PCT}%
          </div>
        </div>
        <button
          onClick={() => navigate("/ops/compras")}
          className="btn btn-out"
          style={{ height: 48 }}
        >
          Cancelar
        </button>
      </div>

      {/* ── Stepper ─────────────────────────────────────────────────── */}
      <div className="stepper overflow-x-auto">
        <Step
          n={1}
          label="Proveedor"
          state={pasoProveedor ? "done" : "active"}
        />
        <Line done={pasoProveedor} />
        <Step
          n={2}
          label="Productos"
          state={pasoProductos ? "done" : pasoProveedor ? "active" : "todo"}
        />
        <Line done={pasoProductos} />
        <Step
          n={3}
          label="Confirmación"
          state={pasoProveedor && pasoProductos ? "active" : "todo"}
        />
      </div>

      {/* ── Wizard grid ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_340px]">
        {/* ── Columna principal ─────────────────────────────────────── */}
        <div className="flex flex-col gap-3.5">
          {/* Proveedor */}
          <div className="iblock flex flex-col gap-3.5">
            <div className="ib-head">
              <div className="ib-ico">
                <Truck className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Datos del proveedor</div>
            </div>
            <div className="grid grid-cols-1 gap-3 gap-x-3.5 sm:grid-cols-2">
              <Field label="Proveedor" req>
                <input
                  type="text"
                  value={proveedor}
                  onChange={(e) => setProveedor(e.target.value)}
                  placeholder="Nombre del proveedor"
                  className="finput sans"
                />
              </Field>
              <Field label="N° factura del proveedor">
                <input
                  type="text"
                  value={facturaProveedor}
                  onChange={(e) => setFacturaProveedor(e.target.value)}
                  placeholder="Opcional"
                  className="finput sans"
                />
              </Field>
            </div>
          </div>

          {/* Productos */}
          <div className="iblock flex flex-col gap-3.5">
            <div className="ib-head">
              <div className="ib-ico">
                <Search className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Productos a ordenar</div>
              <div className="ib-aux">{carrito.length} en la orden</div>
            </div>

            {/* Búsqueda */}
            <div
              className="flex h-11 items-center gap-2.5 rounded-[10px] border px-3.5"
              style={{
                borderColor: "var(--n-150)",
                backgroundColor: "var(--n-0)",
              }}
            >
              <Search
                className="h-4 w-4 shrink-0"
                strokeWidth={1.5}
                style={{ color: "var(--n-300)" }}
              />
              <input
                type="text"
                value={busqueda}
                onChange={handleBusquedaChange}
                placeholder="Buscar por nombre o referencia del catálogo…"
                className="flex-1 border-none bg-transparent text-[14px] outline-none"
                style={{ color: "var(--n-700)" }}
              />
            </div>

            {buscando && (
              <p className="text-xs" style={{ color: "var(--n-500)" }}>
                Buscando…
              </p>
            )}

            {resultados.length > 0 && (
              <div
                className="overflow-hidden rounded-lg border"
                style={{ borderColor: "var(--n-150)" }}
              >
                {resultados.map((r, idx) => (
                  <button
                    key={r.id}
                    onClick={() => agregarAlCarrito(r)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors"
                    style={{
                      borderTop: idx === 0 ? "none" : "1px solid var(--n-100)",
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
                        className="text-sm font-medium"
                        style={{ color: "var(--n-950)" }}
                      >
                        {r.nombre}
                      </p>
                      <p
                        className="font-mono text-[11px]"
                        style={{ color: "var(--n-500)" }}
                      >
                        {r.referencia} · {r.unidad_medida}
                      </p>
                    </div>
                    <span className="text-xs" style={{ color: "var(--p-600)" }}>
                      + Agregar
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Carrito */}
            {carrito.length === 0 ? (
              <p
                className="rounded-[10px] border border-dashed py-10 text-center text-sm"
                style={{
                  borderColor: "var(--n-200)",
                  backgroundColor: "var(--n-25)",
                  color: "var(--n-500)",
                }}
              >
                Busca y agrega productos a la orden de compra
              </p>
            ) : (
              <>
                {/* Desktop: tabla */}
                <div
                  className="hidden overflow-hidden rounded-[10px] border md:block"
                  style={{ borderColor: "var(--n-150)" }}
                >
                  <table className="prod-tbl w-full">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th className="r" style={{ width: 130 }}>
                          Cantidad
                        </th>
                        <th className="r" style={{ width: 140 }}>
                          Costo unit
                        </th>
                        <th className="r" style={{ width: 120 }}>
                          Subtotal
                        </th>
                        <th style={{ width: 42 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {carrito.map((item) => (
                        <tr key={item.producto_id}>
                          <td>
                            <p
                              className="text-[12.5px] font-medium leading-tight"
                              style={{ color: "var(--n-950)" }}
                            >
                              {item.nombre}
                            </p>
                            <p
                              className="font-mono text-[11px]"
                              style={{ color: "var(--n-500)" }}
                            >
                              {item.referencia}
                            </p>
                          </td>
                          <td className="text-right">
                            <div className="inline-flex items-center gap-1">
                              <QtyBtn
                                onClick={() =>
                                  actualizarCantidad(item.producto_id, -1)
                                }
                              >
                                −
                              </QtyBtn>
                              <input
                                type="number"
                                min="1"
                                value={item.cantidad}
                                onChange={(e) =>
                                  setCantidadDirecta(
                                    item.producto_id,
                                    e.target.value,
                                  )
                                }
                                className="w-12 rounded-lg border py-1 text-center font-mono text-sm font-semibold outline-none"
                                style={{
                                  borderColor: "var(--n-150)",
                                  color: "var(--n-950)",
                                  backgroundColor: "var(--n-0)",
                                }}
                              />
                              <QtyBtn
                                onClick={() =>
                                  actualizarCantidad(item.producto_id, 1)
                                }
                              >
                                +
                              </QtyBtn>
                            </div>
                          </td>
                          <td className="text-right">
                            <input
                              type="number"
                              min="0"
                              step="100"
                              value={item.costo_unitario}
                              onChange={(e) =>
                                setCostoDirecto(
                                  item.producto_id,
                                  e.target.value,
                                )
                              }
                              className="w-32 rounded-lg border px-3 py-1.5 text-right font-mono text-sm outline-none"
                              style={{
                                borderColor: "var(--n-150)",
                                color: "var(--n-950)",
                                backgroundColor: "var(--n-0)",
                              }}
                            />
                          </td>
                          <td className="text-right">
                            <span
                              className="font-mono text-sm font-semibold tabular-nums"
                              style={{ color: "var(--n-950)" }}
                            >
                              {formatCOP(item.cantidad * item.costo_unitario)}
                            </span>
                          </td>
                          <td>
                            <button
                              onClick={() => eliminarItem(item.producto_id)}
                              className="grid h-8 w-8 place-items-center rounded-lg transition-colors"
                              style={{ color: "var(--n-500)" }}
                              onMouseEnter={(e) =>
                                (e.currentTarget.style.color =
                                  "var(--dang-600)")
                              }
                              onMouseLeave={(e) =>
                                (e.currentTarget.style.color = "var(--n-500)")
                              }
                              aria-label="Eliminar producto"
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile: cards */}
                <div className="space-y-2.5 md:hidden">
                  {carrito.map((item) => (
                    <div
                      key={item.producto_id}
                      className="space-y-2 rounded-[10px] border p-3"
                      style={{
                        backgroundColor: "var(--n-0)",
                        borderColor: "var(--n-150)",
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p
                            className="truncate text-sm font-medium"
                            style={{ color: "var(--n-950)" }}
                          >
                            {item.nombre}
                          </p>
                          <p
                            className="font-mono text-[11px]"
                            style={{ color: "var(--n-500)" }}
                          >
                            {item.referencia}
                          </p>
                        </div>
                        <button
                          onClick={() => eliminarItem(item.producto_id)}
                          className="shrink-0"
                          style={{ color: "var(--n-500)" }}
                          aria-label="Eliminar producto"
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-1">
                          <QtyBtn
                            onClick={() =>
                              actualizarCantidad(item.producto_id, -1)
                            }
                          >
                            −
                          </QtyBtn>
                          <input
                            type="number"
                            min="1"
                            value={item.cantidad}
                            onChange={(e) =>
                              setCantidadDirecta(
                                item.producto_id,
                                e.target.value,
                              )
                            }
                            className="w-14 rounded-lg border py-1.5 text-center font-mono text-sm font-semibold outline-none"
                            style={{
                              borderColor: "var(--n-150)",
                              color: "var(--n-950)",
                              backgroundColor: "var(--n-0)",
                            }}
                          />
                          <QtyBtn
                            onClick={() =>
                              actualizarCantidad(item.producto_id, 1)
                            }
                          >
                            +
                          </QtyBtn>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="text-xs"
                            style={{ color: "var(--n-500)" }}
                          >
                            $
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="100"
                            value={item.costo_unitario}
                            onChange={(e) =>
                              setCostoDirecto(item.producto_id, e.target.value)
                            }
                            className="w-28 rounded-lg border px-2 py-1.5 font-mono text-sm outline-none"
                            style={{
                              borderColor: "var(--n-150)",
                              color: "var(--n-950)",
                              backgroundColor: "var(--n-0)",
                            }}
                          />
                        </div>
                        <span
                          className="ml-auto font-mono text-sm font-bold tabular-nums"
                          style={{ color: "var(--n-950)" }}
                        >
                          {formatCOP(item.cantidad * item.costo_unitario)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Observaciones */}
          <div className="iblock flex flex-col gap-3">
            <div className="ib-head">
              <div className="ib-title">Observaciones</div>
            </div>
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Observaciones internas (opcional)"
              rows={2}
              className="ftextarea"
            />
          </div>

          {/* Recibir ahora */}
          <label
            className="flex cursor-pointer select-none items-center gap-3 rounded-[10px] border p-4"
            style={{
              backgroundColor: "var(--n-0)",
              borderColor: recibirAhora ? "var(--p-500)" : "var(--n-150)",
            }}
          >
            <input
              type="checkbox"
              checked={recibirAhora}
              onChange={(e) => setRecibirAhora(e.target.checked)}
              className="h-5 w-5 cursor-pointer rounded"
              style={{ accentColor: "var(--p-600)" }}
            />
            <div>
              <p
                className="text-sm font-semibold"
                style={{ color: "var(--n-950)" }}
              >
                Marcar como recibida ahora
              </p>
              <p className="text-xs" style={{ color: "var(--n-500)" }}>
                El stock se sumará automáticamente al confirmar
              </p>
            </div>
          </label>

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

        {/* ── Resumen (sticky) ──────────────────────────────────────── */}
        <aside className="cart">
          <span className="cart-eyebrow">Resumen de la compra</span>
          <div className="text-[12px]" style={{ color: "var(--n-500)" }}>
            {totalItems} items · {carrito.length} productos
          </div>
          <div className="cart-line">
            <span>Subtotal</span>
            <span className="v">{formatCOP(subtotal)}</span>
          </div>
          <div className="cart-line">
            <span>IVA {IVA_PCT}%</span>
            <span className="v">{formatCOP(iva)}</span>
          </div>
          <div className="cart-line tot">
            <span>Total estimado</span>
            <span className="v">{formatCOP(total)}</span>
          </div>
          <button
            onClick={guardarCompra}
            disabled={carrito.length === 0 || !proveedor.trim() || guardando}
            className="btn btn-pri mt-2 w-full justify-center disabled:opacity-40"
            style={{ height: 48 }}
          >
            {guardando ? (
              "Guardando…"
            ) : recibirAhora ? (
              <>
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                Registrar y recibir
              </>
            ) : (
              <>
                Registrar compra
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
              </>
            )}
          </button>
        </aside>
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

function QtyBtn({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="grid h-8 w-8 place-items-center rounded-lg border text-lg font-bold transition-colors disabled:opacity-40"
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
