import { useState, useEffect, useMemo } from "react";
import { useFiltros } from "../../../hooks/useFiltros";
import BarraFiltros from "../../../components/filtros/BarraFiltros";
import { useNavigate } from "react-router-dom";
import { Search, ShieldCheck, ShieldAlert, X } from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { formatDate, formatCOP, safeError } from "../../../lib/utils";
import {
  tabsGarantiasPorRol,
  ESTADOS_GARANTIA_COMPRA,
  ESTADOS_GARANTIA_VENTA,
  garantiaEstadoLabel,
  garantiaEstadoPillClass,
  resolucionPillClass,
  resolucionLabel,
} from "../../../lib/garantias-ui";
import { useAuthStore } from "../../../stores/authStore";

/**
 * Listado de garantías — F13 (re-vestido con diseño Lovable).
 * Dos tabs: Compras (al proveedor) y Ventas (cliente reclama).
 * Lógica de datos intacta: queries server-authoritative + RLS por sede.
 */
// Valores REALES de los enums (verificados en producción). OJO: la resolución
// NO comparte enum entre tabs — son dos tipos distintos, así que el filtro se
// arma por tab o se ofrecerían opciones que la consulta rechaza.
const RESOLUCION_OPCIONES = {
  compra: [
    { v: "nota_credito", l: "Nota crédito" },
    { v: "reposicion_fisica", l: "Reposición física" },
    { v: "pendiente", l: "Pendiente" },
  ],
  venta: [
    { v: "cambiar_pieza", l: "Cambiar pieza" },
    { v: "devolver_dinero", l: "Devolver dinero" },
    { v: "arreglar_producto", l: "Arreglar producto" },
  ],
};

/**
 * Listado de garantías — F13 (re-vestido con diseño Lovable).
 * Dos tabs: Compras (al proveedor) y Ventas (cliente reclama).
 * Lógica de datos intacta: queries server-authoritative + RLS por sede.
 */
