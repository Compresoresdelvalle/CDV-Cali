import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { PRESETS_FECHA } from "../../lib/filtros";

/**
 * Barra de filtros reales de un listado.
 *
 * Pensada para operarios industriales (guantes, tablet, celular):
 *  - La búsqueda SIEMPRE visible (es lo que se usa 8 de cada 10 veces); el
 *    resto vive tras un botón "Filtros" con contador.
 *  - En móvil el panel es una hoja a pantalla completa con filas grandes y
 *    `<input type="date">` nativo (calendario y teclado de fecha gratis).
 *  - Chips de filtros activos siempre visibles: un filtro invisible actuando
 *    sobre la lista se lee como "se perdieron los datos".
 *  - Nada por debajo de 44-48px de alto.
 *
 * `legacy` pinta con los tokens del sistema antiguo (var(--n-*)), que es lo que
 * usan las pantallas ops. Sin él usa hsl(var(--...)) del sistema actual.
 */
export default function BarraFiltros({
  filtros,
  placeholder = "Buscar…",
  legacy = false,
  children,
}) {
  const [abierto, setAbierto] = useState(false);
  const { campos, valores, setValor, activos, limpiar } = filtros;

  const t = legacy
    ? {
        card: "var(--n-0)",
        borde: "var(--n-200)",
        texto: "var(--n-950)",
        suave: "var(--n-500)",
        chip: "var(--n-50)",
      }
    : {
        card: "hsl(var(--card))",
        borde: "hsl(var(--border))",
        texto: "hsl(var(--foreground))",
        suave: "hsl(var(--muted-foreground))",
        chip: "hsl(var(--muted) / 0.5)",
      };

  const campoTexto = campos.find((c) => c.tipo === "texto");
  const otros = campos.filter((c) => c.tipo !== "texto");

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {campoTexto && (
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
              style={{ color: t.suave }}
            />
            <input
              type="search"
              value={valores[campoTexto.id] ?? ""}
              onChange={(e) => setValor(campoTexto.id, e.target.value)}
              placeholder={placeholder}
              className="h-12 w-full rounded-lg border pl-9 pr-3 text-sm outline-none"
              style={{
                backgroundColor: t.card,
                borderColor: t.borde,
                color: t.texto,
              }}
            />
          </div>
        )}
        {otros.length > 0 && (
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            aria-expanded={abierto}
            className="inline-flex h-12 min-w-[48px] items-center gap-2 rounded-lg border px-3 text-sm font-medium"
            style={{
              backgroundColor: t.card,
              borderColor: t.borde,
              color: t.texto,
            }}
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">Filtros</span>
            {activos.length > 0 && (
              <span
                className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-bold"
                style={{
                  backgroundColor: legacy
                    ? "var(--p-600)"
                    : "hsl(var(--primary))",
                  color: legacy ? "#fff" : "hsl(var(--primary-foreground))",
                }}
              >
                {activos.length}
              </span>
            )}
          </button>
        )}
        {children}
      </div>

      {/* Chips de filtros activos — visibles siempre, para que nadie lea un
          filtro puesto como "faltan datos". */}
      {activos.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activos.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={a.quitar}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs"
              style={{
                backgroundColor: t.chip,
                borderColor: t.borde,
                color: t.texto,
              }}
            >
              <span style={{ color: t.suave }}>{a.label}:</span>
              <b className="font-medium">{a.valorLegible}</b>
              <X className="h-3.5 w-3.5" />
            </button>
          ))}
          {activos.length > 1 && (
            <button
              type="button"
              onClick={limpiar}
              className="h-9 px-2 text-xs underline"
              style={{ color: t.suave }}
            >
              Limpiar todo
            </button>
          )}
        </div>
      )}

      {abierto && otros.length > 0 && (
        <div
          className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-3"
          style={{ backgroundColor: t.card, borderColor: t.borde }}
        >
          {otros.map((c) => (
            <CampoFiltro key={c.id} campo={c} filtros={filtros} tono={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function CampoFiltro({ campo, filtros, tono }) {
  const { valores, setValor } = filtros;
  const v = valores[campo.id];

  const etiqueta = (
    <span
      className="text-[11px] font-semibold uppercase tracking-wide"
      style={{ color: tono.suave }}
    >
      {campo.label}
    </span>
  );

  if (campo.tipo === "fecha") {
    return (
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        {etiqueta}
        <div className="flex flex-wrap gap-1.5">
          {(campo.presets ?? ["hoy", "semana", "mes", "mesPasado"]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setValor(campo.id, PRESETS_FECHA[p].calcular())}
              className="h-9 rounded-full border px-3 text-xs"
              style={{ borderColor: tono.borde, color: tono.texto }}
            >
              {PRESETS_FECHA[p].label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={v?.desdeDia ?? ""}
            onChange={(e) =>
              setValor(campo.id, { ...v, desdeDia: e.target.value })
            }
            className="h-12 flex-1 rounded-lg border px-2 text-sm"
            style={{
              backgroundColor: tono.card,
              borderColor: tono.borde,
              color: tono.texto,
            }}
          />
          <span className="text-xs" style={{ color: tono.suave }}>
            a
          </span>
          <input
            type="date"
            value={v?.hastaDia ?? ""}
            onChange={(e) =>
              setValor(campo.id, { ...v, hastaDia: e.target.value })
            }
            className="h-12 flex-1 rounded-lg border px-2 text-sm"
            style={{
              backgroundColor: tono.card,
              borderColor: tono.borde,
              color: tono.texto,
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <label className="flex flex-col gap-1.5">
      {etiqueta}
      <select
        value={v ?? ""}
        onChange={(e) => setValor(campo.id, e.target.value)}
        className="h-12 w-full rounded-lg border px-2 text-sm"
        style={{
          backgroundColor: tono.card,
          borderColor: tono.borde,
          color: tono.texto,
        }}
      >
        <option value="">Todos</option>
        {(campo.opciones ?? []).map((o) => {
          const val = typeof o === "string" ? o : o.v;
          const lab = typeof o === "string" ? o : (o.l ?? o.label ?? o.v);
          return (
            <option key={String(val)} value={val}>
              {lab}
            </option>
          );
        })}
      </select>
    </label>
  );
}
