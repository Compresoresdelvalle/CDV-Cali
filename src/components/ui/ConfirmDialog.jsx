import { useState, useCallback } from "react";

/**
 * useConfirm — hook que reemplaza window.confirm() por un modal con tokens CSS.
 *
 * Uso:
 *   const { confirm, ConfirmDialog } = useConfirm();
 *   const ok = await confirm({ titulo: "Eliminar", mensaje: "...", confirmLabel: "Eliminar", danger: true });
 *   if (!ok) return;
 *
 *   // Con campo de texto (reemplaza window.prompt): resuelve el string
 *   // escrito ("" si se deja vacío) o false si se cancela.
 *   const motivo = await confirm({ titulo: "...", input: { placeholder: "Motivo…" } });
 *   if (motivo === false) return;
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
          input: opts.input ?? null,
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
    return <Dialog state={state} close={close} />;
  }, [state, close]);

  return { confirm, ConfirmDialog };
}

/* Componente real (no closure) para que el input controlado tenga su propio
 * estado sin recrear el diálogo en cada tecla. No se exporta: vive detrás del
 * hook, por eso el aviso de fast-refresh no aplica. */
// eslint-disable-next-line react-refresh/only-export-components
function Dialog({ state, close }) {
  const [texto, setTexto] = useState("");
  const conInput = !!state.input;
  const confirmar = () => close(conInput ? texto : true);

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
        {conInput && (
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={state.input.placeholder ?? ""}
            rows={2}
            autoFocus
            className="mb-2 w-full rounded-lg border p-3 text-sm outline-none"
            style={{
              borderColor: "hsl(var(--border))",
              backgroundColor: "hsl(var(--background))",
              color: "hsl(var(--foreground))",
            }}
          />
        )}
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => close(false)}
            autoFocus={!conInput}
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
            onClick={confirmar}
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
}
