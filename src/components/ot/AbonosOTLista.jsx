import { useNavigate } from "react-router-dom";
import { formatCOP } from "../../lib/utils";
import { horaBogota } from "../../lib/abonos-ot";
import { SEDE_LABEL } from "../../lib/ot-flujo";

/**
 * Lista de abonos de OT (solo lectura). Desktop tabla / móvil tarjetas.
 *
 * Una fila por ABONO, no por OT: si una OT recibió dos pagos el mismo día con
 * métodos distintos, cada uno tiene que verse con su método para poder cuadrar
 * caja. El número de OT abre la orden.
 *
 * @param {object}  p
 * @param {object|null} p.resumen  salida de `resumenAbonos`
 * @param {boolean} p.cargando
 * @param {string}  p.error
 * @param {boolean} [p.mostrarRegistrador] columna "Registró"
 * @param {boolean} [p.mostrarSede]        columna "Sede" (vistas de todas las sedes)
 * @param {string}  [p.vacio]              texto cuando no hay abonos
 */
export default function AbonosOTLista({
  resumen,
  cargando,
  error,
  mostrarRegistrador = false,
  mostrarSede = false,
  vacio = "No entraron abonos de OT en este periodo.",
}) {
  const navigate = useNavigate();
  const abrir = (id) => navigate(`/ops/ordenes/${id}`);

  if (error) {
    return (
      <p
        role="alert"
        className="rounded-lg border px-3 py-2 text-sm"
        style={{
          backgroundColor: "hsl(var(--destructive) / 0.08)",
          borderColor: "hsl(var(--destructive) / 0.3)",
          color: "hsl(var(--destructive))",
        }}
      >
        {error}
      </p>
    );
  }
  if (cargando && !resumen) {
    return (
      <div
        className="h-16 animate-pulse rounded-lg"
        style={{ backgroundColor: "hsl(var(--muted) / 0.4)" }}
      />
    );
  }
  if (!resumen || resumen.filas.length === 0) {
    return (
      <p
        className="py-3 text-center text-sm"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {vacio}
      </p>
    );
  }

  const hayCanceladas = resumen.filas.some((f) => f.cancelada);

  return (
    <div className="space-y-3">
      {/* Resumen: total y reparto por método */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p
          className="text-sm font-semibold"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {formatCOP(resumen.total)}
          <span
            className="ml-1.5 text-xs font-normal"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            en {resumen.filas.length}{" "}
            {resumen.filas.length === 1 ? "abono" : "abonos"} de{" "}
            {resumen.nOrdenes} OT
          </span>
        </p>
        {resumen.porMetodo.map((m) => (
          <span
            key={m.metodo}
            className="text-xs"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {m.metodo}: <b>{formatCOP(m.total)}</b>
          </span>
        ))}
      </div>

      {/* Móvil: tarjetas */}
      <ul className="md:hidden space-y-2" role="list">
        {resumen.filas.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => abrir(f.ordenId)}
              className="w-full text-left rounded-xl px-4 py-3 border"
              style={{
                minHeight: 48,
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className="text-sm font-semibold"
                    style={{ color: "hsl(var(--primary))" }}
                  >
                    OT #{f.numero}
                    {f.cancelada && <Cancelada />}
                  </p>
                  <p
                    className="truncate text-sm"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {f.cliente}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {f.metodo}
                    {f.cuenta ? ` · ${f.cuenta}` : ""} · {horaBogota(f.fecha)}
                    {mostrarSede && f.sedeId
                      ? ` · ${SEDE_LABEL[f.sedeId] ?? f.sedeId}`
                      : ""}
                    {mostrarRegistrador ? ` · registró ${f.registradoPor}` : ""}
                  </p>
                </div>
                <p
                  className="shrink-0 text-sm font-semibold tabular-nums"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {formatCOP(f.monto)}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {/* Desktop: tabla */}
      <div
        className="hidden md:block overflow-x-auto rounded-xl border"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: "hsl(var(--muted) / 0.3)" }}>
              <Th>OT</Th>
              <Th>Cliente</Th>
              {mostrarSede && <Th>Sede</Th>}
              <Th>Hora</Th>
              <Th>Método</Th>
              {mostrarRegistrador && <Th>Registró</Th>}
              <Th right>Monto</Th>
            </tr>
          </thead>
          <tbody>
            {resumen.filas.map((f) => (
              <tr key={f.id}>
                <Td>
                  <button
                    type="button"
                    onClick={() => abrir(f.ordenId)}
                    className="rounded-md px-2 font-semibold underline-offset-2"
                    style={{
                      minHeight: 40,
                      color: "hsl(var(--primary))",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor =
                        "hsl(var(--muted) / 0.5)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "")
                    }
                    title="Abrir la orden"
                  >
                    #{f.numero}
                  </button>
                  {f.cancelada && <Cancelada />}
                </Td>
                <Td>{f.cliente}</Td>
                {mostrarSede && <Td>{SEDE_LABEL[f.sedeId] ?? f.sedeId}</Td>}
                <Td>{horaBogota(f.fecha)}</Td>
                <Td>
                  {f.metodo}
                  {f.cuenta ? ` · ${f.cuenta}` : ""}
                </Td>
                {mostrarRegistrador && <Td>{f.registradoPor}</Td>}
                <Td right>{formatCOP(f.monto)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hayCanceladas && (
        <p
          className="text-xs"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Los abonos de una OT cancelada se muestran porque se recibieron, pero
          el cierre no los cuenta. Lo que cuenta el cierre de esta lista:{" "}
          <b>{formatCOP(resumen.totalCuentaCierre)}</b>.
        </p>
      )}
    </div>
  );
}

function Cancelada() {
  return (
    <span
      className="ml-1.5 inline-flex rounded px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide"
      style={{
        backgroundColor: "hsl(var(--destructive) / 0.1)",
        color: "hsl(var(--destructive))",
      }}
    >
      Cancelada
    </span>
  );
}

function Th({ children, right }) {
  return (
    <th
      className={`whitespace-nowrap border-b px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide ${
        right ? "text-right" : "text-left"
      }`}
      style={{
        borderColor: "hsl(var(--border))",
        color: "hsl(var(--muted-foreground))",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, right }) {
  return (
    <td
      className={`border-b px-3 py-1.5 align-middle ${
        right ? "text-right font-semibold tabular-nums" : "text-left"
      }`}
      style={{
        borderColor: "hsl(var(--border))",
        color: "hsl(var(--foreground))",
      }}
    >
      {children}
    </td>
  );
}
