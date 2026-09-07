import StatusBadge from "../../../components/ui/StatusBadge";
import { derivar, BADGE } from "../../../lib/picking-compras";

/**
 * Modo lista (Task 10): misma información que `LineaEnfoque`, misma
 * aritmética (`derivar`), pero en horizontal — para tablet/escritorio, donde
 * conviene ver varias líneas a la vez en vez de una por pantalla.
 *
 * Dos formas del mismo dato, siguiendo la Regla #5 (desktop tabla / mobile
 * cards): `LineaListaCard` para `md` (una columna, controles grandes) y
 * `LineaListaFila` para `lg` (fila de tabla, más densa). Ninguna reimplementa
 * la aritmética: todo sale de `derivar()`, igual que en el modo enfoque, para
 * que los dos modos jamás puedan discrepar en un mismo conteo.
 */

/** "faltan 2 · 1 dañada" — igual que en modo enfoque, mismo orden de gravedad. */
function detalleTexto(d) {
  const partes = [];
  if (d.faltan > 0) partes.push(`faltan ${d.faltan}`);
  if (d.danadas > 0)
    partes.push(`${d.danadas} dañada${d.danadas === 1 ? "" : "s"}`);
  if (d.sobran > 0) partes.push(`sobran ${d.sobran}`);
  return partes.join(" · ");
}

function Decision({ d, linea, onFaltanteAccion, onSobranteAccion, compact }) {
  if (d.faltan === 0 && d.sobran === 0) {
    return (
      <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
        —
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {d.faltan > 0 && (
        <div className="flex gap-1.5">
          <MiniBtn
            compact={compact}
            active={linea.faltante_accion === "ajustar"}
            onClick={() => onFaltanteAccion(linea.detalle_id, "ajustar")}
          >
            Ajustar factura
          </MiniBtn>
          <MiniBtn
            compact={compact}
            active={linea.faltante_accion === "reclamar"}
            onClick={() => onFaltanteAccion(linea.detalle_id, "reclamar")}
          >
            Reclamar
          </MiniBtn>
        </div>
      )}
      {d.sobran > 0 && (
        <div className="flex gap-1.5">
          <MiniBtn
            compact={compact}
            active={linea.sobrante_accion === "entra"}
            onClick={() => onSobranteAccion(linea.detalle_id, "entra")}
          >
            Entran igual
          </MiniBtn>
          <MiniBtn
            compact={compact}
            active={linea.sobrante_accion === "entra_y_reporta"}
            onClick={() => onSobranteAccion(linea.detalle_id, "entra_y_reporta")}
          >
            Entran y reporto
          </MiniBtn>
        </div>
      )}
    </div>
  );
}

function MiniBtn({ children, active, onClick, compact }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg text-xs font-medium px-2.5 whitespace-nowrap"
      style={{
        minHeight: compact ? 40 : 48,
        border: `1px solid ${active ? "hsl(var(--primary))" : "hsl(var(--border))"}`,
        backgroundColor: active
          ? "hsl(var(--primary) / 0.12)"
          : "hsl(var(--background))",
        color: active ? "hsl(var(--primary))" : "hsl(var(--foreground))",
      }}
    >
      {children}
    </button>
  );
}

function Stepper({ value, onChange, size, ariaPrefix }) {
  const s = size ?? 44;
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label={`${ariaPrefix} — restar una unidad`}
        onClick={() => onChange(value - 1)}
        className="flex items-center justify-center rounded-lg border font-bold shrink-0"
        style={{
          width: s,
          height: s,
          borderColor: "hsl(var(--border))",
          backgroundColor: "hsl(var(--background))",
          color: "hsl(var(--foreground))",
        }}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaPrefix}
        className="w-14 text-center text-lg font-bold tabular-nums bg-transparent outline-none border-b"
        style={{ color: "hsl(var(--foreground))", borderColor: "hsl(var(--border))" }}
      />
      <button
        type="button"
        aria-label={`${ariaPrefix} — sumar una unidad`}
        onClick={() => onChange(value + 1)}
        className="flex items-center justify-center rounded-lg border font-bold shrink-0"
        style={{
          width: s,
          height: s,
          borderColor: "hsl(var(--border))",
          backgroundColor: "hsl(var(--background))",
          color: "hsl(var(--foreground))",
        }}
      >
        +
      </button>
    </div>
  );
}

