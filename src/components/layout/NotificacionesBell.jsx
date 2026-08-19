import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { formatDate } from "../../lib/utils";

/**
 * Campana de notificaciones. Presentacional: el estado vive en
 * `useNotificaciones`, que el shell llama UNA vez y reparte a las dos
 * instancias (escritorio y móvil se montan las dos, solo se ocultan por CSS).
 */

/**
 * A dónde lleva cada aviso. Devuelve null si no hay destino razonable, y en ese
 * caso la tarjeta se pinta como no pulsable.
 *
 * Los respaldos importan: de 841 conversiones solo 1 trae `fecha` (las 840
 * heredadas son de la función vieja), pero 840 sí traen `producto_id`.
 */
function rutaDe(n, rol) {
  const d = n?.data ?? {};
  switch (n?.tipo) {
    case "traspaso_en_camino":
      return d.traspaso_id ? `/ops/traspasos/${d.traspaso_id}` : null;
    case "ensamble_creado":
      return d.ensamble_id ? `/ops/ensambles/${d.ensamble_id}` : null;
    case "conversion_insumo":
      // /admin/* está tras RoleGuard de Admin y redirige mudo a /ops: a los
      // demás roles se les manda al producto, que es lo que sí pueden ver.
      if (rol === "Admin" && d.sede_id && d.fecha) {
        return `/admin/auditoria?tipo=conversion_a_insumo&sede=${encodeURIComponent(d.sede_id)}&desde=${d.fecha}&hasta=${d.fecha}`;
      }
      return d.producto_id ? `/ops/inventario/${d.producto_id}` : null;
    case "costo_revisar":
      if (d.producto_id) return `/ops/inventario/${d.producto_id}`;
      // Esta variante guarda `referencias`, no un id. Inventario ya lee ?q=.
      return Array.isArray(d.referencias) && d.referencias[0]
        ? `/ops/inventario?q=${encodeURIComponent(d.referencias[0])}`
        : null;
    default:
      return null;
  }
}

export default function NotificacionesBell({
  items,
  noLeidas,
  error,
  perfil,
  onMarcarUna,
  onMarcarTodas,
  onAbrir,
  mobile = false,
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const abrir = () => {
    const next = !open;
    setOpen(next);
    if (next) onAbrir?.();
  };

  const alHacerClic = (n) => {
    const destino = rutaDe(n, perfil?.rol);
    if (!n.leida) onMarcarUna(n.id);
    if (destino) {
      setOpen(false);
      navigate(destino);
    }
  };

  const size = mobile ? "h-10 w-10" : "h-9 w-9";
  const icon = mobile ? "h-[18px] w-[18px]" : "h-4 w-4";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={abrir}
        className={`focus-ring relative grid ${size} shrink-0 place-items-center rounded-md text-white/85 hover:bg-white/10`}
        aria-label={
          noLeidas > 0
            ? `${noLeidas} notificaciones sin leer`
            : "Notificaciones"
        }
        aria-expanded={open}
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
          className="fixed inset-x-2 top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)] z-50 overflow-hidden rounded-xl border shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[340px]"
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
                onClick={onMarcarTodas}
                className="-mx-2 rounded px-2 py-2 text-xs font-medium"
                style={{ color: "var(--p-700)" }}
              >
                Marcar todas leídas
              </button>
            )}
          </div>
          <div className="max-h-[min(20rem,60vh)] overflow-y-auto">
            {error ? (
              <p
                className="px-3 py-6 text-center text-sm"
                style={{ color: "var(--dang-600)" }}
              >
                No se pudieron cargar las notificaciones: {error}
              </p>
            ) : items.length === 0 ? (
              <p
                className="px-3 py-6 text-center text-sm"
                style={{ color: "var(--n-500)" }}
              >
                Sin notificaciones
              </p>
            ) : (
              items.map((n) => {
                const destino = rutaDe(n, perfil?.rol);
                const contenido = (
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
                );
                const estilo = {
                  borderColor: "var(--n-100)",
                  backgroundColor: n.leida
                    ? "var(--n-0)"
                    : "var(--info-50, #eff6ff)",
                };
                // Sin destino no se pinta como botón: un botón que no lleva a
                // ninguna parte se lee como roto.
                return destino ? (
                  <button
                    key={n.id}
                    onClick={() => alHacerClic(n)}
                    className="block w-full border-b px-3 py-2.5 text-left last:border-b-0"
                    style={estilo}
                  >
                    {contenido}
                  </button>
                ) : (
                  <div
                    key={n.id}
                    onClick={() => !n.leida && onMarcarUna(n.id)}
                    className="block w-full border-b px-3 py-2.5 text-left last:border-b-0"
                    style={estilo}
                  >
                    {contenido}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
