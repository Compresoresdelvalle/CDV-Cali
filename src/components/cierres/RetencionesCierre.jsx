import { formatCOP } from "../../lib/utils";
import { resumirRetenciones } from "../../lib/retenciones-informe";
import { useRetencionesPeriodo } from "../../hooks/useRetencionesPeriodo";

/**
 * Línea informativa de retenciones del cierre. SOLO SE MUESTRA: los totales
 * del cierre ya vienen netos de retención desde el servidor y aquí no se toca
 * ninguno. Sirve para que la cuenta "vendí X pero entró menos" no parezca un
 * faltante de caja.
 *
 * Cuenta solo documentos CON retención del periodo (ventas directas, OT
 * entregadas y compras), con los mismos filtros del cierre.
 *
 * @param {object} p
 * @param {string} p.desdeDia  'YYYY-MM-DD'
 * @param {string} p.hastaDia  'YYYY-MM-DD'
 * @param {string|null} [p.sedeId]
 * @param {number} [p.refresco]
 * @param {string} [p.alcance] frase que dice de qué sedes es la cuenta
 */
export default function RetencionesCierre({
  desdeDia,
  hastaDia,
  sedeId = null,
  refresco = 0,
  alcance,
}) {
  const { cargando, error, nosRetuvieron, retuvimos } = useRetencionesPeriodo({
    desdeDia,
    hastaDia,
    sedeId,
    refresco,
  });

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
  if (cargando || !nosRetuvieron || !retuvimos) {
    return (
      <div
        className="h-12 animate-pulse rounded-lg"
        style={{ backgroundColor: "hsl(var(--muted) / 0.4)" }}
      />
    );
  }

  const v = resumirRetenciones(nosRetuvieron);
  const c = resumirRetenciones(retuvimos);

  if (v.n === 0 && c.n === 0) {
    return (
      <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
        Sin retenciones en este periodo{alcance ? ` (${alcance})` : ""}.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      {v.n > 0 && (
        <Linea
          titulo={`Ventas y OT con retención (${v.n})`}
          partes={[
            ["Vendido", v.facturado],
            ["retenciones", v.retenido],
            ["entró", v.neto],
          ]}
        />
      )}
      {c.n > 0 && (
        <Linea
          titulo={`Compras con retención (${c.n})`}
          partes={[
            ["Comprado", c.facturado],
            ["retenido", c.retenido],
            ["pagado o por pagar", c.neto],
          ]}
        />
      )}
      <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
        La retención no es plata perdida: es un anticipo de impuestos que se le
        consigna a la DIAN y se descuenta en la declaración; por eso a caja
        entra (o sale) el neto. Estos números son informativos, los totales del
        cierre no cambian
        {alcance ? `. ${alcance}` : ""}.
      </p>
    </div>
  );
}

function Linea({ titulo, partes }) {
  const [[l1, n1], [l2, n2], [l3, n3]] = partes;
  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{
        borderColor: "hsl(var(--border))",
        backgroundColor: "hsl(var(--muted) / 0.2)",
      }}
    >
      <p
        className="text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {titulo}
      </p>
      <p
        className="mt-0.5 text-sm tabular-nums"
        style={{ color: "hsl(var(--foreground))" }}
      >
        {l1} <b>{formatCOP(n1)}</b> − {l2}{" "}
        <b style={{ color: "hsl(var(--warning))" }}>{formatCOP(n2)}</b> = {l3}{" "}
        <b>{formatCOP(n3)}</b>
      </p>
    </div>
  );
}
