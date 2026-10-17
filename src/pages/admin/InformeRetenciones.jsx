/**
 * Informe de retenciones del mes (solo Admin, solo lectura).
 *
 * Dos lados:
 *   - "Nos retuvieron": ventas directas no anuladas y OT entregadas con
 *     retención. Es plata que el cliente consignó a la DIAN a nombre de la
 *     empresa; se descuenta en la declaración con sus certificados.
 *   - "Retuvimos": compras no canceladas con retención. Es plata que la empresa
 *     le debe consignar a la DIAN a nombre del proveedor.
 *
 * Los valores son las columnas generadas del servidor; aquí no se recalcula
 * ninguna retención. Ver `src/lib/retenciones-informe.js`.
 *
 * Sistema de diseño: tokens `hsl(var(--token))`, móvil tarjetas / escritorio
 * tabla, botones de 48px.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { formatCOP } from "../../lib/utils";
import { hoyBogota } from "../../lib/filtros";
import { aCSV, descargarCSV } from "../../lib/panel-exportar";
import { SEDE_LABEL } from "../../lib/ot-flujo";
import {
  TIPOS_RETENCION,
  resumirRetenciones,
  agruparPorTercero,
  filasCSV,
  COLUMNAS_CSV,
  rangoMesBogota,
  etiquetaMes,
  fechaCorta,
} from "../../lib/retenciones-informe";
import { useRetencionesPeriodo } from "../../hooks/useRetencionesPeriodo";

const RUTA_DOC = {
  venta: (id) => `/ops/ventas/${id}`,
  ot: (id) => `/ops/ordenes/${id}`,
  compra: (id) => `/ops/compras/${id}`,
};
const ETIQUETA_DOC = { venta: "Venta", ot: "OT", compra: "Compra" };

export default function InformeRetenciones() {
  const mesActual = hoyBogota().slice(0, 7);
  const [mes, setMes] = useState(mesActual);
  const rango = rangoMesBogota(mes) ?? rangoMesBogota(mesActual);

  const { cargando, error, nosRetuvieron, retuvimos } = useRetencionesPeriodo({
    desdeDia: rango.desdeDia,
    hastaDia: rango.hastaDia,
  });

  const filasExcel = useMemo(
    () => [
      ...filasCSV(nosRetuvieron ?? [], "Nos retuvieron"),
      ...filasCSV(retuvimos ?? [], "Retuvimos"),
    ],
    [nosRetuvieron, retuvimos],
  );
  const sinNada = filasExcel.length === 0;

  const descargar = () =>
    descargarCSV(`retenciones-${mes}.csv`, aCSV(filasExcel, COLUMNAS_CSV));

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Retenciones del mes"
        description={`Lo que nos retuvieron y lo que retuvimos en ${etiquetaMes(mes)}`}
        actions={
          <>
            <input
              type="month"
              value={mes}
              max={mesActual}
              onChange={(e) => e.target.value && setMes(e.target.value)}
              aria-label="Mes del informe"
              className="rounded-lg border px-3 text-sm"
              style={{
                height: 48,
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--foreground))",
              }}
            />
            <button
              type="button"
              onClick={descargar}
              disabled={sinNada || cargando}
              className="inline-flex items-center gap-2 rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
              style={{
                height: 48,
                backgroundColor: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
              }}
              title={
                sinNada
                  ? "No hay retenciones en este mes: no hay nada que descargar"
                  : "Descarga un archivo que abre Excel (una fila por retención)"
              }
            >
              <Download className="h-4 w-4" />
              Descargar Excel
            </button>
          </>
        }
      />

      <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
        La retención no es plata perdida: lo que nos retienen es un anticipo de
        impuestos que se descuenta en la declaración (pide el certificado al
        cliente), y lo que retenemos se le consigna a la DIAN a nombre del
        proveedor. Las OT cuentan por su fecha de entrega; las ventas que nacen
        de una OT no se repiten.
      </p>

      {error && (
        <div
          role="alert"
          className="rounded-xl border px-4 py-3 text-sm"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.3)",
            color: "hsl(var(--destructive))",
          }}
        >
          {error}
        </div>
      )}

      <Lado
        titulo="Nos retuvieron (ventas y OT)"
        docs={nosRetuvieron}
        cargando={cargando}
        etiquetaTercero="Cliente"
        vacio="Ningún cliente nos retuvo en este mes."
      />
      <Lado
        titulo="Retuvimos (compras)"
        docs={retuvimos}
        cargando={cargando}
        etiquetaTercero="Proveedor"
        vacio="No le retuvimos a ningún proveedor en este mes."
      />
    </div>
  );
}

/* ─────────────────────────── Un lado del informe ─────────────────────── */

