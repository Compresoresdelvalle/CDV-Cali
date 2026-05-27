import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftCircle,
  Search,
  ScanLine,
  Trash2,
  Minus,
  Plus,
  Star,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import {
  formatCOP,
  formatDate,
  sanitizeSearch,
  safeError,
} from "../../lib/utils";
import QRScanner from "../../components/forms/QRScanner";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import { metodoPagoClass } from "../../lib/ventas-ui";

const METODOS_PAGO = ["Efectivo", "Transferencia", "Tarjeta", "Crédito"];
const IVA_PCT = 19;

export default function VentaNueva() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [carrito, setCarrito] = useState([]);
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteNit, setClienteNit] = useState("");
  const [metodoPago, setMetodoPago] = useState("Efectivo");
  const [descuentoPct, setDescuentoPct] = useState(0);
  const [observaciones, setObservaciones] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState(null);
  const [historialCliente, setHistorialCliente] = useState(null);

  const buscarProductos = useCallback(
    async (q) => {
      if (!q || q.trim().length < 2 || !perfil?.sede_id) {
        setResultados([]);
        return;
      }
      setBuscando(true);
      try {
        const safe = sanitizeSearch(q.trim());
        const { data: prods, error: e1 } = await supabase
          .from("productos")
          .select("id, nombre, referencia, precio_venta, unidad_medida")
          .eq("activo", true)
          .or(`nombre.ilike.%${safe}%,referencia.ilike.%${safe}%`)
          .limit(10);
        if (e1) throw e1;
        if (!prods?.length) {
          setResultados([]);
          return;
        }

        const ids = prods.map((p) => p.id);
        const { data: inv, error: e2 } = await supabase
          .from("inventario")
          .select("producto_id, cantidad")
          .eq("sede_id", perfil.sede_id)
          .gt("cantidad", 0)
          .in("producto_id", ids);
        if (e2) throw e2;

        const stockMap = Object.fromEntries(
          (inv ?? []).map((i) => [i.producto_id, i.cantidad]),
        );
        const merged = prods
          .filter((p) => stockMap[p.id] !== undefined)
          .map((p) => ({ ...p, stock_disponible: stockMap[p.id] }));

        setResultados(merged.slice(0, 8));
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
    buscarDebounced(val);
  };

  // Lookup read-only del historial del cliente (banner "cliente recurrente").
  // Cuenta ventas previas no anuladas con ese nombre exacto. NO escribe nada.
  const buscarHistorialCliente = useDebouncedCallback(async (nombre) => {
    const n = (nombre || "").trim();
    if (n.length < 3) {
      setHistorialCliente(null);
      return;
    }
    try {
      const { data, error: e } = await supabase
        .from("ventas")
        .select("total, fecha")
        .eq("cliente_nombre", n)
        .eq("anulada", false)
        .order("fecha", { ascending: false })
        .limit(50);
      if (e) throw e;
      if (!data || data.length === 0) {
        setHistorialCliente(null);
        return;
      }
      setHistorialCliente({
        compras: data.length,
        ultimaFecha: data[0]?.fecha ?? null,
        ultimoTotal: Number(data[0]?.total ?? 0),
      });
    } catch {
      setHistorialCliente(null);
    }
  }, 500);

  const handleClienteNombreChange = (e) => {
    const val = e.target.value;
    setClienteNombre(val);
    buscarHistorialCliente(val);
  };

  const handleQRFound = useCallback(
    async (productoId) => {
      setScannerOpen(false);
      try {
        const [{ data: prod }, { data: inv }] = await Promise.all([
          supabase
            .from("productos")
            .select("id, nombre, referencia, precio_venta, unidad_medida")
            .eq("id", productoId)
            .eq("activo", true)
            .maybeSingle(),
          supabase
            .from("inventario")
            .select("cantidad")
            .eq("sede_id", perfil?.sede_id)
            .eq("producto_id", productoId)
            .maybeSingle(),
        ]);
        if (!prod || !inv || inv.cantidad <= 0) return;
        agregarAlCarrito({ ...prod, stock_disponible: inv.cantidad });
      } catch {
        // silently ignore
      }
    },
    [perfil?.sede_id],
  );

  const agregarAlCarrito = (prod) => {
    setBusqueda("");
    setResultados([]);
    setCarrito((prev) => {
      const idx = prev.findIndex((i) => i.producto_id === prod.id);
      if (idx >= 0) {
        const updated = [...prev];
        const item = { ...updated[idx] };
        if (item.cantidad < prod.stock_disponible) item.cantidad += 1;
        updated[idx] = item;
        return updated;
      }
      return [
        ...prev,
        {
          producto_id: prod.id,
          nombre: prod.nombre,
          referencia: prod.referencia,
          precio_unitario: prod.precio_venta,
          unidad: prod.unidad_medida,
          stock_disponible: prod.stock_disponible,
          cantidad: 1,
        },
      ];
    });
  };

  const actualizarCantidad = (productoId, delta) => {
    setCarrito((prev) =>
      prev
        .map((i) => {
          if (i.producto_id !== productoId) return i;
          const nueva = Math.max(
            0,
            Math.min(i.cantidad + delta, i.stock_disponible),
          );
          return { ...i, cantidad: nueva };
        })
        .filter((i) => i.cantidad > 0),
    );
  };

  const setCantidadDirecta = (productoId, valor) => {
    const n = parseInt(valor, 10);
    if (isNaN(n)) return;
    setCarrito((prev) =>
      prev
        .map((i) => {
          if (i.producto_id !== productoId) return i;
          return {
            ...i,
            cantidad: Math.max(0, Math.min(n, i.stock_disponible)),
          };
        })
        .filter((i) => i.cantidad > 0),
    );
  };

  const eliminarItem = (productoId) => {
    setCarrito((prev) => prev.filter((i) => i.producto_id !== productoId));
  };

  // Misma fórmula que el trigger trg_recalcular_total_venta del servidor:
  // total = subtotal * (1 - desc/100) * (1 + iva/100)
  // Esto evita drifts de 1-2 COP por orden de operaciones distinto.
  const subtotal = carrito.reduce(
    (s, i) => s + i.cantidad * i.precio_unitario,
    0,
  );
  const descuento = subtotal * (descuentoPct / 100);
  const baseIva = subtotal - descuento;
  const iva = baseIva * (IVA_PCT / 100);
  const total = subtotal * (1 - descuentoPct / 100) * (1 + IVA_PCT / 100);

  // Paso activo del stepper, derivado del estado real de la venta en curso.
  const pasoActivo = useMemo(() => {
    if (confirmando) return 3;
    if (carrito.length === 0) return 1;
    return 2;
  }, [carrito.length, confirmando]);

  const confirmarVenta = async () => {
    if (carrito.length === 0) return;
    setError(null);
    setConfirmando(true);
    try {
      const { error: rpcErr } = await supabase.rpc("fn_registrar_venta", {
        p_sede_id: perfil.sede_id,
        p_cliente_nombre: clienteNombre || null,
        p_cliente_nit: clienteNit || null,
        p_metodo_pago: metodoPago,
        p_descuento_pct: descuentoPct,
        p_observaciones: observaciones || null,
        p_items: carrito.map((i) => ({
          producto_id: i.producto_id,
          cantidad: i.cantidad,
          precio_unitario: i.precio_unitario,
        })),
      });
      if (rpcErr) throw new Error(rpcErr.message);
      navigate("/ops/ventas");
    } catch (e) {
      setError(safeError(e, "Error al registrar la venta"));
    } finally {
      setConfirmando(false);
    }
  };

  return (
    <div className="px-4 pb-16 pt-5 sm:px-7 animate-fade-in">
      <button
        onClick={() => navigate("/ops/ventas")}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium transition-colors"
        style={{ color: "var(--n-500)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--n-700)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--n-500)")}
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver a Ventas
      </button>

      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div
        className="mt-4 flex flex-wrap items-end justify-between gap-4 border-b pb-4"
        style={{ borderColor: "var(--n-150)" }}
      >
        <div>
          <h1
            className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--n-950)" }}
          >
            Nueva venta
          </h1>
          <p className="mt-1.5 text-[13px]" style={{ color: "var(--n-500)" }}>
            Vendedor ·{" "}
            <b
              className="font-mono font-medium"
              style={{ color: "var(--n-700)" }}
            >
              {perfil?.nombre ?? "—"}
            </b>{" "}
            · Sede{" "}
            <b
              className="font-mono font-medium"
              style={{ color: "var(--n-700)" }}
            >
              {perfil?.sede_id ?? "—"}
            </b>
          </p>
        </div>
        <button
          onClick={() => navigate("/ops/ventas")}
          className="btn btn-out"
          style={{ height: 48 }}
        >
          Cancelar
        </button>
      </div>

      {/* ── Stepper ─────────────────────────────────────────────────── */}
      <div className="stepper mt-5">
        <Step n={1} label="Cliente y productos" estado={pasoActivo} />
        <div className={`step-line ${pasoActivo > 1 ? "done" : ""}`} />
        <Step n={2} label="Pago" estado={pasoActivo} />
        <div className={`step-line ${pasoActivo > 2 ? "done" : ""}`} />
        <Step n={3} label="Confirmar" estado={pasoActivo} />
      </div>

      {/* ── Banner cliente recurrente (derivado real, solo si existe) ── */}
      {historialCliente && historialCliente.compras > 0 && (
        <div className="banner-info mt-4">
          <Star className="size-4 shrink-0" strokeWidth={2} />
          <div className="body">
            <b>{clienteNombre.trim()}</b> tiene{" "}
            <b>{historialCliente.compras}</b> compra
            {historialCliente.compras !== 1 ? "s" : ""} previa
            {historialCliente.compras !== 1 ? "s" : ""}
            {historialCliente.ultimaFecha && (
              <>
                . Última compra el{" "}
                <b>{formatDate(historialCliente.ultimaFecha)}</b> por{" "}
                <b>{formatCOP(historialCliente.ultimoTotal)}</b>
              </>
            )}
            .<sub>Cliente recurrente en esta sede</sub>
          </div>
        </div>
      )}

      {/* ── Grid ────────────────────────────────────────────────────── */}
      <div className="mt-4 grid items-start gap-5 lg:grid-cols-[1fr_340px]">
        {/* ── Columna principal ─────────────────────────────────────── */}
        <div className="iblock space-y-4">
          <div>
            <div
              className="font-mono text-[11px] uppercase tracking-[0.1em]"
              style={{ color: "var(--n-500)" }}
            >
              Datos del cliente
            </div>
            <h2
              className="mt-1 text-[17px] font-medium"
              style={{ color: "var(--n-950)" }}
            >
              Cliente y productos
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Cliente (opcional)" full>
              <input
                value={clienteNombre}
                onChange={handleClienteNombreChange}
                placeholder="Nombre del cliente"
                className="finput sans"
              />
            </Field>
            <Field label="NIT o Cédula">
              <input
                value={clienteNit}
                onChange={(e) => setClienteNit(e.target.value)}
                placeholder="NIT o Cédula"
                className="finput"
              />
            </Field>
            <Field label="Notas">
              <input
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Observaciones (opcional)"
                className="finput sans"
              />
            </Field>
          </div>

          <div className="h-px" style={{ backgroundColor: "var(--n-150)" }} />

          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--n-500)" }}
          >
            Productos a vender
          </div>

          {/* Buscador de productos + QR */}
          <div className="flex items-stretch">
            <div
              className="flex h-12 flex-1 items-center gap-2.5 rounded-l-[10px] border border-r-0 px-3.5"
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
                placeholder="Buscar nombre, referencia o escanea QR…"
                className="min-w-0 flex-1 border-none bg-transparent text-[14px] outline-none"
                style={{ color: "var(--n-950)" }}
              />
            </div>
            <button
              onClick={() => setScannerOpen(true)}
              className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-l-none rounded-r-[10px] px-4 text-white"
              style={{ backgroundColor: "var(--p-600)" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--p-700)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--p-600)")
              }
              aria-label="Escanear QR"
            >
              <ScanLine className="h-4 w-4" strokeWidth={1.7} />
              <span className="hidden sm:inline">Escanear QR</span>
            </button>
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
                      {r.referencia} · Stock: {r.stock_disponible}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className="font-mono text-sm font-semibold"
                      style={{ color: "var(--n-950)" }}
                    >
                      {formatCOP(r.precio_venta)}
                    </p>
                    <p className="text-xs" style={{ color: "var(--n-500)" }}>
                      {r.unidad_medida}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Tabla de productos del carrito (estilo Lovable prod-tbl) */}
          {carrito.length === 0 ? (
            <div
              className="rounded-[10px] border border-dashed px-4 py-10 text-center text-sm"
              style={{ borderColor: "var(--n-200)", color: "var(--n-500)" }}
            >
              Busca o escanea productos para agregarlos a la venta
            </div>
          ) : (
            <div
              className="overflow-hidden rounded-[10px] border"
              style={{ borderColor: "var(--n-150)" }}
            >
              <table className="prod-tbl">
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>Ref.</th>
                    <th>Producto</th>
                    <th className="r" style={{ width: 132 }}>
                      Cant
                    </th>
                    <th className="r" style={{ width: 110 }}>
                      Unit
                    </th>
                    <th className="r" style={{ width: 120 }}>
                      Subtotal
                    </th>
                    <th style={{ width: 42 }} />
                  </tr>
                </thead>
                <tbody>
                  {carrito.map((item) => {
                    const topeStock = item.cantidad >= item.stock_disponible;
                    return (
                      <tr key={item.producto_id}>
                        <td>
                          <span className="p-sku">
                            {item.referencia ?? "—"}
                          </span>
                          <div className="p-meta">{item.unidad ?? ""}</div>
                        </td>
                        <td>
                          <div className="p-nm">{item.nombre}</div>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <QtyControl
                            value={item.cantidad}
                            danger={topeStock}
                            onDec={() =>
                              actualizarCantidad(item.producto_id, -1)
                            }
                            onInc={() =>
                              actualizarCantidad(item.producto_id, 1)
                            }
                            onSet={(v) =>
                              setCantidadDirecta(item.producto_id, v)
                            }
                            max={item.stock_disponible}
                            incDisabled={topeStock}
                          />
                          {topeStock && (
                            <div
                              className="mt-1 inline-flex items-center gap-1 font-mono text-[10.5px]"
                              style={{ color: "var(--warn-700)" }}
                            >
                              <AlertTriangle className="size-3" /> Máx.{" "}
                              {item.stock_disponible} en stock
                            </div>
                          )}
                        </td>
                        <td className="p-pr">
                          {formatCOP(item.precio_unitario)}
                        </td>
                        <td className="p-sub">
                          {formatCOP(item.cantidad * item.precio_unitario)}
                        </td>
                        <td>
                          <button
                            onClick={() => eliminarItem(item.producto_id)}
                            className="flex size-7 items-center justify-center rounded-md transition-colors"
                            style={{ color: "var(--n-500)" }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.color = "var(--dang-600)")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.color = "var(--n-500)")
                            }
                            aria-label="Eliminar producto"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pago — método y descuento */}
          <div className="h-px" style={{ backgroundColor: "var(--n-150)" }} />
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--n-500)" }}
          >
            Pago
          </div>
          <div className="flex flex-wrap gap-2">
            {METODOS_PAGO.map((m) => {
              const on = metodoPago === m;
              return (
                <button
                  key={m}
                  onClick={() => setMetodoPago(m)}
                  className={`pay-pill ${metodoPagoClass(m)}`}
                  style={{
                    minHeight: 36,
                    cursor: "pointer",
                    opacity: on ? 1 : 0.55,
                    outline: on
                      ? "2px solid var(--p-400)"
                      : "1px solid transparent",
                    outlineOffset: on ? 1 : 0,
                  }}
                >
                  <span className="dot" />
                  {m}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm" style={{ color: "var(--n-500)" }}>
              Descuento %
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={descuentoPct}
              onChange={(e) =>
                setDescuentoPct(
                  Math.min(100, Math.max(0, Number(e.target.value))),
                )
              }
              className="finput"
              style={{ width: 80, textAlign: "center" }}
            />
          </div>

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

        {/* ── Resumen (cart sticky) ─────────────────────────────────── */}
        <aside className="cart">
          <span className="cart-eyebrow">Resumen</span>
          <div className="text-[12px]" style={{ color: "var(--n-500)" }}>
            {carrito.length} producto{carrito.length !== 1 ? "s" : ""}
          </div>
          <div className="cart-line">
            <span>Subtotal</span>
            <span className="v">{formatCOP(subtotal)}</span>
          </div>
          {descuentoPct > 0 && (
            <div className="cart-line" style={{ color: "var(--warn-700)" }}>
              <span>Descuento ({descuentoPct}%)</span>
              <span className="v" style={{ color: "var(--warn-700)" }}>
                −{formatCOP(descuento)}
              </span>
            </div>
          )}
          <div className="cart-line">
            <span>IVA {IVA_PCT}%</span>
            <span className="v">{formatCOP(iva)}</span>
          </div>
          <div className="cart-line tot">
            <span>Total</span>
            <span className="v">{formatCOP(total)}</span>
          </div>
          <button
            onClick={confirmarVenta}
            disabled={carrito.length === 0 || confirmando}
            className="btn btn-pri mt-1 w-full justify-center disabled:opacity-40"
            style={{ height: 48 }}
          >
            {confirmando ? (
              "Registrando…"
            ) : (
              <>
                Confirmar venta <ChevronRight className="size-3.5" />
              </>
            )}
          </button>
        </aside>
      </div>

      {scannerOpen && (
        <QRScanner
          onFound={handleQRFound}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function Step({ n, label, estado }) {
  const cls = estado > n ? "done" : estado === n ? "active" : "todo";
  return (
    <div className={`step ${cls}`}>
      <div className="step-dot">{n}</div>
      <div className="step-lbl">{label}</div>
    </div>
  );
}

function Field({ label, full, children }) {
  return (
    <div className={`flex flex-col gap-1.5 ${full ? "sm:col-span-2" : ""}`}>
      <label
        className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--n-500)" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function QtyControl({ value, danger, onDec, onInc, onSet, max, incDisabled }) {
  return (
    <div
      className="inline-flex h-9 items-center overflow-hidden rounded-md border"
      style={
        danger
          ? {
              borderColor: "var(--dang-border)",
              backgroundColor: "var(--dang-50)",
            }
          : { borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }
      }
    >
      <button
        onClick={onDec}
        className="grid h-full w-8 place-items-center transition-colors"
        style={{ color: "var(--n-700)" }}
        aria-label="Disminuir cantidad"
      >
        <Minus className="size-3.5" />
      </button>
      <input
        type="number"
        min="1"
        max={max}
        value={value}
        onChange={(e) => onSet(e.target.value)}
        className="w-10 border-0 bg-transparent text-center font-mono text-[13px] font-medium outline-none"
        style={{ color: danger ? "var(--dang-700)" : "var(--n-950)" }}
      />
      <button
        onClick={onInc}
        disabled={incDisabled}
        className="grid h-full w-8 place-items-center transition-colors disabled:opacity-40"
        style={{ color: "var(--n-700)" }}
        aria-label="Aumentar cantidad"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
