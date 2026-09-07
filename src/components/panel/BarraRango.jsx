import { useState } from "react";
import { RefreshCw, CalendarDays } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { es } from "date-fns/locale";
import { format, parseISO } from "date-fns";
import {
  ATAJOS,
  rangoDeAtajo,
  periodoAnterior,
  etiquetaRango,
  hayDatosParaComparar,
} from "../../lib/panel-rango";

/** "hace 2 min" — el cambio visible es lo que confirma que el botón sirvió. */
function haceCuanto(fecha) {
  const seg = Math.max(0, Math.round((Date.now() - fecha.getTime()) / 1000));
  if (seg < 45) return "hace unos segundos";
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return `hace ${h} h`;
}

/**
 * La barra que gobierna el panel entero.
 *
 * Lo más importante de la pantalla: si el rango no se entiende, ningún número de
 * abajo se entiende. Por eso debajo de los chips va SIEMPRE la frase en español
 * con lo que está aplicado y contra qué se compara — es lo que quita el tener
 * que adivinar.
 *
 * Se pega arriba al bajar, porque al llegar a la cartera uno ya no recuerda qué
 * periodo puso.
 */
export default function BarraRango({
  rango,
  atajo,
  onCambio,
  sede,
  sedes = [],
  onSede,
  actualizado,
  cargando,
  onRefrescar,
}) {
  const [abrirCal, setAbrirCal] = useState(false);

  const comparable = hayDatosParaComparar(rango);
  const anterior = periodoAnterior(rango);

  const chip = (activo) => ({
    minHeight: 48,
    borderColor: activo ? "hsl(var(--primary))" : "hsl(var(--border))",
    backgroundColor: activo ? "hsl(var(--primary) / 0.1)" : "hsl(var(--card))",
    color: activo ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
  });

  return (
    <div
      className="sticky top-0 z-20 border-b px-4 py-3 sm:px-6"
      style={{
        backgroundColor: "hsl(var(--background))",
        borderColor: "hsl(var(--border))",
      }}
    >
      {/* En celular los chips van en SU PROPIA fila. Compartiéndola con el
          selector de sede y el botón, en 360 px solo se alcanzaban a ver
          "Hoy" y medio "Ayer": había que adivinar que el resto se arrastra. */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        {/* En móvil ruedan en horizontal (no se apilan en tres filas); en
            escritorio envuelven, para que el último chip no quede cortado. */}
        <div className="-mx-1 flex gap-1.5 px-1 pb-1 max-md:overflow-x-auto md:flex-1 md:flex-wrap">
          {ATAJOS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onCambio(rangoDeAtajo(a.id), a.id)}
              className="shrink-0 rounded-lg border px-3 text-[12.5px] font-medium"
              style={chip(atajo === a.id)}
            >
              {a.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAbrirCal((v) => !v)}
            className="shrink-0 rounded-lg border px-3 text-[12.5px] font-medium"
            style={chip(atajo === "personalizado")}
            aria-expanded={abrirCal}
          >
            <CalendarDays
              className="mr-1 inline h-3.5 w-3.5"
              strokeWidth={1.7}
            />
            Personalizado
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Siempre presente, aunque las sedes todavía no hayan llegado: si
              apareciera al cargarlas, la barra entera daría un salto delante de
              quien la está mirando. */}
          <select
            value={sede}
            onChange={(e) => onSede(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border px-2 text-[12.5px] md:flex-none"
            style={{
              minHeight: 48,
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
            aria-label="Sede"
          >
            <option value="">Todas las sedes</option>
            {sedes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={onRefrescar}
            disabled={cargando}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium disabled:opacity-50"
            style={{
              minHeight: 48,
              borderColor: "hsl(var(--border))",
              backgroundColor: "hsl(var(--card))",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${cargando ? "animate-spin" : ""}`}
              strokeWidth={1.5}
            />
            {cargando ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </div>

      {/* La frase que quita el adivinar. */}
      <p
        className="mt-2 text-[12px]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        <span style={{ color: "hsl(var(--foreground))" }}>
          {etiquetaRango(rango)}
        </span>
        {comparable ? (
          <> · comparando contra {etiquetaRango(anterior)}</>
        ) : (
          <> · sin datos para comparar: la app arrancó en junio de 2026</>
        )}
        {actualizado && <> · Actualizado {haceCuanto(actualizado)}</>}
      </p>

      {abrirCal && (
        <div
          className="mt-3 inline-block rounded-xl border p-3"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          <DayPicker
            mode="range"
            locale={es}
            numberOfMonths={1}
            defaultMonth={parseISO(rango.desde)}
            selected={{
              from: parseISO(rango.desde),
              to: parseISO(rango.hasta),
            }}
            onSelect={(r) => {
              if (!r?.from) return;
              const desde = format(r.from, "yyyy-MM-dd");
              const hasta = format(r.to ?? r.from, "yyyy-MM-dd");
              onCambio({ desde, hasta }, "personalizado");
              // Solo se cierra cuando ya hay las dos puntas: cerrarlo al primer
              // clic obligaría a reabrirlo para elegir el final.
              if (r.to) setAbrirCal(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
