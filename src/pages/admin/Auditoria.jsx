import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { formatDate, safeError, sanitizeSearch } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";

const TIPOS = [
  "Todos",
  "venta",
  "compra",
  "traspaso_salida",
  "traspaso_entrada",
  "ajuste",
  "ensamble_consumo",
  "ensamble_produccion",
  "devolucion",
  "orden_consumo",
  "conteo_ajuste",
];
const PAGE_SIZE = 50;

export default function Auditoria() {
  const [movimientos, setMovimientos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [tipo, setTipo] = useState("Todos");
  const [sedeId, setSedeId] = useState("");
  const [usuarioId, setUsuarioId] = useState("");
  const [search, setSearch] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");

  const [sedes, setSedes] = useState([]);
  const [usuarios, setUsuarios] = useState([]);

  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const mountedRef = useRef(true);
  // Token de secuencia: descarta respuestas de carga obsoletas.
  const reqIdRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Cargar selectores
  useEffect(() => {
    Promise.all([
      supabase.from("sedes").select("id, nombre").eq("activa", true),
      supabase.from("usuarios").select("id, nombre").eq("activo", true),
    ])
      .then(([s, u]) => {
        if (!mountedRef.current) return;
        if (s.error || u.error) {
          setErrorMsg("No se pudieron cargar los filtros de sede/usuario.");
          return;
        }
        setSedes(s.data ?? []);
        setUsuarios(u.data ?? []);
      })
      .catch((err) => {
        if (mountedRef.current)
          setErrorMsg(safeError(err, "Error al cargar filtros"));
      });
  }, []);

  const cargar = async (reset = false) => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setErrorMsg("");
    const currentPage = reset ? 0 : page;
    try {
      // Si hay búsqueda, filtramos productos primero y obtenemos sus IDs
      // (búsqueda server-side, no client-side sobre la página actual)
      let productoIds = null;
      const sq = sanitizeSearch(search.trim());
      if (sq) {
        const { data: prods } = await supabase
          .from("productos")
          .select("id")
          .or(`referencia.ilike.%${sq}%,nombre.ilike.%${sq}%`)
          .limit(500);
        productoIds = (prods ?? []).map((p) => p.id);
        if (productoIds.length === 0) {
          if (!mountedRef.current || myReq !== reqIdRef.current) return;
          if (reset) {
            setMovimientos([]);
            setPage(1);
          }
          setHasMore(false);
          return;
        }
      }

      let q = supabase
        .from("movimientos")
        .select(
          `id, tipo, cantidad, stock_anterior, stock_posterior, fecha, observaciones, sede_id, producto_id,
           producto:producto_id(referencia, nombre),
           usuario:usuario_id(nombre),
           sede:sede_id(nombre)`,
        )
        .order("fecha", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (tipo !== "Todos") q = q.eq("tipo", tipo);
      if (sedeId) q = q.eq("sede_id", sedeId);
      if (usuarioId) q = q.eq("usuario_id", usuarioId);
      if (fechaDesde) q = q.gte("fecha", `${fechaDesde}T00:00:00-05:00`);
      if (fechaHasta) q = q.lte("fecha", `${fechaHasta}T23:59:59-05:00`);
      if (productoIds) q = q.in("producto_id", productoIds);

      const { data, error } = await q;
      if (!mountedRef.current || myReq !== reqIdRef.current) return;
      if (error) throw error;

      const items = data ?? [];
      if (reset) {
        setMovimientos(items);
        setPage(1);
      } else {
        setMovimientos((p) => [...p, ...items]);
        setPage((p) => p + 1);
      }
      setHasMore(items.length === PAGE_SIZE);
    } catch (err) {
      if (!mountedRef.current || myReq !== reqIdRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar movimientos"));
    } finally {
      if (mountedRef.current && myReq === reqIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    setPage(0);
    setHasMore(true);
    const t = setTimeout(() => cargar(true), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, sedeId, usuarioId, fechaDesde, fechaHasta, search]);

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Auditoría de movimientos"
        description={
          loading
            ? "Cargando…"
            : `${movimientos.length}${hasMore ? "+" : ""} registros`
        }
      />

      {errorMsg && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.4)",
            color: "hsl(var(--destructive))",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Filtros */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Select label="Tipo" value={tipo} onChange={setTipo} options={TIPOS} />
        <Select
          label="Sede"
          value={sedeId}
          onChange={setSedeId}
          options={[
            { value: "", label: "Todas" },
            ...sedes.map((s) => ({ value: s.id, label: s.nombre })),
          ]}
          objectOptions
        />
        <Select
          label="Usuario"
          value={usuarioId}
          onChange={setUsuarioId}
          options={[
            { value: "", label: "Todos" },
            ...usuarios.map((u) => ({ value: u.id, label: u.nombre })),
          ]}
          objectOptions
        />
        <Field label="Buscar producto">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nombre o referencia"
            className="w-full h-10 px-3 rounded-lg border text-sm"
            style={inputStyle}
          />
        </Field>
        <Field label="Desde">
          <input
            type="date"
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border text-sm"
            style={inputStyle}
          />
        </Field>
        <Field label="Hasta">
          <input
            type="date"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border text-sm"
            style={inputStyle}
          />
        </Field>
        <button
          onClick={() => {
            setTipo("Todos");
            setSedeId("");
            setUsuarioId("");
            setSearch("");
            setFechaDesde("");
            setFechaHasta("");
          }}
          className="h-10 px-3 rounded-lg text-sm font-medium border cursor-pointer self-end"
          style={{
            borderColor: "hsl(var(--border))",
            color: "hsl(var(--muted-foreground))",
          }}
        >
          Limpiar filtros
        </button>
      </div>

      {/* Tabla desktop */}
      <div
        className="hidden md:block overflow-x-auto rounded-xl border"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <table className="w-full border-collapse">
          <thead>
            <tr
              style={{
                backgroundColor: "hsl(var(--muted) / 0.4)",
                borderBottom: "1px solid hsl(var(--border))",
              }}
            >
              {[
                "Fecha",
                "Tipo",
                "Producto",
                "Cantidad",
                "Stock antes",
                "Stock después",
                "Sede",
                "Usuario",
              ].map((c) => (
                <th
                  key={c}
                  className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-left"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {movimientos.map((m, idx) => (
              <tr
                key={m.id}
                style={{
                  borderTop:
                    idx === 0 ? "none" : "1px solid hsl(var(--border) / 0.5)",
                }}
              >
                <td
                  className="px-3 py-2 text-xs"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {formatDate(m.fecha)}
                </td>
                <td className="px-3 py-2">
                  <TipoBadge tipo={m.tipo} />
                </td>
                <td className="px-3 py-2">
                  <p
                    className="text-sm font-medium truncate max-w-[200px]"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {m.producto?.nombre}
                  </p>
                  <p
                    className="text-xs font-mono"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {m.producto?.referencia}
                  </p>
                </td>
                <td
                  className="px-3 py-2 text-sm font-bold tabular-nums"
                  style={{
                    color:
                      m.cantidad > 0
                        ? "hsl(var(--success))"
                        : "hsl(var(--destructive))",
                  }}
                >
                  {m.cantidad > 0 ? "+" : ""}
                  {m.cantidad}
                </td>
                <td
                  className="px-3 py-2 text-xs tabular-nums"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {m.stock_anterior}
                </td>
                <td
                  className="px-3 py-2 text-xs font-medium tabular-nums"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {m.stock_posterior}
                </td>
                <td
                  className="px-3 py-2 text-xs"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {m.sede?.nombre ?? m.sede_id}
                </td>
                <td
                  className="px-3 py-2 text-xs"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {m.usuario?.nombre}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {movimientos.length === 0 && !loading && (
          <p
            className="text-center py-8 text-sm"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Sin movimientos con esos filtros
          </p>
        )}
      </div>

      {/* Mobile cards */}
      <ul className="md:hidden space-y-2" role="list">
        {movimientos.map((m) => (
          <li
            key={m.id}
            className="rounded-lg border p-3"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
            }}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <TipoBadge tipo={m.tipo} />
              <p
                className="text-sm font-bold tabular-nums"
                style={{
                  color:
                    m.cantidad > 0
                      ? "hsl(var(--success))"
                      : "hsl(var(--destructive))",
                }}
              >
                {m.cantidad > 0 ? "+" : ""}
                {m.cantidad}
              </p>
            </div>
            <p
              className="text-sm font-medium truncate"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {m.producto?.nombre}
            </p>
            <p
              className="text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {formatDate(m.fecha)} · {m.usuario?.nombre} ·{" "}
              {m.sede?.nombre ?? m.sede_id}
            </p>
            <p
              className="text-xs mt-0.5"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Stock: {m.stock_anterior} → {m.stock_posterior}
            </p>
          </li>
        ))}
      </ul>

      {hasMore && !loading && (
        <button
          onClick={() => cargar(false)}
          className="w-full py-3 rounded-xl text-sm font-medium border cursor-pointer"
          style={{
            borderColor: "hsl(var(--border))",
            color: "hsl(var(--muted-foreground))",
          }}
        >
          Cargar más
        </button>
      )}
    </div>
  );
}

const inputStyle = {
  backgroundColor: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
  color: "hsl(var(--foreground))",
};

function Field({ label, children }) {
  return (
    <label className="block">
      <span
        className="block text-xs font-medium mb-1"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Select({ label, value, onChange, options, objectOptions }) {
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-10 px-3 rounded-lg border text-sm"
        style={inputStyle}
      >
        {options.map((o, i) =>
          objectOptions ? (
            <option key={o.value || i} value={o.value}>
              {o.label}
            </option>
          ) : (
            <option key={o} value={o}>
              {o}
            </option>
          ),
        )}
      </select>
    </Field>
  );
}

function TipoBadge({ tipo }) {
  const isOut = [
    "venta",
    "traspaso_salida",
    "ensamble_consumo",
    "orden_consumo",
  ].includes(tipo);
  const isIn = [
    "compra",
    "traspaso_entrada",
    "devolucion",
    "ensamble_produccion",
  ].includes(tipo);
  const color = isOut
    ? "destructive"
    : isIn
      ? "success"
      : tipo === "ajuste" || tipo === "conteo_ajuste"
        ? "warning"
        : "muted";
  return (
    <span
      className="px-2 py-0.5 rounded text-xs font-medium font-mono"
      style={{
        backgroundColor: `hsl(var(--${color}) / 0.15)`,
        color: `hsl(var(--${color}))`,
      }}
    >
      {tipo}
    </span>
  );
}
