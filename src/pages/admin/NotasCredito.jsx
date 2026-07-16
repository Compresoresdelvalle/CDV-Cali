import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Wallet,
  FileText,
  ExternalLink,
  Receipt,
  CheckCircle2,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import { useFiltros } from "../../hooks/useFiltros";
import BarraFiltros from "../../components/filtros/BarraFiltros";
import AplicarNotaCreditoModal from "../../components/compras/AplicarNotaCreditoModal";

const PAGE_SIZE = 25;

/**
 * Tope del cálculo de KPIs. `notas_credito_proveedor` no tiene agregados por
 * REST, así que los totales de dinero se suman sobre las filas del filtro —
 * pero pidiendo SOLO las dos columnas numéricas, no el listado entero. Si
 * alguna vez se superara el tope, los KPIs se rotulan como parciales en vez de
 * mentir.
 */
const RESUMEN_CAP = 2000;

const COLS_BASE = `id, numero, proveedor, monto, saldo_restante, fecha, observaciones,
   garantia_compra_id`;

/**
 * "Parcialmente aplicada" = tiene al menos un consumo y todavía queda saldo.
 * Es equivalente a `0 < saldo_restante < monto`, pero esa comparación es de
 * columna contra columna y PostgREST no la sabe expresar; el `!inner` contra
 * los consumos sí, y se resuelve en el servidor. La RLS de
 * `notas_credito_consumos` es la misma de la nota (Admin/Bodeguero), así que el
 * join no esconde filas que el usuario sí podría ver.
 */
const EMBED_CONSUMOS = `, notas_credito_consumos!inner(id)`;

const OPCIONES_ESTADO = [
  { v: "con_saldo", l: "Con saldo" },
  { v: "parcial", l: "Parcialmente aplicadas" },
  { v: "agotada", l: "Agotadas" },
];

/** El estado es DERIVADO (saldo vs. consumos), no una columna: lo aplica la
 *  pantalla. Por eso el campo va con tipo propio y `useFiltros.aplicar` lo
 *  ignora, mientras el hook igual le da persistencia y chip de "filtro activo". */
function aplicarEstado(q, estado) {
  if (estado === "agotada") return q.eq("saldo_restante", 0);
  if (estado === "con_saldo" || estado === "parcial")
    return q.gt("saldo_restante", 0);
  return q;
}

/**
 * Listado de notas crédito de proveedor — F13.
 * Admin ve todas; saldo_restante > 0 destacado.
 */
