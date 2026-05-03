import { useState, useCallback } from "react";

/**
 * useConfirm — hook que reemplaza window.confirm() por un modal con tokens CSS.
 *
 * Uso:
 *   const { confirm, ConfirmDialog } = useConfirm();
 *   const ok = await confirm({ titulo: "Eliminar", mensaje: "...", confirmLabel: "Eliminar", danger: true });
 *   if (!ok) return;
 *
 *   // Y en el JSX:
 *   <ConfirmDialog />
 */
export function useConfirm() {
  const [state, setState] = useState(null);

  const confirm = useCallback(
    (opts = {}) =>
      new Promise((resolve) => {
        setState({
          titulo: opts.titulo ?? "¿Confirmas?",
          mensaje: opts.mensaje ?? "",
          confirmLabel: opts.confirmLabel ?? "Confirmar",
          cancelLabel: opts.cancelLabel ?? "Cancelar",
          danger: opts.danger ?? false,
          onResolve: resolve,
        });
      }),
    [],
  );

  const close = useCallback(
    (result) => {
      state?.onResolve?.(result);
      setState(null);
    },
    [state],
  );

  const ConfirmDialog = useCallback(() => {
    if (!state) return null;
    return (
      <div
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        onClick={() => close(false)}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5"
          style={{ backgroundColor: "hsl(var(--card))" }}
          role="alertdialog"
          aria-labelledby="confirm-title"
        >
          <h2
            id="confirm-title"
            className="text-lg font-semibold mb-2"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {state.titulo}
          </h2>
          {state.mensaje && (
            <p
              className="text-sm mb-4"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {state.mensaje}
            </p>
          )}
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => close(false)}
              autoFocus
              className="flex-1 h-12 rounded-lg text-sm font-medium border cursor-pointer"
              style={{
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--muted-foreground))",
                backgroundColor: "transparent",
              }}
            >
              {state.cancelLabel}
            </button>
            <button
              onClick={() => close(true)}
              className="flex-1 h-12 rounded-lg text-sm font-medium cursor-pointer"
              style={{
                backgroundColor: state.danger
                  ? "hsl(var(--destructive))"
                  : "hsl(var(--primary))",
                color: state.danger
                  ? "hsl(var(--destructive-foreground))"
                  : "hsl(var(--primary-foreground))",
              }}
            >
              {state.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }, [state, close]);

  return { confirm, ConfirmDialog };
}
