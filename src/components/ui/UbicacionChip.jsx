import { MapPin } from "lucide-react";

/**
 * UbicacionChip — chip pequeño e inline que muestra el código de ubicación
 * física de un producto (ej. "ST3-P2", "CV-ENTRADA"). No hace fetch: recibe
 * el código ya resuelto.
 *
 * Props:
 *   codigo    : string | null | undefined — código de la ubicación (ubicacion_id)
 *   className : clases adicionales
 */
export default function UbicacionChip({ codigo, className = "" }) {
  if (!codigo) return null;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] leading-none ${className}`.trim()}
      style={{
        backgroundColor: "hsl(var(--info) / 0.08)",
        borderColor: "hsl(var(--info) / 0.35)",
        color: "hsl(var(--info))",
      }}
      title={`Ubicación: ${codigo}`}
    >
      <MapPin className="h-3 w-3 shrink-0" />
      {codigo}
    </span>
  );
}