export default function NotasCredito() {
  const navigate = useNavigate();
  const [notas, setNotas] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [resumen, setResumen] = useState({
    saldo: 0,
    monto: 0,
    conSaldo: 0,
    agotadas: 0,
    parcial: false,
  });
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [aplicarNota, setAplicarNota] = useState(null); // S6: nota a aplicar

  // Memoizado a propósito: `useFiltros` deriva `valoresAplicados` de esta lista
  // y un array nuevo por render la volvería inestable como dependencia del
  // efecto de carga (bucle infinito de fetch).
  const campos = useMemo(
    () => [
      {
        id: "q",
        tipo: "texto",
        label: "Buscar",
        // El # va por `numericoA`: `numero` es integer y un ilike lo revienta.
        columnas: ["proveedor", "observaciones"],
        numericoA: "numero",
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
        id: "estado",
        tipo: "derivado",
        label: "Estado",
        opciones: OPCIONES_ESTADO,
      },
    ],
    [],
  );

  const f = useFiltros({ clave: "notas-credito", campos });
  const estado = f.valoresAplicados.estado ?? "";

  const cargar = async (reset = false) => {
    const reqId = f.nuevoReqId();
    setLoading(true);
    setErrorMsg("");
    const currentPage = reset ? 0 : page;

    // Los filtros se CRUZAN: texto + fecha (del hook) y estado (derivado).
    const conFiltros = (q) => aplicarEstado(f.aplicar(q), estado);
    const embed = estado === "parcial" ? EMBED_CONSUMOS : "";

    try {
      const query = conFiltros(
        supabase
          .from("notas_credito_proveedor")
          .select(COLS_BASE + embed, { count: "exact" }),
      )
        // El segundo orden estabiliza la paginación: sin desempate, dos notas
        // con la misma fecha pueden bailar entre páginas y duplicarse.
        .order("fecha", { ascending: false })
        .order("numero", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      // KPIs de dinero sobre TODO el filtro, no sobre la página cargada.
      const queryResumen = conFiltros(
        supabase
          .from("notas_credito_proveedor")
          .select(`monto, saldo_restante${embed}`),
      ).limit(RESUMEN_CAP);

      const [res, resResumen] = await Promise.all([query, queryResumen]);
      if (!f.esReqVigente(reqId)) return; // respuesta obsoleta: descartar
      if (res.error) throw res.error;
      if (resResumen.error) throw resResumen.error;

      const conteo = res.count ?? 0;
      setTotal(conteo);
      if (reset) {
        setNotas(res.data ?? []);
        setPage(1);
      } else {
        setNotas((prev) => [...prev, ...(res.data ?? [])]);
        setPage((p) => p + 1);
      }

      const filas = resResumen.data ?? [];
      setResumen({
        saldo: filas.reduce((acc, n) => acc + Number(n.saldo_restante), 0),
        monto: filas.reduce((acc, n) => acc + Number(n.monto), 0),
        conSaldo: filas.filter((n) => Number(n.saldo_restante) > 0).length,
        agotadas: filas.filter((n) => Number(n.saldo_restante) === 0).length,
        parcial: filas.length >= RESUMEN_CAP,
      });
    } catch (err) {
      if (f.esReqVigente(reqId))
        setErrorMsg(safeError(err, "Error al cargar notas crédito"));
    } finally {
      if (f.esReqVigente(reqId)) setLoading(false);
    }
  };

  // Cada cambio de filtro recarga desde la página 0.
  useEffect(() => {
    cargar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.valoresAplicados]);

  const hayMas = notas.length < total;
  const notaCap = resumen.parcial ? ` (primeras ${RESUMEN_CAP})` : "";

  return (
    <div className="flex flex-col gap-6 px-5 pb-8 pt-6 sm:px-7 animate-fade-in">
      {/* Page head */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="m-0 mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Admin · Notas crédito
          </p>
          <h1
            className="m-0 text-[24px] font-semibold leading-tight tracking-[-0.018em]"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Notas crédito de proveedores
          </h1>
          <p
            className="mt-1 text-[13px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Saldos a favor pendientes de aplicar en próximas compras.
          </p>
        </div>
      </div>

      <BarraFiltros
        filtros={f}
        placeholder="Buscar por proveedor, # de NC u observaciones…"
      />

      {errorMsg && (
        <div
          role="alert"
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

      {/* KPI cards (estilo cockpit admin) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Saldo disponible total"
          value={loading ? "…" : formatCOP(resumen.saldo)}
          sub={`A favor con proveedores${notaCap}`}
          token="--success"
          icon={Wallet}
        />
        <Kpi
          label="Notas con saldo activo"
          value={loading ? "…" : resumen.conSaldo}
          sub={`Aplicables en compras${notaCap}`}
          icon={FileText}
        />
        <Kpi
          label="Notas agotadas"
          value={loading ? "…" : resumen.agotadas}
          sub={`Saldo consumido${notaCap}`}
          token={resumen.agotadas > 0 ? "--info" : "--muted-foreground"}
          icon={CheckCircle2}
        />
        <Kpi
          label="Monto emitido"
          value={loading ? "…" : formatCOP(resumen.monto)}
          sub={`${total} nota(s) en el filtro${notaCap}`}
          icon={Receipt}
        />
      </div>

      {loading && notas.length === 0 ? (
        <SkeletonList />
      ) : notas.length === 0 ? (
        <Empty icon="🧾">
          {f.hayFiltros
            ? "Ninguna nota crédito coincide con los filtros."
            : "Aún no hay notas crédito registradas."}
        </Empty>
      ) : (
        <section
          className="overflow-hidden rounded-[10px] border"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          {/* Desktop tabla */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr
                  className="text-left"
                  style={{
                    backgroundColor: "hsl(var(--muted) / 0.3)",
                    borderBottom: "1px solid hsl(var(--border))",
                  }}
                >
                  {["NC", "Proveedor", "Fecha", "Monto", "Saldo", ""].map(
                    (c, i) => (
                      <th
                        key={c || i}
                        className={`px-3 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] ${
                          i === 3 || i === 4 ? "text-right" : "text-left"
                        }`}
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {c}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {notas.map((n) => {
                  const tieneSaldo = Number(n.saldo_restante) > 0;
                  return (
                    <tr
                      key={n.id}
                      className="border-t"
                      style={{ borderColor: "hsl(var(--border) / 0.6)" }}
                    >
                      <td
                        className="px-3 py-3 font-mono text-[12px] font-semibold"
                        style={{ color: "hsl(var(--primary))" }}
                      >
                        NC #{n.numero}
                      </td>
                      <td className="px-3 py-3">
                        <p
                          className="text-[13px] font-medium"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {n.proveedor}
                        </p>
                        {n.observaciones && (
                          <p
                            className="text-[11px] italic"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            {n.observaciones}
                          </p>
                        )}
                      </td>
                      <td
                        className="px-3 py-3 font-mono text-[11.5px]"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {formatDate(n.fecha)}
                      </td>
                      <td
                        className="px-3 py-3 text-right font-mono text-[12px] tabular-nums"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {formatCOP(n.monto)}
                      </td>
                      <td
                        className="px-3 py-3 text-right font-mono text-[13px] font-bold tabular-nums"
                        style={{
                          color: tieneSaldo
                            ? "hsl(var(--success))"
                            : "hsl(var(--muted-foreground))",
                        }}
                      >
                        {formatCOP(n.saldo_restante)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="inline-flex items-center gap-3">
                          {tieneSaldo && (
                            <button
                              onClick={() => setAplicarNota(n)}
                              className="inline-flex h-8 items-center rounded-md border px-2.5 text-[12px] font-medium cursor-pointer"
                              style={{
                                borderColor: "hsl(var(--primary))",
                                color: "hsl(var(--primary))",
                              }}
                            >
                              Aplicar
                            </button>
                          )}
                          {n.garantia_compra_id && (
                            <button
                              onClick={() =>
                                navigate(
                                  `/ops/garantias/compra/${n.garantia_compra_id}`,
                                )
                              }
                              className="inline-flex items-center gap-1 text-[12px] font-medium cursor-pointer hover:underline"
                              style={{ color: "hsl(var(--primary))" }}
                            >
                              Garantía
                              <ExternalLink
                                className="h-3 w-3"
                                strokeWidth={1.5}
                              />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="divide-y md:hidden" role="list">
            {notas.map((n) => {
              const tieneSaldo = Number(n.saldo_restante) > 0;
              return (
                <li
                  key={n.id}
                  className="px-4 py-3.5"
                  style={{ borderColor: "hsl(var(--border))" }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p
                        className="font-mono text-sm font-bold"
                        style={{ color: "hsl(var(--primary))" }}
                      >
                        NC #{n.numero}
                      </p>
                      <p
                        className="text-sm font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {n.proveedor}
                      </p>
                      <p
                        className="text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {formatDate(n.fecha)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className="text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        Monto: {formatCOP(n.monto)}
                      </p>
                      <p
                        className="font-mono text-base font-bold tabular-nums"
                        style={{
                          color: tieneSaldo
                            ? "hsl(var(--success))"
                            : "hsl(var(--muted-foreground))",
                        }}
                      >
                        {formatCOP(n.saldo_restante)}
                      </p>
                    </div>
                  </div>
                  {n.observaciones && (
                    <p
                      className="mt-1 text-xs italic"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {n.observaciones}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {tieneSaldo && (
                      <button
                        onClick={() => setAplicarNota(n)}
                        className="inline-flex h-11 items-center rounded-lg px-3 text-xs font-medium cursor-pointer"
                        style={{
                          backgroundColor: "hsl(var(--primary))",
                          color: "hsl(var(--primary-foreground))",
                        }}
                      >
                        Aplicar a una compra
                      </button>
                    )}
                    {n.garantia_compra_id && (
                      <button
                        onClick={() =>
                          navigate(
                            `/ops/garantias/compra/${n.garantia_compra_id}`,
                          )
                        }
                        className="inline-flex h-11 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium cursor-pointer"
                        style={{
                          borderColor: "hsl(var(--border))",
                          color: "hsl(var(--primary))",
                        }}
                      >
                        Ver garantía origen
                        <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Paginación real: reemplaza el viejo .limit(200), que truncaba en
              silencio. El total sale del count exacto del servidor, no de lo
              cargado. */}
          {hayMas && (
            <div
              className="border-t px-[18px] py-3"
              style={{ borderColor: "hsl(var(--border))" }}
            >
              <button
                onClick={() => cargar(false)}
                disabled={loading}
                className="inline-flex h-12 w-full items-center justify-center rounded-lg border px-4 text-[13px] font-medium cursor-pointer disabled:opacity-60"
                style={{
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--primary))",
                }}
              >
                {loading
                  ? "Cargando…"
                  : `Cargar más (${notas.length} de ${total})`}
              </button>
            </div>
          )}

          <footer
            className="border-t px-[18px] py-3 font-mono text-[10.5px] tracking-[0.06em]"
            style={{
              borderColor: "hsl(var(--border))",
              backgroundColor: "hsl(var(--muted) / 0.3)",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            {notas.length} de {total} nota(s) · saldo total del filtro{notaCap}{" "}
            <span style={{ color: "hsl(var(--success))" }}>
              {formatCOP(resumen.saldo)}
            </span>
          </footer>
        </section>
      )}

      {aplicarNota && (
        <AplicarNotaCreditoModal
          nota={aplicarNota}
          onClose={() => setAplicarNota(null)}
          onDone={() => {
            setAplicarNota(null);
            // reset=true a propósito: aplicar una nota cambia su saldo (y puede
            // sacarla del filtro), así que se recarga desde la página 0. Un
            // cargar(false) volvería a pedir la misma página y duplicaría filas.
            cargar(true);
          }}
        />
      )}
    </div>
  );
}

/* ── KPI card (estilo cockpit admin) ──────────────────────────────────── */
function Kpi({ label, value, sub, token, icon: Icon }) {
  return (
    <div
      className="rounded-[10px] border p-4"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <div
        className="flex items-center gap-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />}
        {label}
      </div>
      <div
        className="mt-2 truncate font-mono text-[20px] font-semibold leading-tight tracking-[-0.02em] tabular-nums"
        style={{
          color: token ? `hsl(var(${token}))` : "hsl(var(--foreground))",
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="mt-0.5 text-[11px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function Empty({ icon, children }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 text-5xl">{icon}</div>
      <p style={{ color: "hsl(var(--muted-foreground))" }}>{children}</p>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-xl border"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        />
      ))}
    </div>
  );
}
