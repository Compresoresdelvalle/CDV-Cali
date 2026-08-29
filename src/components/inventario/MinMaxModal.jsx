import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { avisarOk, avisarError } from "../../lib/notify";
import NumeroInput from "../forms/NumeroInput";

/**
 * Configura el mínimo y el máximo de UN producto en UNA sede.
 *
 * Lo comparten la ficha de producto y la pantalla de mínimos: una sola forma de
 * pedir los dos números y un solo sitio donde explicar qué significan el 0 y el
 * 0 del máximo, que es lo que más se malinterpreta.
 *
 * La validación de verdad vive en el servidor (`fn_definir_minmax`: rol, sede,
 * rangos y bitácora). Aquí sólo se adelanta lo obvio para no hacer un viaje que
 * ya se sabe que falla.
 */
export default function MinMaxModal({
  producto, // { id, nombre, referencia }
  sede, // { id, nombre }
  minimoActual = 0,
  maximoActual = 0,
  onCerrar,
  onGuardado,
}) {
  const [minimo, setMinimo] = useState(minimoActual ?? 0);
  const [maximo, setMaximo] = useState(maximoActual ?? 0);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setMinimo(minimoActual ?? 0);
    setMaximo(maximoActual ?? 0);
    setError(null);
  }, [minimoActual, maximoActual, producto?.id, sede?.id]);

  // Mismo criterio que el CHECK de la tabla: max = 0 es válido (sin techo),
  // pero un máximo por debajo del mínimo dejaría la fila siendo "Bajo" y
  // "Sobrestock" a la vez.
  const maxInvalido = maximo > 0 && maximo < minimo;

  const guardar = async () => {
    if (maxInvalido || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc("fn_definir_minmax", {
        p_producto_id: producto.id,
        p_sede_id: sede.id,
        p_minimo: Number(minimo) || 0,
        p_maximo: Number(maximo) || 0,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      avisarOk(`Mínimo y máximo guardados para ${sede.nombre ?? sede.id}.`);
      onGuardado?.({
        minimo: Number(minimo) || 0,
        maximo: Number(maximo) || 0,
      });
      onCerrar?.();
    } catch (err) {
      setError(err.message);
      avisarError(err, "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={() => !guardando && onCerrar?.()}
      role="presentation"
    >
      <div
        className="w-full max-w-md space-y-3 rounded-xl border p-5"
        style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-200)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Configurar mínimo y máximo"
      >
        <h3 className="text-lg font-semibold" style={{ color: "var(--n-950)" }}>
          Mínimo y máximo en {sede?.nombre ?? sede?.id}
        </h3>
        <p className="text-xs" style={{ color: "var(--n-500)" }}>
          <strong>{producto?.nombre}</strong>
          {producto?.referencia ? ` · ${producto.referencia}` : ""}
        </p>

        {error && (
          <div
            role="alert"
            className="rounded-lg border px-3 py-2 text-xs"
            style={{
              backgroundColor: "var(--dang-50)",
              borderColor: "var(--dang-200)",
              color: "var(--dang-700)",
            }}
          >
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span
              className="mb-1 block text-xs font-medium"
              style={{ color: "var(--n-700)" }}
            >
              Mínimo
            </span>
            <NumeroInput
              value={minimo}
              onChange={setMinimo}
              min={0}
              className="h-12 w-full rounded-lg border px-3 text-right font-mono text-base outline-none"
              style={{ borderColor: "var(--n-200)" }}
            />
          </label>
          <label className="block">
            <span
              className="mb-1 block text-xs font-medium"
              style={{ color: "var(--n-700)" }}
            >
              Máximo
            </span>
            <NumeroInput
              value={maximo}
              onChange={setMaximo}
              min={0}
              className="h-12 w-full rounded-lg border px-3 text-right font-mono text-base outline-none"
              style={{ borderColor: "var(--n-200)" }}
            />
          </label>
        </div>

        {/* Lo que más se malinterpreta: el 0 no es "cero unidades", es "no
            controlar". Se dice aquí, en el momento de decidir. */}
        <ul
          className="m-0 list-none space-y-1 rounded-lg border p-3 text-[11.5px]"
          style={{
            borderColor: "var(--n-200)",
            backgroundColor: "var(--n-25, var(--n-50))",
            color: "var(--n-600)",
          }}
        >
          <li>
            <b>Mínimo 0</b>: esta sede no maneja el producto. No genera alerta,
            ni aunque quede en cero.
          </li>
          <li>
            <b>Máximo 0</b>: sin techo. Nunca marca sobrestock.
          </li>
        </ul>

        {maxInvalido && (
          <p
            role="alert"
            className="m-0 text-xs font-medium"
            style={{ color: "var(--dang-700)" }}
          >
            El máximo ({maximo}) no puede ser menor que el mínimo ({minimo}).
            Sube el máximo o baja el mínimo.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={() => onCerrar?.()}
            disabled={guardando}
            className="btn btn-out"
            style={{ height: 48 }}
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || maxInvalido}
            className="btn btn-pri disabled:opacity-60"
            style={{ height: 48 }}
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
