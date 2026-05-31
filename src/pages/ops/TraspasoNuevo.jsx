import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftCircle, Search, Trash2, ArrowRight } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { safeError } from "../../lib/utils";
import { applyKeywordSearch } from "../../lib/search";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import { sedeLabel } from "../../lib/traspasos-ui";
import { useSedes } from "../../hooks/useSedes";

const TIPOS = [
  { v: "normal", label: "Normal" },
  {
    v: "mercancia_abandonada",
    label: "Mercancía abandonada (retroceso a bodega)",
  },
  { v: "devolucion_garantia", label: "Devolución interna por garantía" },
];

export default function TraspasoNuevo() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";

  // Sedes activas desde la BD (única fuente de verdad)
  const { sedes: SEDES } = useSedes();

  // Sede origen: Admin puede elegir, el resto usa su sede
  const [sedeOrigen, setSedeOrigen] = useState(
    esAdmin ? "" : (perfil?.sede_id ?? ""),
  );
  const [sedeDestino, setSedeDestino] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [tipoTraspaso, setTipoTraspaso] = useState("normal"); // F12

  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [items, setItems] = useState([]);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const guardandoRef = useRef(false);

  const buscarProductos = useCallback(
    async (q) => {
      if (!q || q.trim().length < 2 || !sedeOrigen) {
        setResultados([]);
        return;
      }
      setBuscando(true);
      try {
        // #32: búsqueda por palabras clave en nombre/referencia.
        let pq = supabase
          .from("productos")
          .select("id, nombre, referencia, unidad_medida")
          .eq("activo", true);
        pq = applyKeywordSearch(pq, q, ["nombre", "referencia"]);
        const { data: prods } = await pq.limit(8);

        const ids = (prods ?? []).map((p) => p.id);
        if (!ids.length) {
          setResultados([]);
          return;
        }

        const { data: inv } = await supabase
          .from("inventario")
          .select("producto_id, cantidad")
          .eq("sede_id", sedeOrigen)
          .gt("cantidad", 0)
          .in("producto_id", ids);

        const stockMap = Object.fromEntries(
          (inv ?? []).map((i) => [i.producto_id, i.cantidad]),
        );

        setResultados(
          (prods ?? [])
            .filter((p) => stockMap[p.id] !== undefined)
            .map((p) => ({ ...p, stock: stockMap[p.id] })),
        );
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    },
    [sedeOrigen],
  );

  const buscarDebounced = useDebouncedCallback(buscarProductos, 400);

  const agregarItem = (prod) => {
    setBusqueda("");
    setResultados([]);
    setItems((prev) => {
      if (prev.find((i) => i.producto_id === prod.id)) return prev;
      return [
        ...prev,
        {
          producto_id: prod.id,
          nombre: prod.nombre,
          referencia: prod.referencia,
          unidad: prod.unidad_medida,
          stock_disponible: prod.stock,
          cantidad_solicitada: 1,
        },
      ];
    });
  };

  const actualizarCantidad = (productoId, valor) => {
    const n = parseInt(valor, 10);
    if (isNaN(n) || n < 1) return;
    setItems((prev) =>
      prev.map((i) =>
        i.producto_id !== productoId
          ? i
          : {
              ...i,
              cantidad_solicitada: Math.min(n, i.stock_disponible),
            },
      ),
    );
  };

  const eliminarItem = (productoId) =>
    setItems((prev) => prev.filter((i) => i.producto_id !== productoId));

  const guardar = async () => {
    if (!sedeOrigen) {
      setError("Selecciona la sede de origen.");
      return;
    }
    if (!sedeDestino) {
      setError("Selecciona la sede de destino.");
      return;
    }
    if (sedeOrigen === sedeDestino) {
      setError("La sede de origen y destino no pueden ser la misma.");
      return;
    }
    if (items.length === 0) {
      setError("Agrega al menos un producto al traspaso.");
      return;
    }
    // Guard síncrono contra doble-submit (el `disabled` no es inmediato).
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setError(null);
    setGuardando(true);
    try {
      // RPC server-authoritative: crea cabecera + detalle en una transacción
      // y fija `solicitado_por = auth.uid()`.
      const { data, error: rpcErr } = await supabase.rpc("fn_crear_traspaso", {
        p_sede_origen: sedeOrigen,
        p_sede_destino: sedeDestino,
        p_tipo: tipoTraspaso,
        p_observaciones: observaciones.trim() || null,
        p_items: items.map((i) => ({
          producto_id: i.producto_id,
          cantidad_solicitada: i.cantidad_solicitada,
        })),
      });
      if (rpcErr) throw new Error(rpcErr.message);
      if (!data?.traspaso_id)
        throw new Error("Respuesta inesperada del servidor.");

      navigate(`/ops/traspasos/${data.traspaso_id}`);
    } catch (e) {
      setError(safeError(e, "Error al crear el traspaso"));
    } finally {
      setGuardando(false);
      guardandoRef.current = false;
    }
  };

  const sedesDestino = SEDES.filter((s) => s.id !== sedeOrigen);
  const totalUnidades = items.reduce((s, i) => s + i.cantidad_solicitada, 0);
  const puedeGuardar =
    sedeOrigen && sedeDestino && sedeOrigen !== sedeDestino && items.length > 0;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      <button
        onClick={() => navigate("/ops/traspasos")}
        className="back-btn mb-3 inline-flex items-center gap-1.5"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver a Traspasos
      </button>

      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ color: "var(--n-300)" }}
          >
            Operaciones · Movimiento entre sedes
          </p>
          <h1
            className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.018em]"
            style={{ color: "var(--n-950)" }}
          >
            Nuevo traspaso
          </h1>
        </div>
        <button
          onClick={() => navigate("/ops/traspasos")}
          className="btn btn-out"
          style={{ height: 48 }}
        >
          Cancelar
        </button>
      </div>

      <div className="mt-[18px] grid items-start gap-[18px] lg:grid-cols-[1fr_360px]">
        {/* ── Columna principal ─────────────────────────────────────── */}
        <div className="flex flex-col gap-[18px]">
          {/* Sedes */}
          <SectionCard title="Sedes">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Sede origen</Label>
                {esAdmin ? (
                  <select
                    value={sedeOrigen}
                    onChange={(e) => {
                      setSedeOrigen(e.target.value);
                      setItems([]);
                      setBusqueda("");
                      setResultados([]);
                    }}
                    className="finput sans"
                  >
                    <option value="">Seleccionar sede…</option>
                    {SEDES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nombre}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="finput sans locked">
                    {sedeLabel(sedeOrigen)}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Sede destino</Label>
                <select
                  value={sedeDestino}
                  onChange={(e) => setSedeDestino(e.target.value)}
                  className="finput sans"
                >
                  <option value="">Seleccionar sede…</option>
                  {sedesDestino.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </SectionCard>

          {/* Productos */}
          <SectionCard title="Agregar productos">
            {!sedeOrigen ? (
              <p className="text-sm" style={{ color: "var(--n-500)" }}>
                Selecciona la sede de origen para buscar productos disponibles.
              </p>
            ) : (
              <>
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
                    onChange={(e) => {
                      setBusqueda(e.target.value);
                      buscarDebounced(e.target.value);
                    }}
                    placeholder="Buscar por nombre o referencia…"
                    className="flex-1 border-none bg-transparent text-[14px] outline-none"
                    style={{ color: "var(--n-950)" }}
                  />
                </div>

                {buscando && (
                  <p className="mt-2 text-xs" style={{ color: "var(--n-500)" }}>
                    Buscando…
                  </p>
                )}

                {resultados.length > 0 && (
                  <div
                    className="mt-2 overflow-hidden rounded-lg border"
                    style={{ borderColor: "var(--n-150)" }}
                  >
                    {resultados.map((p, idx) => (
                      <button
                        key={p.id}
                        onClick={() => agregarItem(p)}
                        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors"
                        style={{
                          borderTop:
                            idx === 0 ? "none" : "1px solid var(--n-100)",
                          backgroundColor: "var(--n-0)",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor =
                            "var(--n-50)")
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
                            {p.nombre}
                          </p>
                          <p
                            className="font-mono text-[11px]"
                            style={{ color: "var(--n-500)" }}
                          >
                            {p.referencia} · {p.unidad_medida}
                          </p>
                        </div>
                        <span className="stk-pill s">{p.stock} disp.</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Carrito de items */}
                {items.length === 0 ? (
                  <p
                    className="py-8 text-center text-sm"
                    style={{ color: "var(--n-500)" }}
                  >
                    Agrega productos al traspaso
                  </p>
                ) : (
                  <div className="mt-3">
                    {/* Desktop: tabla */}
                    <div
                      className="hidden overflow-hidden rounded-[10px] border md:block"
                      style={{ borderColor: "var(--n-150)" }}
                    >
                      <table className="prod-tbl w-full">
                        <thead>
                          <tr>
                            <th>Producto</th>
                            <th className="r" style={{ width: 120 }}>
                              Disponible
                            </th>
                            <th className="r" style={{ width: 150 }}>
                              Cantidad
                            </th>
                            <th style={{ width: 42 }} />
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item) => (
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
                              <td className="r">
                                <span
                                  className="font-mono text-[12.5px]"
                                  style={{ color: "var(--n-700)" }}
                                >
                                  {item.stock_disponible} {item.unidad}
                                </span>
                              </td>
                              <td className="text-right">
                                <CantidadCtrl
                                  item={item}
                                  onChange={actualizarCantidad}
                                />
                              </td>
                              <td>
                                <BotonEliminar
                                  onClick={() => eliminarItem(item.producto_id)}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile: cards */}
                    <div className="space-y-2.5 md:hidden">
                      {items.map((item) => (
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
                                {item.referencia} · Stock:{" "}
                                {item.stock_disponible} {item.unidad}
                              </p>
                            </div>
                            <BotonEliminar
                              onClick={() => eliminarItem(item.producto_id)}
                            />
                          </div>
                          <CantidadCtrl
                            item={item}
                            onChange={actualizarCantidad}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </SectionCard>

          {/* Tipo de traspaso */}
          <SectionCard title="Tipo de traspaso">
            <select
              value={tipoTraspaso}
              onChange={(e) => setTipoTraspaso(e.target.value)}
              className="finput sans"
              aria-label="Tipo de traspaso"
            >
              {TIPOS.map((t) => (
                <option key={t.v} value={t.v}>
                  {t.label}
                </option>
              ))}
            </select>
          </SectionCard>

          {/* Observaciones */}
          <SectionCard title="Observaciones">
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Instrucciones especiales, referencia interna… (opcional)"
              rows={2}
              className="ftextarea"
            />
          </SectionCard>

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
          <span className="cart-eyebrow">Resumen del traspaso</span>
          <div
            className="flex items-center gap-2 text-[13.5px] font-medium"
            style={{ color: "var(--n-950)" }}
          >
            <span>{sedeOrigen ? sedeLabel(sedeOrigen) : "Origen"}</span>
            <ArrowRight
              className="h-3.5 w-3.5 shrink-0"
              strokeWidth={1.7}
              style={{ color: "var(--n-400)" }}
            />
            <span>{sedeDestino ? sedeLabel(sedeDestino) : "Destino"}</span>
          </div>
          <div className="text-[12px]" style={{ color: "var(--n-500)" }}>
            {totalUnidades} unidades · {items.length} productos
          </div>
          <button
            onClick={guardar}
            disabled={!puedeGuardar || guardando}
            className="btn btn-pri mt-2 w-full justify-center disabled:opacity-40"
            style={{ height: 48 }}
          >
            {guardando ? "Creando traspaso…" : "Crear traspaso"}
          </button>
        </aside>
      </div>
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function SectionCard({ title, children }) {
  return (
    <div
      className="overflow-hidden rounded-[10px] border"
      style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
    >
      <div
        className="border-b px-4 py-3"
        style={{ borderColor: "var(--n-100)", backgroundColor: "var(--n-50)" }}
      >
        <p
          className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
          style={{ color: "var(--n-500)" }}
        >
          {title}
        </p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Label({ children }) {
  return (
    <label
      className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
      style={{ color: "var(--n-500)" }}
    >
      {children}
    </label>
  );
}

function CantidadCtrl({ item, onChange }) {
  return (
    <div className="inline-flex items-center gap-1">
      <QtyBtn
        onClick={() => onChange(item.producto_id, item.cantidad_solicitada - 1)}
      >
        −
      </QtyBtn>
      <input
        type="number"
        min={1}
        max={item.stock_disponible}
        value={item.cantidad_solicitada}
        onChange={(e) => onChange(item.producto_id, e.target.value)}
        className="w-14 rounded-lg border py-1.5 text-center font-mono text-sm font-semibold outline-none"
        style={{
          borderColor: "var(--n-150)",
          color: "var(--n-950)",
          backgroundColor: "var(--n-0)",
        }}
      />
      <QtyBtn
        onClick={() => onChange(item.producto_id, item.cantidad_solicitada + 1)}
      >
        +
      </QtyBtn>
    </div>
  );
}

function QtyBtn({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-lg border text-lg font-bold transition-colors"
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

function BotonEliminar({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-lg transition-colors"
      style={{ color: "var(--n-500)" }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--dang-600)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--n-500)")}
      aria-label="Eliminar producto"
    >
      <Trash2 className="h-4 w-4" strokeWidth={1.7} />
    </button>
  );
}
