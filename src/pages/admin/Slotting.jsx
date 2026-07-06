import { useState, useEffect, useRef, useMemo } from "react";
import { ArrowRight, Map, Package, Check } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { safeError } from "../../lib/utils";
import { useAuthStore } from "../../stores/authStore";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import UbicacionChip from "../../components/ui/UbicacionChip";
import { pillStyle } from "../../lib/admin-ops-ui";
import { SEDE_LABELS, sedeLabel } from "../../lib/traspasos-ui";

const TODAS_SEDES = "Todas";

/* ── Slotting · sugerencias de reubicación por rotación (Bloque D2) ────── */
export default function Slotting() {
  const perfil = useAuthStore((s) => s.perfil);
  const puedeAplicar = perfil?.rol === "Admin" || perfil?.rol === "Bodeguero";
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [sedeFiltro, setSedeFiltro] = useState(TODAS_SEDES);
  const [aplicando, setAplicando] = useState(null);
  const [aplicandoLote, setAplicandoLote] = useState(false);
  const [seleccion, setSeleccion] = useState(new Set());
  const mountedRef = useRef(true);
  const { confirm, ConfirmDialog } = useConfirm();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cargar = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const { data, error } = await supabase.rpc("fn_slotting_sugerencias");
      if (!mountedRef.current) return;
      if (error) throw error;
      setItems(data ?? []);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar sugerencias de slotting"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  const keyOf = (i) => `${i.producto_id}-${i.sede_id}`;

  const sedes = useMemo(() => {
    const set = new Set(items.map((i) => i.sede_id));
    return [TODAS_SEDES, ...[...set].sort()];
  }, [items]);

  const filtrados = useMemo(
    () =>
      sedeFiltro === TODAS_SEDES
        ? items
        : items.filter((i) => i.sede_id === sedeFiltro),
    [items, sedeFiltro],
  );

  const toggle = (id) =>
    setSeleccion((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const todosVisiblesOn =
    filtrados.length > 0 && filtrados.every((i) => seleccion.has(keyOf(i)));
  const algunoOn = filtrados.some((i) => seleccion.has(keyOf(i)));

  const toggleTodos = () =>
    setSeleccion((prev) => {
      const next = new Set(prev);
      const ids = filtrados.map(keyOf);
      if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });

  // Solo se aplican los seleccionados VISIBLES: si el filtro de sede oculta
  // algo marcado, no debe aplicarse a ciegas (mismo criterio que Reorden).
  const seleccionados = filtrados.filter((i) => seleccion.has(keyOf(i)));

  const aplicar = async (item) => {
    const mensaje = item.ubicacion_actual
      ? `Se moverá "${item.nombre}" de ${item.ubicacion_actual} a ${item.ubicacion_sugerida} en ${sedeLabel(item.sede_id)}.`
      : `Se asignará "${item.nombre}" a ${item.ubicacion_sugerida} en ${sedeLabel(item.sede_id)}.`;
    const ok = await confirm({
      titulo: "Aplicar sugerencia de ubicación",
      mensaje,
      confirmLabel: "Aplicar",
    });
    if (!ok) return;
    setAplicando(keyOf(item));
    setErrorMsg("");
    try {
      const { error } = await supabase.rpc("fn_asignar_ubicacion", {
        p_producto_id: item.producto_id,
        p_sede_id: item.sede_id,
        p_ubicacion_id: item.ubicacion_sugerida,
      });
      if (error) throw error;
      if (!mountedRef.current) return;
      setItems((prev) => prev.filter((i) => keyOf(i) !== keyOf(item)));
      setSeleccion((prev) => {
        const next = new Set(prev);
        next.delete(keyOf(item));
        return next;
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al aplicar la sugerencia"));
    } finally {
      if (mountedRef.current) setAplicando(null);
    }
  };

  const aplicarSeleccionadas = async () => {
    if (seleccionados.length === 0) return;
    const ok = await confirm({
      titulo: "Aplicar ubicaciones seleccionadas",
      mensaje: `Se actualizará la ubicación de ${seleccionados.length} ${
        seleccionados.length === 1 ? "producto" : "productos"
      }.`,
      confirmLabel: "Aplicar seleccionadas",
    });
    if (!ok) return;
    setAplicandoLote(true);
    setErrorMsg("");
    try {
      const payload = seleccionados.map((i) => ({
        producto_id: i.producto_id,
        sede_id: i.sede_id,
        ubicacion_id: i.ubicacion_sugerida,
      }));
      const { error } = await supabase.rpc("fn_aplicar_slotting_lote", {
        p_items: payload,
      });
      if (error) throw error;
      if (!mountedRef.current) return;
      const aplicadosKeys = new Set(seleccionados.map(keyOf));
      setItems((prev) => prev.filter((i) => !aplicadosKeys.has(keyOf(i))));
      setSeleccion(new Set());
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al aplicar las ubicaciones"));
    } finally {
      if (mountedRef.current) setAplicandoLote(false);
    }
  };

  const ACCION_UI = {
    subir: { label: "Subir", token: "--warning" },
    bajar: { label: "Bajar", token: "--muted-foreground" },
    asignar: { label: "Asignar ubicación", token: "--info" },
  };

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1
            className="m-0 flex items-center gap-2 text-[22px] font-semibold leading-tight tracking-[-0.018em]"
            style={{ color: "hsl(var(--foreground))" }}
          >
            <Map className="h-5 w-5" strokeWidth={1.75} />
            Slotting · Optimización de ubicaciones
          </h1>
          {!loading && items.length > 0 && (
            <span
              className="rounded-[3px] border px-1.5 py-px font-mono text-[11px] font-semibold"
              style={pillStyle("--warning")}
            >
              {items.length} sugerencias
            </span>
          )}
        </div>
        <p
          className="mt-1.5 max-w-2xl text-[12.5px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Compara la rotación real de cada producto (demanda de los últimos 90
          días) contra su puesto físico actual. Sugiere acercar a la puerta lo
          que más se mueve, sacar de las zonas premium lo que no rota, y{" "}
          <strong>asignar una ubicación inicial</strong> a los productos que
          todavía no tienen ninguna.
        </p>
      </div>

      {errorMsg && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.4)",
            color: "hsl(var(--destructive))",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Filtro por sede */}
      {!loading && sedes.length > 2 && (
        <div className="flex flex-wrap items-center gap-2">
          <Seg
            options={sedes}
            value={sedeFiltro}
            onChange={setSedeFiltro}
            labelOf={(s) => (s === TODAS_SEDES ? "Todas" : sedeLabel(s))}
          />
        </div>
      )}

      {/* Barra de selección en lote: con potencialmente cientos de
          sugerencias, aplicar una por una no es práctico. */}
      {!loading && puedeAplicar && filtrados.length > 0 && algunoOn && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5"
          style={{
            backgroundColor: "hsl(var(--primary) / 0.06)",
            borderColor: "hsl(var(--primary) / 0.3)",
          }}
        >
          <span
            className="text-[12.5px] font-medium"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {seleccionados.length}{" "}
            {seleccionados.length === 1
              ? "sugerencia seleccionada"
              : "sugerencias seleccionadas"}
          </span>
          <button
            onClick={aplicarSeleccionadas}
            disabled={aplicandoLote}
            className="inline-flex h-10 items-center gap-1.5 rounded-md px-3.5 text-[12.5px] font-semibold transition-opacity cursor-pointer hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
            {aplicandoLote ? "Aplicando…" : "Aplicar seleccionadas"}
          </button>
        </div>
      )}

      <ConfirmDialog />

      {loading ? (
        <SkeletonList />
      ) : filtrados.length === 0 ? (
        <Empty icon="📦">
          Sin sugerencias de reubicación por ahora. Los productos están bien
          ubicados según su rotación.
        </Empty>
      ) : (
        <section
          className="overflow-hidden rounded-xl border"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          {/* Desktop tabla */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr
                  className="border-b"
                  style={{
                    borderColor: "hsl(var(--border))",
                    backgroundColor: "hsl(var(--muted) / 0.3)",
                  }}
                >
                  {puedeAplicar && (
                    <th className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={todosVisiblesOn}
                        ref={(el) => {
                          if (el)
                            el.indeterminate = algunoOn && !todosVisiblesOn;
                        }}
                        onChange={toggleTodos}
                        className="h-4 w-4 cursor-pointer"
                        aria-label="Seleccionar todas las visibles"
                      />
                    </th>
                  )}
                  {[
                    "Producto",
                    "Sede",
                    "Demanda 90d",
                    "Actual → Sugerida",
                    "Acción",
                    "Motivo",
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left font-mono text-[10.5px] uppercase tracking-[0.06em]"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtrados.map((i) => {
                  const acc = ACCION_UI[i.accion] ?? ACCION_UI.asignar;
                  return (
                    <tr
                      key={keyOf(i)}
                      className="border-b last:border-b-0"
                      style={{ borderColor: "hsl(var(--border))" }}
                    >
                      {puedeAplicar && (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={seleccion.has(keyOf(i))}
                            onChange={() => toggle(keyOf(i))}
                            className="h-4 w-4 cursor-pointer"
                            aria-label={`Seleccionar ${i.nombre}`}
                          />
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Package
                            className="h-3.5 w-3.5 shrink-0"
                            strokeWidth={1.5}
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          />
                          <div className="min-w-0">
                            <p
                              className="truncate text-sm font-medium"
                              style={{ color: "hsl(var(--foreground))" }}
                            >
                              {i.nombre}
                            </p>
                            <p
                              className="truncate font-mono text-[10.5px]"
                              style={{ color: "hsl(var(--muted-foreground))" }}
                            >
                              {i.referencia}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td
                        className="px-4 py-3 text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {SEDE_LABELS[i.sede_id] ?? i.sede_id}
                      </td>
                      <td
                        className="px-4 py-3 text-right font-mono text-sm tabular-nums"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {i.demanda_90d}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {i.ubicacion_actual ? (
                            <UbicacionChip codigo={i.ubicacion_actual} />
                          ) : (
                            <span
                              className="text-[11px] italic"
                              style={{ color: "hsl(var(--muted-foreground))" }}
                            >
                              Sin ubicación
                            </span>
                          )}
                          <ArrowRight
                            className="h-3.5 w-3.5 shrink-0"
                            strokeWidth={2}
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          />
                          <UbicacionChip
                            codigo={i.ubicacion_sugerida}
                            conMapa
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-flex items-center rounded-[4px] border px-1.5 py-0.5 text-[11px] font-semibold leading-snug"
                          style={pillStyle(acc.token)}
                        >
                          {acc.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-flex max-w-[220px] items-center rounded-[4px] border px-1.5 py-0.5 text-[11px] font-medium leading-snug"
                          style={pillStyle("--muted-foreground")}
                        >
                          {i.motivo}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {puedeAplicar && (
                          <button
                            onClick={() => aplicar(i)}
                            disabled={aplicando === keyOf(i)}
                            className="inline-flex h-11 items-center gap-1.5 rounded-md px-3.5 text-[12.5px] font-semibold transition-opacity cursor-pointer hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                            style={{
                              backgroundColor: "hsl(var(--primary))",
                              color: "hsl(var(--primary-foreground))",
                            }}
                          >
                            <Check className="h-3.5 w-3.5" strokeWidth={2} />
                            Aplicar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="md:hidden divide-y" role="list">
            {filtrados.map((i) => {
              const acc = ACCION_UI[i.accion] ?? ACCION_UI.asignar;
              return (
                <li
                  key={keyOf(i)}
                  className="p-4"
                  style={{ borderColor: "hsl(var(--border))" }}
                >
                  <div className="mb-2 flex items-start gap-2">
                    {puedeAplicar && (
                      <input
                        type="checkbox"
                        checked={seleccion.has(keyOf(i))}
                        onChange={() => toggle(keyOf(i))}
                        className="mt-1 h-4 w-4 shrink-0 cursor-pointer"
                        aria-label={`Seleccionar ${i.nombre}`}
                      />
                    )}
                    <div className="min-w-0">
                      <p
                        className="truncate text-sm font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {i.nombre}
                      </p>
                      <p
                        className="truncate font-mono text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {i.referencia} · {SEDE_LABELS[i.sede_id] ?? i.sede_id}
                      </p>
                    </div>
                  </div>
                  <div className="mb-2 flex items-center gap-1.5">
                    {i.ubicacion_actual ? (
                      <UbicacionChip codigo={i.ubicacion_actual} />
                    ) : (
                      <span
                        className="text-[11px] italic"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        Sin ubicación
                      </span>
                    )}
                    <ArrowRight
                      className="h-3.5 w-3.5 shrink-0"
                      strokeWidth={2}
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    />
                    <UbicacionChip codigo={i.ubicacion_sugerida} conMapa />
                    <span
                      className="ml-auto font-mono text-xs tabular-nums"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {i.demanda_90d} · 90d
                    </span>
                  </div>
                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    <span
                      className="inline-flex items-center rounded-[4px] border px-1.5 py-0.5 text-[11px] font-semibold leading-snug"
                      style={pillStyle(acc.token)}
                    >
                      {acc.label}
                    </span>
                    <span
                      className="inline-flex max-w-full items-center rounded-[4px] border px-1.5 py-0.5 text-[11px] font-medium leading-snug"
                      style={pillStyle("--muted-foreground")}
                    >
                      {i.motivo}
                    </span>
                  </div>
                  {puedeAplicar && (
                    <button
                      onClick={() => aplicar(i)}
                      disabled={aplicando === keyOf(i)}
                      className="flex h-12 w-full items-center justify-center gap-1.5 rounded-md text-[13px] font-semibold transition-opacity cursor-pointer hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      style={{
                        backgroundColor: "hsl(var(--primary))",
                        color: "hsl(var(--primary-foreground))",
                      }}
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={2} />
                      Aplicar sugerencia
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ── Segmented control (estilo Dashboard admin) ───────────────────────── */
function Seg({ options, value, onChange, labelOf }) {
  return (
    <div
      className="inline-flex flex-wrap gap-px rounded-[7px] border p-0.5"
      style={{
        borderColor: "hsl(var(--border))",
        backgroundColor: "hsl(var(--muted) / 0.4)",
      }}
    >
      {options.map((opt) => {
        const on = opt === value;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className="rounded-[5px] px-2.5 py-1.5 text-[12px] transition-colors cursor-pointer"
            style={{
              backgroundColor: on ? "hsl(var(--card))" : "transparent",
              color: on
                ? "hsl(var(--foreground))"
                : "hsl(var(--muted-foreground))",
              fontWeight: on ? 600 : 500,
              boxShadow: on ? "0 1px 2px rgba(16,24,40,0.06)" : "none",
            }}
          >
            {labelOf ? labelOf(opt) : opt}
          </button>
        );
      })}
    </div>
  );
}

function Empty({ icon, children }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-5xl mb-3">{icon}</div>
      <p className="max-w-md" style={{ color: "hsl(var(--muted-foreground))" }}>
        {children}
      </p>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-xl border"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        />
      ))}
    </div>
  );
}
