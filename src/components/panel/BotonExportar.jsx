import { Download } from "lucide-react";
import { aCSV, nombreArchivo, descargarCSV } from "../../lib/panel-exportar";

/**
 * Exporta LO QUE SE VE: las mismas filas de la sección, con el mismo rango
 * aplicado y ese rango en el nombre del archivo. Un botón que exportara "todo"
 * daría un archivo distinto de la pantalla que lo pidió, y ahí empiezan los
 * dos números que no cuadran.
 *
 * Se apaga si no hay nada que bajar, en vez de entregar un archivo con solo los
 * títulos.
 */
export default function BotonExportar({ filas = [], columnas, base, rango }) {
  const vacio = filas.length === 0;
  return (
    <button
      type="button"
      disabled={vacio}
      onClick={() =>
        descargarCSV(nombreArchivo(base, rango), aCSV(filas, columnas))
      }
      className="flex shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-medium"
      style={{
        minHeight: 48,
        borderColor: "hsl(var(--border))",
        color: vacio
          ? "hsl(var(--muted-foreground))"
          : "hsl(var(--foreground))",
        opacity: vacio ? 0.6 : 1,
      }}
      title={vacio ? "No hay nada que exportar" : "Descargar en CSV"}
    >
      <Download className="h-3.5 w-3.5" strokeWidth={1.7} />
      Exportar
    </button>
  );
}