export default function GarantiasIndex() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  // Solo las pestañas cuyo detalle puede abrir este rol (ver tabsGarantiasPorRol).
  const tabsVisibles = useMemo(
    () => tabsGarantiasPorRol(perfil?.rol),
    [perfil?.rol],
  );
  // La pestaña inicial debe ser una permitida: al Técnico, cuyo detalle de
  // compra está vetado, no puede arrancarle "compra" por defecto.
  const [tab, setTab] = useState(() => tabsGarantiasPorRol(perfil?.rol)[0].v);

  // Si el perfil carga después del primer render, corregir la pestaña activa.
  useEffect(() => {
    if (!tabsVisibles.some((t) => t.v === tab)) setTab(tabsVisibles[0].v);
  }, [tabsVisibles, tab]);
  const [filtroEstado, setFiltroEstado] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  // Filtros reales y cruzables (fecha + resolución + texto a la vez).
  const campos = useMemo(
    () => [
      {
        id: "q",
        tipo: "texto",
        label: "Buscar",
        // A propósito SIN `columnas`/`numericoA`: el texto se resuelve en
        // memoria (ver `filtrados`). El nombre del proveedor/cliente vive en un
        // join, así que no se puede cruzar server-side con un simple ilike; y
        // si el servidor filtrara por `motivo` mientras el cliente filtra por
        // nombre, los dos se cruzarían con AND y se perderían filas que el
        // servidor devolvió bien. Con 0 garantías de compra y 9 de venta, el
        // tope de 200 no se alcanza y la búsqueda en memoria no miente.
        // Si esta tabla crece, hay que pasarla a un filtro embebido de
        // PostgREST o a una RPC.
        debounce: 400,
      },
      {
        id: "rango",
        tipo: "fecha",
        label: "Fecha",
        columna: "fecha",
        presets: ["hoy", "semana", "mes", "mesPasado"],
      },
      {
        id: "resolucion",
        tipo: "opciones",
        label: "Resolución",
        columna: "resolucion",
        opciones: RESOLUCION_OPCIONES[tab],
      },
    ],
    [tab],
  );

  const f = useFiltros({ clave: `garantias-${tab}`, campos });
  const busqueda = f.valoresAplicados.q ?? "";

  useEffect(() => {
    const cargar = async () => {
      const myReq = f.nuevoReqId();
      setLoading(true);
      setErrorMsg("");
      try {
        const tabla = tab === "compra" ? "garantias_compra" : "garantias_venta";
        const cols =
          tab === "compra"
            ? `id, numero, fecha, resolucion, estado, motivo,
               compra:compra_id(numero, proveedor)`
            : `id, numero, fecha, resolucion, estado, motivo, monto_devuelto,
               venta:venta_id(numero, cliente_nombre),
               orden:orden_servicio_id(numero, cliente_nombre),
               ot_reparacion:ot_reparacion_id(numero)`;

        let q = supabase.from(tabla).select(cols);
        if (filtroEstado) q = q.eq("estado", filtroEstado);
        // Fecha, resolución y #número/motivo se resuelven en el SERVIDOR.
        q = f.aplicar(q);
        q = q
          // Desempate: sin él, dos garantías de la misma fecha pueden
          // reordenarse entre cargas.
          .order("fecha", { ascending: false })
          .order("numero", { ascending: false })
          .limit(200);

        const { data, error } = await q;
        if (!f.esReqVigente(myReq)) return; // respuesta obsoleta
        if (error) throw error;
        setItems(data ?? []);
      } catch (err) {
        if (f.esReqVigente(myReq))
          setErrorMsg(safeError(err, "Error al cargar garantías"));
      } finally {
        if (f.esReqVigente(myReq)) setLoading(false);
      }
    };
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filtroEstado, f.valoresAplicados]);

  // Búsqueda client-side sobre las filas cargadas (presentación, sin tocar
  // la query server-authoritative). El listado se acota a 200 registros.
  const filtrados = useMemo(() => {
    const needle = busqueda.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((g) => {
      const num = String(g.numero ?? "");
      const nombre =
        tab === "compra"
          ? (g.compra?.proveedor ?? "")
          : (g.venta?.cliente_nombre ?? g.orden?.cliente_nombre ?? "");
      // Se busca contra la etiqueta visible ("Devolver dinero") y también
      // contra el valor crudo ("devolver_dinero"): antes solo miraba el crudo,
      // así que escribir lo que se ve en pantalla no encontraba nada.
      const reso = g.resolucion ?? "";
      const resoLabel = resolucionLabel(g.resolucion);
      return (
        num.includes(needle) ||
        nombre.toLowerCase().includes(needle) ||
        reso.toLowerCase().includes(needle) ||
        resoLabel.toLowerCase().includes(needle)
      );
    });
  }, [items, busqueda, tab]);

  const estados =
    tab === "compra" ? ESTADOS_GARANTIA_COMPRA : ESTADOS_GARANTIA_VENTA;

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-[18px] px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ color: "var(--n-300)" }}
          >
            Operaciones · Post-venta ·{" "}
            {loading ? "cargando…" : `${filtrados.length} registros`}
          </p>
          <h1
            className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.018em]"
            style={{ color: "var(--n-950)" }}
          >
            Garantías
          </h1>
          <p className="mt-1.5 text-[13px]" style={{ color: "var(--n-500)" }}>
            Devoluciones a proveedores y reclamos de clientes.
          </p>
        </div>
      </div>

      {/* ── Tabs duales ─────────────────────────────────────────────── */}
      <div
        className="flex max-w-[560px] items-end border-b"
        style={{ borderColor: "var(--n-150)" }}
      >
        {tabsVisibles.map((t) => {
          const active = tab === t.v;
          const Icon = t.v === "venta" ? ShieldCheck : ShieldAlert;
          return (
            <button
              key={t.v}
              onClick={() => {
                setTab(t.v);
                setFiltroEstado("");
              }}
              className="relative -mb-px flex flex-1 items-center justify-center gap-2 border-b-2 px-4 text-[13px] transition-colors"
              style={{
                minHeight: 48,
                borderColor: active ? "var(--p-600)" : "transparent",
                backgroundColor: active ? "var(--p-50)" : "transparent",
                color: active ? "var(--p-700)" : "var(--n-500)",
                fontWeight: active ? 600 : 500,
              }}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span className="flex flex-col items-start gap-px leading-tight">
                <span>{t.label}</span>
                <span
                  className="text-[10.5px] font-normal"
                  style={{ color: active ? "var(--p-700)" : "var(--n-500)" }}
                >
                  {t.sub}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Sub-filtros de estado ───────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        <FiltroChip
          on={!filtroEstado}
          onClick={() => setFiltroEstado("")}
          label="Todos"
        />
        {estados.map((e) => (
          <FiltroChip
            key={e}
            on={filtroEstado === e}
            onClick={() => setFiltroEstado(filtroEstado === e ? "" : e)}
            label={garantiaEstadoLabel(e)}
          />
        ))}
      </div>

      {/* ── Filtros reales (fecha y resolución en el servidor) ──────── */}
      <BarraFiltros
        filtros={f}
        legacy
        placeholder={
          tab === "compra"
            ? "Buscar por número, proveedor o resolución…"
            : "Buscar por número, cliente o resolución…"
        }
      />

      {errorMsg && (
        <div
          role="alert"
          className="rounded-[10px] border px-4 py-3 text-sm"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
            color: "var(--dang-700)",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* ── Contenido ───────────────────────────────────────────────── */}
      {loading ? (
        <SkeletonList />
      ) : filtrados.length === 0 ? (
        <EmptyState busqueda={busqueda} filtroEstado={filtroEstado} />
      ) : (
        <>
          {/* Móvil/Tablet: cards (< md) */}
          <ul className="md:hidden space-y-2.5" role="list">
            {filtrados.map((g) => (
              <li key={g.id}>
                <GarantiaCard
                  g={g}
                  tab={tab}
                  onClick={() => navigate(`/ops/garantias/${tab}/${g.id}`)}
                />
              </li>
            ))}
          </ul>

          {/* Desktop: tabla (≥ md) */}
          <div
            className="hidden md:block min-w-0 overflow-hidden rounded-[10px] border"
            style={{
              borderColor: "var(--n-150)",
              backgroundColor: "var(--n-0)",
            }}
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <Th width={110}>#</Th>
                    <Th width={110}>Fecha</Th>
                    <Th>{tab === "compra" ? "Proveedor" : "Cliente"}</Th>
                    <Th width={150}>
                      {tab === "compra" ? "Compra origen" : "Origen"}
                    </Th>
                    <Th width={150}>Resolución</Th>
                    {tab === "venta" && (
                      <Th width={130} right>
                        Monto dev.
                      </Th>
                    )}
                    <Th width={180}>Estado</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((g) => (
                    <GarantiaFila
                      key={g.id}
                      g={g}
                      tab={tab}
                      onClick={() => navigate(`/ops/garantias/${tab}/${g.id}`)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div
              className="flex items-center justify-between border-t px-5 py-3.5 text-xs"
              style={{
                borderColor: "var(--n-100)",
                backgroundColor: "var(--n-50)",
                color: "var(--n-500)",
              }}
            >
              <span>
                Mostrando{" "}
                <strong className="font-mono" style={{ color: "var(--n-950)" }}>
                  {filtrados.length}
                </strong>{" "}
                garantías de {tab === "compra" ? "compras" : "ventas"}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function FiltroChip({ on, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border px-3 py-1 text-[12px] font-medium transition-colors"
      style={{
        borderColor: on ? "var(--n-900)" : "var(--n-200)",
        backgroundColor: on ? "var(--n-900)" : "var(--n-0)",
        color: on ? "var(--n-0)" : "var(--n-700)",
      }}
      onMouseEnter={(e) => {
        if (!on) e.currentTarget.style.backgroundColor = "var(--n-50)";
      }}
      onMouseLeave={(e) => {
        if (!on) e.currentTarget.style.backgroundColor = "var(--n-0)";
      }}
    >
      {label}
    </button>
  );
}

function Th({ children, width, right }) {
  return (
    <th
      style={{ width, backgroundColor: "var(--n-50)", color: "var(--n-500)" }}
      className={
        "whitespace-nowrap border-b px-3 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] " +
        (right ? "text-right" : "text-left")
      }
    >
      {children}
    </th>
  );
}

function Td({ children, right }) {
  return (
    <td
      className={
        "border-b px-3 py-2.5 align-top text-[13px] " +
        (right ? "text-right" : "")
      }
      style={{ borderColor: "var(--n-100)", color: "var(--n-700)" }}
    >
      {children}
    </td>
  );
}

function nombreOrigen(g, tab) {
  if (tab === "compra") return g.compra?.proveedor ?? "—";
  return g.venta?.cliente_nombre ?? g.orden?.cliente_nombre ?? "—";
}

function origenPill(g, tab) {
  if (tab === "compra") {
    return g.compra ? `Compra #${g.compra.numero}` : "—";
  }
  if (g.venta) return `Venta #${g.venta.numero}`;
  if (g.orden) return `OT #${g.orden.numero}`;
  return "—";
}

function GarantiaFila({ g, tab, onClick }) {
  return (
    <tr
      onClick={onClick}
      className="cursor-pointer transition-colors"
      onMouseEnter={(e) =>
        (e.currentTarget.style.backgroundColor = "var(--n-50)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
    >
      <Td>
        <span
          className="font-mono text-[12.5px] font-medium"
          style={{ color: "var(--n-950)" }}
        >
          #{g.numero}
        </span>
      </Td>
      <Td>
        <span
          className="font-mono text-[11.5px]"
          style={{ color: "var(--n-500)" }}
        >
          {formatDate(g.fecha)}
        </span>
      </Td>
      <Td>
        <span className="font-medium" style={{ color: "var(--n-950)" }}>
          {nombreOrigen(g, tab)}
        </span>
      </Td>
      <Td>
        <span className="link-pill">{origenPill(g, tab)}</span>
      </Td>
      <Td>
        <span className={resolucionPillClass(g.resolucion)}>
          <span className="dot" />
          {resolucionLabel(g.resolucion)}
        </span>
      </Td>
      {tab === "venta" && (
        <Td right>
          <span
            className="font-mono text-[13px] font-medium"
            style={{ color: "var(--n-950)" }}
          >
            {g.monto_devuelto != null ? formatCOP(g.monto_devuelto) : "—"}
          </span>
        </Td>
      )}
      <Td>
        <span className={garantiaEstadoPillClass(g.estado)}>
          <span className="dot" />
          {garantiaEstadoLabel(g.estado)}
        </span>
      </Td>
    </tr>
  );
}

function GarantiaCard({ g, tab, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-[10px] border px-4 py-3.5 text-left shadow-sm transition-all duration-100 active:scale-[0.985] active:shadow-none"
      style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className="font-mono text-[13px] font-semibold"
            style={{ color: "var(--p-700)" }}
          >
            #{g.numero}
          </p>
          <p
            className="mt-0.5 truncate text-[14px] font-medium"
            style={{ color: "var(--n-950)" }}
          >
            {nombreOrigen(g, tab)}
          </p>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--n-500)" }}>
            {origenPill(g, tab)} · {resolucionLabel(g.resolucion)} ·{" "}
            {formatDate(g.fecha)}
          </p>
          {tab === "venta" && g.monto_devuelto != null && (
            <p
              className="mt-1 font-mono text-[13px] font-semibold"
              style={{ color: "var(--n-950)" }}
            >
              {formatCOP(g.monto_devuelto)}
            </p>
          )}
        </div>
        <span className={garantiaEstadoPillClass(g.estado)}>
          <span className="dot" />
          {garantiaEstadoLabel(g.estado)}
        </span>
      </div>
    </button>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-2.5">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-[10px] border"
          style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
        />
      ))}
    </div>
  );
}

function EmptyState({ busqueda, filtroEstado }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
      <div
        className="mb-4 grid h-14 w-14 place-items-center rounded-[12px]"
        style={{ backgroundColor: "var(--p-50)", color: "var(--p-600)" }}
      >
        <ShieldCheck className="h-7 w-7" strokeWidth={1.5} />
      </div>
      <p className="font-semibold" style={{ color: "var(--n-950)" }}>
        Sin garantías
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--n-500)" }}>
        {busqueda
          ? `No se encontraron garantías para "${busqueda}"`
          : filtroEstado
            ? `No hay garantías en estado ${filtroEstado}`
            : "Aún no hay garantías registradas"}
      </p>
    </div>
  );
}