function Lado({ titulo, docs, cargando, etiquetaTercero, vacio }) {
  const resumen = useMemo(() => resumirRetenciones(docs ?? []), [docs]);
  const grupos = useMemo(() => agruparPorTercero(docs ?? []), [docs]);

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
          {titulo}
        </p>
      </div>
      <div className="p-4 space-y-4">
        {cargando || !docs ? (
          <div
            className="h-24 animate-pulse rounded-lg"
            style={{ backgroundColor: "hsl(var(--muted) / 0.4)" }}
          />
        ) : docs.length === 0 ? (
          <p
            className="py-2 text-center text-sm"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {vacio}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {TIPOS_RETENCION.map((t) => (
                <Total
                  key={t.id}
                  label={t.label}
                  valor={resumen.porTipo[t.id]}
                />
              ))}
              <Total label="Total retenido" valor={resumen.retenido} fuerte />
            </div>
            <p
              className="text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {resumen.n} {resumen.n === 1 ? "documento" : "documentos"} ·
              facturado {formatCOP(resumen.facturado)} · neto{" "}
              {formatCOP(resumen.neto)}
            </p>
            {grupos.map((g) => (
              <Grupo key={g.tercero} grupo={g} etiqueta={etiquetaTercero} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Total({ label, valor, fuerte }) {
  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{
        borderColor: "hsl(var(--border))",
        backgroundColor: fuerte ? "hsl(var(--primary) / 0.06)" : "transparent",
      }}
    >
      <p
        className="text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </p>
      <p
        className="mt-0.5 text-base font-semibold tabular-nums"
        style={{
          color: fuerte ? "hsl(var(--primary))" : "hsl(var(--foreground))",
        }}
      >
        {formatCOP(valor)}
      </p>
    </div>
  );
}

/* ─────────────────────────── Detalle por tercero ─────────────────────── */

function Grupo({ grupo, etiqueta }) {
  const navigate = useNavigate();
  // Una fila por retención: así se cuadra cada certificado.
  const filas = grupo.docs.flatMap((d) =>
    d.retenciones.map((r) => ({ d, r, key: `${d.tipoDoc}-${d.id}-${r.tipo}` })),
  );
  const abrir = (d) => navigate(RUTA_DOC[d.tipoDoc](d.id));

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p
          className="text-sm font-semibold"
          style={{ color: "hsl(var(--foreground))" }}
        >
          <span
            className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {etiqueta}
          </span>
          {grupo.tercero}
        </p>
        <p
          className="text-sm font-semibold tabular-nums"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {formatCOP(grupo.retenido)}
        </p>
      </div>

      {/* Móvil: tarjetas */}
      <ul className="md:hidden space-y-2" role="list">
        {filas.map(({ d, r, key }) => (
          <li key={key}>
            <button
              type="button"
              onClick={() => abrir(d)}
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
                    {ETIQUETA_DOC[d.tipoDoc]} #{d.numero}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {fechaCorta(d.fecha)}
                    {d.sedeId ? ` · ${SEDE_LABEL[d.sedeId] ?? d.sedeId}` : ""}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {r.label} {String(r.pct).replace(".", ",")}% sobre{" "}
                    {formatCOP(r.base)}
                  </p>
                </div>
                <p
                  className="shrink-0 text-sm font-semibold tabular-nums"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {formatCOP(r.valor)}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {/* Escritorio: tabla */}
      <div
        className="hidden md:block overflow-x-auto rounded-xl border"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: "hsl(var(--muted) / 0.3)" }}>
              <Th>Documento</Th>
              <Th>Fecha</Th>
              <Th>Sede</Th>
              <Th>Retención</Th>
              <Th right>Base</Th>
              <Th right>%</Th>
              <Th right>Valor</Th>
            </tr>
          </thead>
          <tbody>
            {filas.map(({ d, r, key }) => (
              <tr
                key={key}
                onClick={() => abrir(d)}
                className="cursor-pointer"
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor =
                    "hsl(var(--muted) / 0.4)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "")
                }
              >
                <Td>
                  <span
                    className="font-semibold"
                    style={{ color: "hsl(var(--primary))" }}
                  >
                    {ETIQUETA_DOC[d.tipoDoc]} #{d.numero}
                  </span>
                </Td>
                <Td>{fechaCorta(d.fecha)}</Td>
                <Td>{SEDE_LABEL[d.sedeId] ?? d.sedeId ?? "—"}</Td>
                <Td>{r.label}</Td>
                <Td right>{formatCOP(r.base)}</Td>
                <Td right>{String(r.pct).replace(".", ",")}%</Td>
                <Td right fuerte>
                  {formatCOP(r.valor)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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

function Td({ children, right, fuerte }) {
  return (
    <td
      className={`border-b px-3 py-2.5 align-middle ${
        right ? "text-right tabular-nums" : "text-left"
      } ${fuerte ? "font-semibold" : ""}`}
      style={{
        borderColor: "hsl(var(--border))",
        color: "hsl(var(--foreground))",
      }}
    >
      {children}
    </td>
  );
}
