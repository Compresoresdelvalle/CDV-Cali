import { Component } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * Barrera de error de React.
 *
 * Sin esto, CUALQUIER error de render desmonta el árbol completo y el operario
 * ve una pantalla en blanco, sin barra lateral, sin mensaje y sin forma de
 * saber qué pasó ni de navegar a otra parte. Pasó en producción con la pantalla
 * de Cierres: "no se puede entrar, se queda en blanco".
 *
 * Con la barrera: el fallo queda contenido, se muestra el error real (útil para
 * diagnosticar sin pedirle a nadie que abra la consola del navegador) y el resto
 * de la app sigue funcionando.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Deja rastro en la consola para diagnóstico, con el árbol de componentes.
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  reintentar = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        className="p-4 sm:p-6 animate-fade-in"
        style={{ backgroundColor: "hsl(var(--background))" }}
      >
        <div
          className="mx-auto max-w-[720px] rounded-xl border p-5"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--destructive) / 0.4)",
          }}
        >
          <div className="flex items-start gap-3">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md"
              style={{
                backgroundColor: "hsl(var(--destructive) / 0.1)",
                color: "hsl(var(--destructive))",
              }}
            >
              <AlertTriangle className="h-4.5 w-4.5" strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <p
                className="text-sm font-semibold"
                style={{ color: "hsl(var(--foreground))" }}
              >
                Esta pantalla no se pudo mostrar
              </p>
              <p
                className="mt-1 text-xs leading-relaxed"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                El resto de la aplicación sigue funcionando: puedes moverte a
                otra sección desde el menú. Si el problema continúa, pásale este
                mensaje a soporte.
              </p>

              <pre
                className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md p-3 text-[11.5px] leading-relaxed"
                style={{
                  backgroundColor: "hsl(var(--muted) / 0.4)",
                  color: "hsl(var(--foreground))",
                }}
              >
                {String(error?.message || error)}
              </pre>

              <button
                type="button"
                onClick={this.reintentar}
                className="mt-3 inline-flex min-h-[48px] items-center gap-2 rounded-md px-4 text-sm font-medium"
                style={{
                  backgroundColor: "hsl(var(--primary))",
                  color: "hsl(var(--primary-foreground))",
                }}
              >
                <RotateCcw className="h-4 w-4" strokeWidth={1.8} />
                Reintentar
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
