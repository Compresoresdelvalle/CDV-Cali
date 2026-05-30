import { useState, useEffect, useCallback, useRef } from "react";
import { BellDot } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatDate } from "../../lib/utils";

/**
 * Campana de notificaciones in-app para el Admin (tabla `notificaciones`).
 * Muestra las dirigidas al rol del usuario (RLS las filtra), con badge de no
 * leídas y un panel para leerlas / marcarlas leídas.
 *
 * Origen: alertas de conversión a insumo (Parte 1) y, a futuro, ensambles
 * creados, etc. Distinta del Bell de "/admin/alertas" (alertas de OT).
 */
export default function NotificacionesBell() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from("notificaciones")
      .select("id, tipo, titulo, mensaje, leida, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    setItems(data ?? []);
  }, []);

  useEffect(() => {
    let alive = true;
    supabase
      .from("notificaciones")
      .select("id, tipo, titulo, mensaje, leida, created_at")
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (alive) setItems(data ?? []);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Cerrar al hacer clic fuera.
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const noLeidas = items.filter((n) => !n.leida).length;

  const abrir = async () => {
    const next = !open;
    setOpen(next);
    if (next) await cargar();
  };

  const marcarLeida = async (id) => {
    setItems((rows) =>
      rows.map((n) => (n.id === id ? { ...n, leida: true } : n)),
    );
    await supabase.from("notificaciones").update({ leida: true }).eq("id", id);
  };

  const marcarTodas = async () => {
    const ids = items.filter((n) => !n.leida).map((n) => n.id);
    if (ids.length === 0) return;
    setItems((rows) => rows.map((n) => ({ ...n, leida: true })));
    await supabase.from("notificaciones").update({ leida: true }).in("id", ids);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={abrir}
        className="focus-ring relative grid h-9 w-9 place-items-center rounded-md text-white/85 hover:bg-white/10"
        aria-label="Notificaciones"
        title="Notificaciones"
      >
        <BellDot className="h-4 w-4" strokeWidth={1.75} />
        {noLeidas > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 grid min-h-[16px] min-w-[16px] place-items-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ backgroundColor: "var(--dang-600, #dc2626)" }}
          >
            {noLeidas > 9 ? "9+" : noLeidas}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-[340px] overflow-hidden rounded-xl border shadow-lg"
          style={{
            backgroundColor: "var(--n-0)",
            borderColor: "var(--n-200)",
          }}
        >
          <div
            className="flex items-center justify-between border-b px-3 py-2"
            style={{ borderColor: "var(--n-150)" }}
          >
            <span
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--n-500)" }}
            >
              Notificaciones
            </span>
            {noLeidas > 0 && (
              <button
                onClick={marcarTodas}
                className="text-xs font-medium"
                style={{ color: "var(--p-700)" }}
              >
                Marcar todas leídas
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p
                className="px-3 py-6 text-center text-sm"
                style={{ color: "var(--n-500)" }}
              >
                Sin notificaciones
              </p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => !n.leida && marcarLeida(n.id)}
                  className="block w-full border-b px-3 py-2.5 text-left last:border-b-0"
                  style={{
                    borderColor: "var(--n-100)",
                    backgroundColor: n.leida
                      ? "var(--n-0)"
                      : "var(--info-50, #eff6ff)",
                  }}
                >
                  <div className="flex items-start gap-2">
                    {!n.leida && (
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: "var(--info-500, #0ea5c9)" }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[13px] font-semibold"
                        style={{ color: "var(--n-950)" }}
                      >
                        {n.titulo}
                      </p>
                      <p className="text-xs" style={{ color: "var(--n-700)" }}>
                        {n.mensaje}
                      </p>
                      <p
                        className="mt-0.5 text-[10.5px]"
                        style={{ color: "var(--n-500)" }}
                      >
                        {formatDate(n.created_at)}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