/** Tarjeta de una línea — `md` (mobile + tablet en portrait). */
export default function LineaListaCard({
  linea,
  onCantidad,
  onDanadas,
  onCompleto,
  onNada,
  onFaltanteAccion,
  onSobranteAccion,
}) {
  const d = derivar(linea);
  const badge = BADGE[d.estado];
  const detalle = detalleTexto(d);

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className="font-mono text-xs truncate"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {linea.referencia || "Sin referencia"} ·{" "}
            {linea.destino === "insumo" ? "Insumo" : "Venta"}
          </p>
          <p
            className="text-sm font-semibold leading-tight"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {linea.nombre || "Producto sin nombre"}
          </p>
        </div>
        <StatusBadge status={badge.status}>{badge.texto}</StatusBadge>
      </div>

      {!linea.contada && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onCompleto(linea.detalle_id, d.pedido)}
            className="flex-1 rounded-lg text-xs font-semibold"
            style={{
              minHeight: 48,
              backgroundColor: "hsl(var(--success) / 0.1)",
              color: "hsl(var(--success))",
              border: "1px solid hsl(var(--success) / 0.4)",
            }}
          >
            Llegó completo ({d.pedido})
          </button>
          <button
            type="button"
            onClick={() => onNada(linea.detalle_id)}
            className="flex-1 rounded-lg text-xs font-semibold"
            style={{
              minHeight: 48,
              backgroundColor: "hsl(var(--destructive) / 0.08)",
              color: "hsl(var(--destructive))",
              border: "1px solid hsl(var(--destructive) / 0.35)",
            }}
          >
            No llegó nada
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Llegaron (pedido {d.pedido})
          </p>
          <Stepper
            value={d.llegaron}
            onChange={(v) => onCantidad(linea.detalle_id, v)}
            ariaPrefix="Unidades que llegaron"
          />
        </div>
        {d.llegaron > 0 && (
          <div>
            <p
              className="text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Dañadas
            </p>
            <Stepper
              value={d.danadas}
              onChange={(v) =>
                onDanadas(linea.detalle_id, Math.min(d.llegaron, Number(v) || 0))
              }
              size={40}
              ariaPrefix="Unidades dañadas"
            />
          </div>
        )}
      </div>

      {detalle && (
        <p className="text-xs tabular-nums" style={{ color: "hsl(var(--muted-foreground))" }}>
          {detalle}
        </p>
      )}

      {(d.faltan > 0 || d.sobran > 0) && (
        <Decision
          d={d}
          linea={linea}
          onFaltanteAccion={onFaltanteAccion}
          onSobranteAccion={onSobranteAccion}
        />
      )}
    </div>
  );
}

/** Fila de tabla — `lg` (escritorio, más densa). */
export function LineaListaFila({
  linea,
  onCantidad,
  onDanadas,
  onCompleto,
  onNada,
  onFaltanteAccion,
  onSobranteAccion,
}) {
  const d = derivar(linea);
  const badge = BADGE[d.estado];
  const detalle = detalleTexto(d);

  return (
    <tr className="border-b last:border-b-0" style={{ borderColor: "hsl(var(--border))" }}>
      <td className="px-3 py-2 align-top max-w-[280px]">
        <p
          className="font-mono text-xs"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {linea.referencia || "Sin referencia"} ·{" "}
          {linea.destino === "insumo" ? "Insumo" : "Venta"}
        </p>
        <p className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
          {linea.nombre || "Producto sin nombre"}
        </p>
        {!linea.contada && (
          <div className="flex gap-1.5 mt-1.5">
            <button
              type="button"
              onClick={() => onCompleto(linea.detalle_id, d.pedido)}
              className="rounded-md text-xs font-semibold px-2"
              style={{
                // 48 y no 40: la tabla arranca en `lg`, o sea 1024px, que es
                // exactamente el ancho de un iPad en horizontal. Ahi no hay
                // mouse, hay dedos con guantes, y la tablet es el aparato
                // principal en bodega.
                minHeight: 48,
                backgroundColor: "hsl(var(--success) / 0.1)",
                color: "hsl(var(--success))",
                border: "1px solid hsl(var(--success) / 0.4)",
              }}
            >
              Completo ({d.pedido})
            </button>
            <button
              type="button"
              onClick={() => onNada(linea.detalle_id)}
              className="rounded-md text-xs font-semibold px-2"
              style={{
                // 48 y no 40: la tabla arranca en `lg`, o sea 1024px, que es
                // exactamente el ancho de un iPad en horizontal. Ahi no hay
                // mouse, hay dedos con guantes, y la tablet es el aparato
                // principal en bodega.
                minHeight: 48,
                backgroundColor: "hsl(var(--destructive) / 0.08)",
                color: "hsl(var(--destructive))",
                border: "1px solid hsl(var(--destructive) / 0.35)",
              }}
            >
              Nada
            </button>
          </div>
        )}
      </td>
      <td className="px-3 py-2 align-top text-center tabular-nums text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
        {d.pedido}
      </td>
      <td className="px-3 py-2 align-top">
        {/* Steppers de 40px en vez de 48px: esta fila es densa a propósito
            (Regla #5 — tabla de escritorio) y aquí se opera con mouse, no con
            guantes. El mínimo de 48px de CLAUDE.md protege el uso industrial
            de campo; en el modo enfoque (celular) sí se respeta. */}
        <Stepper
          value={d.llegaron}
          onChange={(v) => onCantidad(linea.detalle_id, v)}
          size={40}
          ariaPrefix="Unidades que llegaron"
        />
      </td>
      <td className="px-3 py-2 align-top">
        {d.llegaron > 0 ? (
          <Stepper
            value={d.danadas}
            onChange={(v) =>
              onDanadas(linea.detalle_id, Math.min(d.llegaron, Number(v) || 0))
            }
            size={36}
            ariaPrefix="Unidades dañadas"
          />
        ) : (
          <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex flex-col gap-1">
          <StatusBadge status={badge.status}>{badge.texto}</StatusBadge>
          {detalle && (
            <span className="text-xs tabular-nums" style={{ color: "hsl(var(--muted-foreground))" }}>
              {detalle}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 align-top">
        <Decision
          d={d}
          linea={linea}
          onFaltanteAccion={onFaltanteAccion}
          onSobranteAccion={onSobranteAccion}
          compact
        />
      </td>
    </tr>
  );
}
