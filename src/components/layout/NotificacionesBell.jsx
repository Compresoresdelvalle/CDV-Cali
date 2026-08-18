import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatDate } from "../../lib/utils";

/**
 * Campana de notificaciones in-app (tabla `notificaciones`).
 *
 * Vive en layout/ y no en admin/ porque la usan los dos shells: hasta ahora
 * solo se montaba en AdminShell, así que las 236 notificaciones de traspaso
 * dirigidas a Vendedor y Bodeguero nunca tuvieron dónde mostrarse.
 *
 * El badge se cuenta en servidor: contar los no leídos de las 30 filas
 * cargadas daba siempre 30 cuando el real era 763.
 */

/** A dónde lleva cada tipo de aviso, usando el `data` jsonb que ya viene lleno. */
function rutaDe(n) {
  const d = n?.data ?? {};
  switch (n?.tipo) {
    case "traspaso_en_camino":
      return d.traspaso_id ? `/ops/traspasos/${d.traspaso_id}` : null;
    case "ensamble_creado":
      return d.ensamble_id ? `/ops/ensambles/${d.ensamble_id}` : null;
    case "conversion_insumo":
      return d.sede_id && d.fecha
        ? `/admin/auditoria?tipo=conversion_a_insumo&sede=${encodeURIComponent(d.sede_id)}&desde=${d.fecha}&hasta=${d.fecha}`
        : null;
    case "costo_revisar":
      return d.producto_id ? `/ops/inventario/${d.producto_id}` : null;
    default:
      return null;
  }
}

const COLS = "id, tipo, titulo, mensaje, data, leida, created_at, updated_at";

export default function NotificacionesBell({ mobile = false }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Conteo en servidor, separado de las 30 filas del panel.
  const cargarConteo = useCallback(async () => {
    const { count, error } = await supabase
      .from("notificaciones")
      .select("id", { count: "exact", head: true })
      .eq("leida", false);
    // Si falla, conservar el último conteo en vez de mentir con 0.
    if (!error) setNoLeidas(count ?? 0);
  }, []);

  const cargarLista = useCallback(async () => {
    const { data, error } = await supabase
      .from("notificaciones")
      .select(COLS)
      // updated_at y no created_at: un aviso agrupado que se actualiza debe
      // subir a la cabeza de la lista, y su created_at no cambia.
      .order("updated_at", { ascending: false })
      .limit(30);
    if (!error) setItems(data ?? []);
  }, []);

  useEffect(() => {
    // Carga inicial: ambas son async y el setState ocurre tras el await, pero
    // la regla no lo distingue. Mismo patrón que useParametro.js / AppShell.jsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargarConteo();
    cargarLista();

    // Escucha INSERT y UPDATE: el agrupado de conversiones actualiza una fila
    // existente en vez de insertar, así que solo con INSERT no se vería.
    const channel = supabase
      .channel("notificaciones-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notificaciones" },
        () => {
          cargarConteo();
          cargarLista();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [cargarConteo, cargarLista]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const abrir = async () => {
    const next = !open;
    setOpen(next);
    if (next) await cargarLista();
  };

  const alHacerClic = async (n) => {
    const destino = rutaDe(n);
    if (!n.leida) {
      setItems((rows) =>
        rows.map((r) => (r.id === n.id ? { ...r, leida: true } : r)),
      );
      setNoLeidas((c) => Math.max(0, c - 1));
      await supabase
        .from("notificaciones")
        .update({ leida: true })
        .eq("id", n.id);
    }
    // Si el aviso no trae la clave esperada se queda marcado leído y no se
    // navega, en vez de mandar a una ruta muerta.
    if (destino) {
      setOpen(false);
      navigate(destino);
    }
  };

  const marcarTodas = async () => {
    if (noLeidas === 0) return;
    setItems((rows) => rows.map((n) => ({ ...n, leida: true })));
    setNoLeidas(0);
    // Sin lista de ids: así barre las 763, no solo las 30 cargadas. La RLS ya
    // limita el alcance a para_rol = get_my_rol() o created_by = auth.uid().
    await supabase
      .from("notificaciones")
      .update({ leida: true })
      .eq("leida", false);
    await cargarConteo();
  };

  const size = mobile ? "h-10 w-10" : "h-9 w-9";
  const icon = mobile ? "h-[18px] w-[18px]" : "h-4 w-4";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={abrir}
        className={`focus-ring relative grid ${size} place-items-center rounded-md text-white/85 hover:bg-white/10`}
        aria-label={
          noLeidas > 0
            ? `${noLeidas} notificaciones sin leer`
            : "Notificaciones"
        }
        title="Notificaciones"
      >
        <Bell className={icon} strokeWidth={1.75} />
        {noLeidas > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 grid min-h-[16px] min-w-[16px] place-items-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ backgroundColor: "var(--dang-500)" }}
          >
            {noLeidas > 99 ? "99+" : noLeidas}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-[340px] overflow-hidden rounded-xl border shadow-lg"
          style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-200)" }}
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
                  onClick={() => alHacerClic(n)}
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
                        {formatDate(n.updated_at ?? n.created_at)}
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
