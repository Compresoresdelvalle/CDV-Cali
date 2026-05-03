import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { sanitizeSearch, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";

const SEDES = [
  { id: "BOD-PRINCIPAL", label: "Bodega Principal" },
  { id: "ALM-01", label: "Almacén 01" },
  { id: "ALM-02", label: "Almacén 02" },
  { id: "ALM-03", label: "Almacén 03" },
];

const inputStyle = {
  backgroundColor: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
  color: "hsl(var(--foreground))",
};

function SectionCard({ title, children }) {
  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <div
        className="px-4 py-3 border-b"
        style={{
          borderColor: "hsl(var(--border))",
          backgroundColor: "hsl(var(--muted) / 0.3)",
        }}
      >
        <p
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {title}
        </p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function TraspasoNuevo() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";

  // Sede origen: Admin puede elegir, el resto usa su sede
  const [sedeOrigen, setSedeOrigen] = useState(esAdmin ? "" : perfil.sede_id);
  const [sedeDestino, setSedeDestino] = useState("");
  const [observaciones, setObservaciones] = useState("");

  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [items, setItems] = useState([]);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const buscarProductos = useCallback(
    async (q) => {
      if (!q || q.trim().length < 2 || !sedeOrigen) {
        setResultados([]);
        return;
      }
      setBuscando(true);
      try {
        const safe = sanitizeSearch(q.trim());
        const { data: prods } = await supabase
          .from("productos")
          .select("id, nombre, referencia, unidad_medida")
          .eq("activo", true)
          .or(`nombre.ilike.%${safe}%,referencia.ilike.%${safe}%`)
          .limit(8);

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

  const buscarDebounced = useDebouncedCallback(buscarProductos, 300);

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
    setError(null);
    setGuardando(true);
    try {
      // 1. Crear cabecera del traspaso
      const { data: traspaso, error: e1 } = await supabase
        .from("traspasos")
        .insert({
          sede_origen_id: sedeOrigen,
          sede_destino_id: sedeDestino,
          solicitado_por: perfil.id,
          observaciones: observaciones.trim() || null,
          estado: "borrador",
        })
        .select("id, numero")
        .single();
      if (e1) throw new Error(e1.message);

      // 2. Insertar detalle
      const { error: e2 } = await supabase.from("detalle_traspaso").insert(
        items.map((i) => ({
          traspaso_id: traspaso.id,
          producto_id: i.producto_id,
          cantidad_solicitada: i.cantidad_solicitada,
          cantidad_enviada: 0,
          cantidad_recibida: 0,
          picking_completado: false,
        })),
      );
      if (e2) throw new Error(e2.message);

      navigate(`/ops/traspasos/${traspaso.id}`);
    } catch (e) {
      setError(safeError(e, "Error al crear el traspaso"));
    } finally {
      setGuardando(false);
    }
  };

  const sedesDestino = SEDES.filter((s) => s.id !== sedeOrigen);

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Nuevo Traspaso"
        description="Solicitud de movimiento entre sedes"
        actions={
          <button
            onClick={() => navigate("/ops/traspasos")}
            className="h-9 px-3 rounded-lg border text-sm font-medium cursor-pointer"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
              backgroundColor: "hsl(var(--card))",
            }}
          >
            Cancelar
          </button>
        }
      />

      {/* Error global */}
      {error && (
        <div
          className="p-3 rounded-lg border text-sm font-medium"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.3)",
            color: "hsl(var(--destructive))",
          }}
        >
          {error}
        </div>
      )}

      {/* Sedes */}
      <SectionCard title="Sedes">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Sede origen
            </label>
            {esAdmin ? (
              <select
                value={sedeOrigen}
                onChange={(e) => {
                  setSedeOrigen(e.target.value);
                  setItems([]);
                  setBusqueda("");
                  setResultados([]);
                }}
                className="w-full h-10 px-3 rounded-lg border text-sm focus:outline-none"
                style={inputStyle}
              >
                <option value="">Seleccionar sede…</option>
                {SEDES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            ) : (
              <div
                className="h-10 px-3 flex items-center rounded-lg border text-sm font-medium"
                style={{
                  ...inputStyle,
                  backgroundColor: "hsl(var(--muted) / 0.3)",
                }}
              >
                {SEDES.find((s) => s.id === sedeOrigen)?.label ?? sedeOrigen}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Sede destino
            </label>
            <select
              value={sedeDestino}
              onChange={(e) => setSedeDestino(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border text-sm focus:outline-none cursor-pointer"
              style={inputStyle}
            >
              <option value="">Seleccionar sede…</option>
              {sedesDestino.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </SectionCard>

      {/* Buscar productos */}
      <SectionCard title="Agregar productos">
        <div className="space-y-3">
          {!sedeOrigen && (
            <p
              className="text-sm"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Selecciona la sede de origen para buscar productos disponibles.
            </p>
          )}
          {sedeOrigen && (
            <>
              <div className="relative">
                <SearchIcon />
                <input
                  type="text"
                  placeholder="Buscar por nombre o referencia…"
                  value={busqueda}
                  onChange={(e) => {
                    setBusqueda(e.target.value);
                    buscarDebounced(e.target.value);
                  }}
                  className="w-full pl-9 pr-4 h-10 rounded-lg border text-sm focus:outline-none"
                  style={inputStyle}
                />
              </div>

              {/* Resultados de búsqueda */}
              {(buscando || resultados.length > 0) && (
                <div
                  className="rounded-lg border overflow-hidden"
                  style={{ borderColor: "hsl(var(--border))" }}
                >
                  {buscando && (
                    <div
                      className="px-4 py-3 text-sm"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      Buscando…
                    </div>
                  )}
                  {resultados.map((p, idx) => (
                    <button
                      key={p.id}
                      onClick={() => agregarItem(p)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors cursor-pointer"
                      style={{
                        borderTop:
                          idx > 0
                            ? "1px solid hsl(var(--border) / 0.5)"
                            : "none",
                        backgroundColor: "hsl(var(--card))",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          "hsl(var(--muted) / 0.4)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          "hsl(var(--card))")
                      }
                    >
                      <div>
                        <p
                          className="text-sm font-medium"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {p.nombre}
                        </p>
                        <p
                          className="text-xs"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {p.referencia}
                        </p>
                      </div>
                      <span
                        className="text-xs font-semibold tabular-nums"
                        style={{ color: "hsl(var(--success))" }}
                      >
                        {p.stock} disp.
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </SectionCard>

      {/* Tabla de items */}
      {items.length > 0 && (
        <SectionCard title={`Productos (${items.length})`}>
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.producto_id}
                className="flex items-center gap-3 p-3 rounded-lg border"
                style={{
                  backgroundColor: "hsl(var(--muted) / 0.2)",
                  borderColor: "hsl(var(--border))",
                }}
              >
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium truncate"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {item.nombre}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {item.referencia} · Stock: {item.stock_disponible}{" "}
                    {item.unidad}
                  </p>
                </div>

                {/* Cantidad */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() =>
                      actualizarCantidad(
                        item.producto_id,
                        item.cantidad_solicitada - 1,
                      )
                    }
                    className="w-8 h-8 rounded-lg border flex items-center justify-center text-sm font-bold cursor-pointer"
                    style={{
                      borderColor: "hsl(var(--border))",
                      color: "hsl(var(--foreground))",
                      backgroundColor: "hsl(var(--card))",
                    }}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={item.stock_disponible}
                    value={item.cantidad_solicitada}
                    onChange={(e) =>
                      actualizarCantidad(item.producto_id, e.target.value)
                    }
                    className="w-14 h-8 text-center rounded-lg border text-sm font-semibold focus:outline-none tabular-nums"
                    style={inputStyle}
                  />
                  <button
                    onClick={() =>
                      actualizarCantidad(
                        item.producto_id,
                        item.cantidad_solicitada + 1,
                      )
                    }
                    className="w-8 h-8 rounded-lg border flex items-center justify-center text-sm font-bold cursor-pointer"
                    style={{
                      borderColor: "hsl(var(--border))",
                      color: "hsl(var(--foreground))",
                      backgroundColor: "hsl(var(--card))",
                    }}
                  >
                    +
                  </button>
                </div>

                {/* Eliminar */}
                <button
                  onClick={() => eliminarItem(item.producto_id)}
                  className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-colors"
                  style={{ color: "hsl(var(--destructive))" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor =
                      "hsl(var(--destructive) / 0.1)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "")
                  }
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Observaciones */}
      <SectionCard title="Observaciones (opcional)">
        <textarea
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          rows={3}
          placeholder="Instrucciones especiales, referencia interna…"
          className="w-full px-3 py-2 rounded-lg border text-sm resize-none focus:outline-none"
          style={inputStyle}
        />
      </SectionCard>

      {/* Crear */}
      <button
        onClick={guardar}
        disabled={guardando || items.length === 0 || !sedeDestino}
        className="w-full h-12 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-40 cursor-pointer"
        style={{
          backgroundColor: "hsl(var(--primary))",
          color: "hsl(var(--primary-foreground))",
        }}
        onMouseEnter={(e) =>
          !guardando && (e.currentTarget.style.opacity = "0.9")
        }
        onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
      >
        {guardando ? "Creando traspaso…" : "Crear traspaso"}
      </button>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ color: "hsl(var(--muted-foreground))" }}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}
