import StatusBadge from "../../../components/ui/StatusBadge";
import { derivar, BADGE } from "../../../lib/picking-compras";

/**
 * Tarjeta de "modo enfoque": un producto por pantalla.
 *
 * Solo pinta y dispara callbacks — toda la aritmética (buenas/faltan/sobran,
 * qué dice el badge) sale de `derivar()`, para que esta tarjeta y el futuro
 * modo lista (Task 10) nunca puedan mostrar números distintos para la misma
 * línea.
 */
export default function LineaEnfoque({
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
      className="rounded-xl border p-5 space-y-5"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      {/* Encabezado del producto */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span
            className="font-mono text-xs"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {linea.referencia || "Sin referencia"}
          </span>
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: "hsl(var(--muted) / 0.5)",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            {linea.destino === "insumo" ? "Insumo" : "Venta"}
          </span>
        </div>
        <h2
          className="text-lg font-bold leading-tight"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {linea.nombre || "Producto sin nombre"}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={badge.status}>{badge.texto}</StatusBadge>
          {detalle && (
            <span
              className="text-xs tabular-nums"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {detalle}
            </span>
          )}
        </div>
      </div>

      {/* Atajos — solo mientras la línea siga sin contar */}
      {!linea.contada && (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => onCompleto(linea.detalle_id, d.pedido)}
            className="flex-1 rounded-xl font-semibold text-sm"
            style={{
              minHeight: 56,
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
            className="flex-1 rounded-xl font-semibold text-sm"
            style={{
              minHeight: 56,
              backgroundColor: "hsl(var(--destructive) / 0.08)",
              color: "hsl(var(--destructive))",
              border: "1px solid hsl(var(--destructive) / 0.35)",
            }}
          >
            No llegó nada
          </button>
        </div>
      )}

      {/* Cantidad que llegó */}
      <div>
        <p
          className="text-xs font-semibold uppercase tracking-wide text-center"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Unidades que llegaron
        </p>
        <div className="flex items-center justify-center gap-4 mt-2">
          <StepBtn
            aria-label="Restar una unidad"
            onClick={() => onCantidad(linea.detalle_id, d.llegaron - 1)}
          >
            −
          </StepBtn>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={d.llegaron}
            onChange={(e) => onCantidad(linea.detalle_id, e.target.value)}
            aria-label="Unidades que llegaron"
            className="w-24 text-center text-4xl font-bold tabular-nums bg-transparent outline-none"
            style={{ color: "hsl(var(--foreground))" }}
          />
          <StepBtn
            aria-label="Sumar una unidad"
            onClick={() => onCantidad(linea.detalle_id, d.llegaron + 1)}
          >
            +
          </StepBtn>
        </div>
        <p
          className="text-center text-xs mt-1 tabular-nums"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Pedido: {d.pedido}
        </p>
      </div>

      {/* Dañadas — solo tiene sentido si ya llegó algo que revisar */}
      {d.llegaron > 0 && (
        <div>
          <p
            className="text-xs font-semibold uppercase tracking-wide text-center"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            De esas, ¿cuántas llegaron dañadas?
          </p>
          <div className="flex items-center justify-center gap-3 mt-2">
            <StepBtn
              small
              aria-label="Restar una dañada"
              onClick={() => onDanadas(linea.detalle_id, d.danadas - 1)}
            >
              −
            </StepBtn>
            <span
              className="w-12 text-center text-2xl font-bold tabular-nums"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {d.danadas}
            </span>
            <StepBtn
              small
              aria-label="Sumar una dañada"
              onClick={() =>
                onDanadas(linea.detalle_id, Math.min(d.llegaron, d.danadas + 1))
              }
            >
              +
            </StepBtn>
          </div>
        </div>
      )}

      {/* Faltante: solo aparece si hay faltante */}
      {d.faltan > 0 && (
        <div
          className="rounded-xl border p-3 space-y-2"
          style={{
            borderColor: "hsl(var(--warning) / 0.4)",
            backgroundColor: "hsl(var(--warning) / 0.08)",
          }}
        >
          <p
            className="text-sm font-medium"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Faltan {d.faltan} unidad{d.faltan === 1 ? "" : "es"}. ¿Qué hacemos?
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <ChoiceBtn
              active={linea.faltante_accion === "ajustar"}
              onClick={() => onFaltanteAccion(linea.detalle_id, "ajustar")}
            >
              Ajustar la factura
            </ChoiceBtn>
            <ChoiceBtn
              active={linea.faltante_accion === "reclamar"}
              onClick={() => onFaltanteAccion(linea.detalle_id, "reclamar")}
            >
              Reclamar al proveedor
            </ChoiceBtn>
          </div>
        </div>
      )}

      {/* Sobrante: solo aparece si hay sobrante */}
      {d.sobran > 0 && (
        <div
          className="rounded-xl border p-3 space-y-2"
          style={{
            borderColor: "hsl(var(--info) / 0.4)",
            backgroundColor: "hsl(var(--info) / 0.08)",
          }}
        >
          <p
            className="text-sm font-medium"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Llegaron {d.sobran} de más. ¿Qué hacemos?
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <ChoiceBtn
              active={linea.sobrante_accion === "entra"}
              onClick={() => onSobranteAccion(linea.detalle_id, "entra")}
            >
              Entran igual
            </ChoiceBtn>
            <ChoiceBtn
              active={linea.sobrante_accion === "entra_y_reporta"}
              onClick={() =>
                onSobranteAccion(linea.detalle_id, "entra_y_reporta")
              }
            >
              Entran y reporto
            </ChoiceBtn>
          </div>
        </div>
      )}
    </div>
  );
}

/** "faltan 2 · 1 dañada" — solo lo que aplica, en el orden de gravedad. */
function detalleTexto(d) {
  if (!d) return "";
  const partes = [];
  if (d.faltan > 0) partes.push(`faltan ${d.faltan}`);
  if (d.danadas > 0)
    partes.push(`${d.danadas} dañada${d.danadas === 1 ? "" : "s"}`);
  if (d.sobran > 0) partes.push(`sobran ${d.sobran}`);
  return partes.join(" · ");
}

function StepBtn({ children, small, ...rest }) {
  const size = small ? 48 : 56;
  return (
    <button
      type="button"
      {...rest}
      className="flex items-center justify-center rounded-xl border font-bold shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: small ? 20 : 26,
        borderColor: "hsl(var(--border))",
        backgroundColor: "hsl(var(--background))",
        color: "hsl(var(--foreground))",
      }}
    >
      {children}
    </button>
  );
}

function ChoiceBtn({ children, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg text-sm font-medium px-3"
      style={{
        minHeight: 48,
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
