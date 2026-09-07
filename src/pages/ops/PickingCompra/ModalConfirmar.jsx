import { useRef, useState } from "react";
import { derivar } from "../../../lib/picking-compras";
import { formatCOP } from "../../../lib/utils";

/**
 * El modal que de verdad ejecuta el picking (Task 10, Step 3-4 del plan).
 *
 * No es un "¿está seguro?": redacta la CONSECUENCIA en prosa, con los números
 * reales de esta compra. Cada viñeta sale de `derivar()` por línea — la misma
 * función que ya usan `LineaEnfoque` y `LineaLista` — para que lo que se
 * promete aquí sea exactamente lo que `fn_procesar_picking_compra` va a hacer
 * del otro lado. Ninguna cuenta se reinventa: solo se agrega la parte de
 * plata (COP), que la lógica pura no calcula porque no le compete.
 */
function calcularConsecuencias(compra, lineas) {
  let inventoryUp = 0;
  let reduccionFactura = 0;
  let unidadesAjustadas = 0;

  for (const l of lineas) {
    if (!l.contada) continue; // el modal solo se abre con resumen.listo, pero no se asume
    const d = derivar(l);
    inventoryUp += d.buenas;
    if (d.faltan > 0 && l.faltante_accion === "ajustar") {
      reduccionFactura += d.faltan * Number(l.costo_unitario ?? 0);
      unidadesAjustadas += d.faltan;
    }
  }

  const facturaAntes = Number(compra?.total ?? 0);
  const facturaDespues = Math.max(0, facturaAntes - reduccionFactura);

  return { inventoryUp, facturaAntes, facturaDespues, unidadesAjustadas, reduccionFactura };
}

export default function ModalConfirmar({ compra, lineas, resumen, onConfirm, onClose }) {
  const [enviando, setEnviando] = useState(false);
  // Guarda SINCRONA. El `disabled` de React no sirve contra un doble toque
  // rapido: el segundo evento puede entrar antes del re-render. En una tablet
  // de bodega, con guantes, la repeticion de evento tactil es comun, y aqui el
  // costo de disparar dos veces es llamar dos veces a la RPC que recibe la
  // compra.
  const enviandoRef = useRef(false);
  const c = calcularConsecuencias(compra, lineas);
  const proveedor = compra?.proveedor || "el proveedor";

  const handleConfirmar = async () => {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    const ok = await onConfirm();
    // Si falló, el padre ya avisó el porqué (safeError) — se reactiva el botón
    // y el modal queda abierto con el conteo intacto para que se pueda
    // reintentar o cerrar sin perder nada. Si funcionó, el padre navega y este
    // modal se desmonta con la pantalla; no hace falta tocar el estado.
    if (!ok) {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={() => !enviando && onClose()}
    >
      <div
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        style={{ backgroundColor: "hsl(var(--card))" }}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-labelledby="confirmar-picking-title"
      >
        <h2
          id="confirmar-picking-title"
          className="text-lg font-semibold"
          style={{ color: "hsl(var(--foreground))" }}
        >
          Vas a recibir la compra #{compra?.numero}
        </h2>

        <ul className="space-y-2.5 text-sm" style={{ color: "hsl(var(--foreground))" }}>
          {c.inventoryUp > 0 && (
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>
                El inventario sube <strong className="tabular-nums">{c.inventoryUp} unidades</strong>.
              </span>
            </li>
          )}
          {c.reduccionFactura > 0 && (
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>
                La factura baja de <strong className="tabular-nums">{formatCOP(c.facturaAntes)}</strong>{" "}
                a <strong className="tabular-nums">{formatCOP(c.facturaDespues)}</strong>:{" "}
                {c.unidadesAjustadas} unidad{c.unidadesAjustadas === 1 ? "" : "es"} no{" "}
                {c.unidadesAjustadas === 1 ? "la despacharon" : "las despacharon"}.
              </span>
            </li>
          )}
          {resumen.aReclamar > 0 && (
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>
                Quedan <strong className="tabular-nums">{resumen.aReclamar} unidades</strong> para
                reclamarle a {proveedor}. Se abre la garantía y Maritza decide si pide nota crédito o
                reposición.
              </span>
            </li>
          )}
          {resumen.deMas > 0 && (
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>
                <strong className="tabular-nums">{resumen.deMas} unidades</strong> llegaron de más y
                entran al inventario al costo de la compra.
              </span>
            </li>
          )}
        </ul>

        <p className="text-sm font-semibold" style={{ color: "hsl(var(--destructive))" }}>
          Esto no se puede deshacer.
        </p>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={enviando}
            className="flex-1 rounded-lg border text-sm font-medium disabled:opacity-50"
            style={{
              minHeight: 48,
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
              backgroundColor: "transparent",
            }}
          >
            Revisar de nuevo
          </button>
          <button
            type="button"
            onClick={handleConfirmar}
            disabled={enviando}
            className="flex-1 rounded-lg text-sm font-semibold disabled:opacity-60"
            style={{
              minHeight: 48,
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            {enviando ? "Recibiendo…" : "Sí, recibir compra"}
          </button>
        </div>
      </div>
    </div>
  );
}
