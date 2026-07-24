import { useState, useEffect, useRef } from "react";
import { MapPin } from "lucide-react";
import MapaBodega from "../inventario/MapaBodega";

/**
 * UbicacionChip — chip pequeño e inline que muestra el código de ubicación
 * física de un producto (ej. "ST3-P2", "CV-ENTRADA"). No hace fetch: recibe
 * el código ya resuelto.
 *
 * Props:
 *   codigo       : string | null | undefined — código de la ubicación (ubicacion_id)
 *   className    : clases adicionales
 *   conMapa      : boolean — si es true, el chip es clickeable y abre un
 *                  popover con el mapa físico (MapaBodega). Default false, no
 *                  rompe los usos existentes.
 *   mostrarVacio : boolean — si es true y no hay código, pinta un chip gris
 *                  "Sin ubicar" en vez de desaparecer en silencio. Default
 *                  false: hoy casi ningún producto tiene ubicación (21 de
 *                  5.173 filas), así que mostrarlo siempre ensuciaría los
 *                  dropdowns densos de búsqueda de producto y enseñaría a
 *                  los usuarios a ignorarlo. Es opt-in para usarlo solo donde
 *                  de verdad importa que el operario sepa que falta ubicar.
 */
export default function UbicacionChip({
  codigo,
  className = "",
  conMapa = false,
  mostrarVacio = false,
}) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!abierto) return;
    const onClickFuera = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false);
    };
    document.addEventListener("mousedown", onClickFuera);
    return () => document.removeEventListener("mousedown", onClickFuera);
  }, [abierto]);

  const chipClass =
    `inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] leading-none ${className}`.trim();

  if (!codigo) {
    if (!mostrarVacio) return null;

    // Gris apagado a propósito: es un dato faltante, no una alerta. conMapa
    // se ignora aquí porque no hay ubicación que mostrar en el popover.
    return (
      <span
        className={chipClass}
        style={{
          backgroundColor: "hsl(var(--muted) / 0.5)",
          borderColor: "hsl(var(--muted-foreground) / 0.35)",
          color: "hsl(var(--muted-foreground))",
        }}
        title="Este producto no tiene ubicación asignada"
      >
        <MapPin className="h-3 w-3 shrink-0" />
        Sin ubicar
      </span>
    );
  }

  const chipStyle = {
    backgroundColor: "hsl(var(--info) / 0.08)",
    borderColor: "hsl(var(--info) / 0.35)",
    color: "hsl(var(--info))",
  };

  if (!conMapa) {
    return (
      <span
        className={chipClass}
        style={chipStyle}
        title={`Ubicación: ${codigo}`}
      >
        <MapPin className="h-3 w-3 shrink-0" />
        {codigo}
      </span>
    );
  }

  return (
    <span ref={ref} className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className={`${chipClass} cursor-pointer`}
        style={chipStyle}
        title={`Ver mapa de ubicación: ${codigo}`}
      >
        <MapPin className="h-3 w-3 shrink-0" />
        {codigo}
      </button>
      {abierto && (
        <div
          className="absolute right-0 top-full z-50 mt-1.5 w-[240px] max-w-[80vw] rounded-xl border p-3 shadow-lg"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <MapaBodega ubicacionId={codigo} />
        </div>
      )}
    </span>
  );
}
