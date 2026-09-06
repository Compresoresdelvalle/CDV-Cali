import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import { avisarOk, avisarError } from "../../lib/notify";
import { agruparEgresos } from "../../lib/panel-egresos";

/**
 * Bandeja de egresos sin clasificar.
 *
 * Son 465 movimientos con el concepto en texto libre y revuelto. Uno por uno no
 * lo hace nadie, así que la pantalla agrupa por concepto parecido para poder
 * marcar veinte de un golpe: sobre los datos reales, 20 grupos cubren 309 de
 * los 465 movimientos.
 *
 * El agrupado es solo ayuda visual. NO asigna categoría sola: un "PIDIO PLATA"
 * únicamente lo puede clasificar quien sabe qué fue.
 */
export default function ClasificarEgresos() {
  const [cats, setCats] = useState([]);
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [marcadas, setMarcadas] = useState(() => new Set());
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorMsg("");
    try {
      const [c, e] = await Promise.all([
        supabase
          .from("categorias_gasto")
          .select("id, nombre, afecta_resultado")
          .eq("activa", true)
          .order("orden"),
        supabase
          .from("compras")
          .select("id, numero, fecha, concepto, total, proveedor")
          .eq("es_caja_menor", true)
          .neq("estado", "cancelada")
          .is("categoria_gasto_id", null)
          .order("fecha", { ascending: false })
          .limit(500),
      ]);
      if (c.error) throw c.error;
      if (e.error) throw e.error;
      setCats(c.data ?? []);
      setFilas(e.data ?? []);
      setMarcadas(new Set());
    } catch (err) {
      setErrorMsg(safeError(err, "No se pudieron cargar los egresos"));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const grupos = useMemo(() => agruparEgresos(filas), [filas]);

  const alternar = (id) =>
    setMarcadas((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  const marcarGrupo = (items) =>
    setMarcadas((prev) => {
      const s = new Set(prev);
      const todas = items.every((i) => s.has(i.id));
      for (const i of items) {
        if (todas) s.delete(i.id);
        else s.add(i.id);
      }
      return s;
    });

  const asignar = async (categoriaId) => {
    if (marcadas.size === 0 || guardando) return;
    setGuardando(true);
    try {
      const { data, error } = await supabase.rpc("fn_clasificar_egresos", {
        p_ids: [...marcadas],
        p_categoria_id: categoriaId,
      });
      if (error) throw error;
      avisarOk(
        `${data} egreso${data === 1 ? "" : "s"} clasificado${data === 1 ? "" : "s"}`,
      );
      await cargar();
    } catch (err) {
      avisarError(err, "No se pudo clasificar");
    } finally {
      setGuardando(false);
    }
  };

  const pendientes = filas.length;
  const montoPendiente = filas.reduce((s, f) => s + Number(f.total ?? 0), 0);

  return (
    <div
      className="animate-fade-in space-y-4 p-4 sm:p-6"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <div>
        <h1
          className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
          style={{ color: "hsl(var(--foreground))" }}
        >
          Clasificar egresos
        </h1>
        <p
          className="mt-1.5 text-[13px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {cargando
            ? "Cargando…"
            : pendientes === 0
              ? "No queda nada por clasificar. El resultado del panel está completo."
              : `Faltan ${pendientes} egresos por ${formatCOP(montoPendiente)}. Mientras no se clasifiquen, el Resultado del panel los reporta como margen de error.`}
        </p>
        {!cargando && pendientes > 0 && (
          <p
            className="mt-1 text-[12px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Van de mayor a menor monto: clasificar los de arriba es lo que más
            baja ese margen de error.
          </p>
        )}
      </div>

      {errorMsg && (
        <div className="space-y-2">
          <p
            className="text-[13px]"
            style={{ color: "hsl(var(--destructive))" }}
          >
            {errorMsg}
          </p>
          <button
            type="button"
            onClick={cargar}
            className="rounded-lg border px-3 text-[12.5px] font-medium"
            style={{
              minHeight: 48,
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Barra de acción: aparece solo cuando hay algo marcado, para no ocupar
          espacio ni invitar a pulsar sin haber elegido nada. */}
      {marcadas.size > 0 && (
        <div
          className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border p-3"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--primary))",
          }}
        >
          <span
            className="text-[13px] font-medium"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {marcadas.size} marcado{marcadas.size === 1 ? "" : "s"} →
          </span>
          {cats.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={guardando}
              onClick={() => asignar(c.id)}
              className="rounded-lg border px-3 text-[12.5px] font-medium disabled:opacity-50"
              style={{
                minHeight: 48,
                borderColor: c.afecta_resultado
                  ? "hsl(var(--border))"
                  : "hsl(var(--warning))",
                color: "hsl(var(--foreground))",
              }}
              title={
                c.afecta_resultado
                  ? "Resta del resultado"
                  : "NO resta del resultado: no es un gasto del periodo"
              }
            >
              {c.nombre}
              {!c.afecta_resultado && " · no es gasto"}
            </button>
          ))}
        </div>
      )}

      {grupos.map((g) => (
        <div
          key={g.clave}
          className="overflow-hidden rounded-xl border"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          <button
            type="button"
            onClick={() => marcarGrupo(g.items)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            style={{
              minHeight: 48,
              backgroundColor: "hsl(var(--muted) / 0.3)",
            }}
          >
            <span
              className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {g.clave} · {g.items.length}
              {g.items.length === 1 ? " movimiento" : " movimientos"}
            </span>
            <span
              className="shrink-0 text-[13px] font-semibold tabular-nums"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {formatCOP(g.monto)}
            </span>
          </button>
          <ul>
            {g.items.map((i) => (
              <li
                key={i.id}
                className="flex items-center gap-3 border-t px-4 py-2"
                style={{ borderColor: "hsl(var(--border))" }}
              >
                <input
                  type="checkbox"
                  checked={marcadas.has(i.id)}
                  onChange={() => alternar(i.id)}
                  className="h-4 w-4 shrink-0 cursor-pointer"
                  aria-label={`Marcar egreso ${i.numero}`}
                />
                <span
                  className="w-24 shrink-0 text-[12px] tabular-nums"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {formatDate(i.fecha)}
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-[13px]"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {i.concepto || i.proveedor || "—"}
                </span>
                <span
                  className="shrink-0 text-[13px] tabular-nums"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {formatCOP(i.total)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
