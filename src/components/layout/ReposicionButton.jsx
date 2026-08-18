import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { PackageX } from "lucide-react";
import { supabase } from "../../lib/supabase";

/**
 * Botón de Reposición: qué hay que comprar.
 *
 * NO es una campana, a propósito. Antes había dos campanas idénticas pegadas en
 * el header y nadie las distinguía; la solución es que una deje de ser campana,
 * no cambiarla por otra campana con un punto.
 *
 * Recibe `count` por prop: el shell llama a useReposicionCount una sola vez y
 * lo reparte entre este botón y el bottom nav.
 */
const TABS = [
  { key: "reponer", label: "Reponer" },
  { key: "faltantes", label: "Se vende y no hay" },
];

export default function ReposicionButton({ count, perfil, mobile = false }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("reponer");
  const [datos, setDatos] = useState({ reponer: null, faltantes: null });
  const [totalFaltantes, setTotalFaltantes] = useState(null);
  const ref = useRef(null);

  const esAdmin = perfil?.rol === "Admin";
  const sede = perfil?.sede_id;

  const cargar = useCallback(
    async (cual) => {
      const porSede = (q) => (!esAdmin && sede ? q.eq("sede_id", sede) : q);

      if (cual === "reponer") {
        const { data, error } = await porSede(
          supabase
            .from("v_sugerencias_reorden")
            .select(
              "producto_id, referencia, nombre, clasificacion, sede_id, sede_nombre, cantidad_sugerida",
            )
            .order("clasificacion", { ascending: true })
            .order("cantidad_sugerida", { ascending: false })
            .limit(8),
        );
        if (!error) setDatos((d) => ({ ...d, reponer: data ?? [] }));
        return;
      }

      const { data, error } = await porSede(
        supabase
          .from("v_faltantes_con_demanda")
          .select(
            "producto_id, referencia, nombre, sede_id, sede_nombre, ventas_90d, unidades_90d",
          )
          .order("ventas_90d", { ascending: false })
          .limit(8),
      );
      if (!error) setDatos((d) => ({ ...d, faltantes: data ?? [] }));

      const { count: c, error: e2 } = await porSede(
        supabase
          .from("v_faltantes_con_demanda")
          .select("producto_id", { count: "exact", head: true }),
      );
      if (!e2) setTotalFaltantes(c ?? 0);
    },
    [esAdmin, sede],
  );

  useEffect(() => {
    if (!open) return;
    // Carga perezosa al abrir o cambiar de pestaña: `cargar` es async y el
    // setState ocurre después del await, no en el cuerpo del efecto.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (datos[tab] === null) cargar(tab);
  }, [open, tab, datos, cargar]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const verTodo = () => {
    setOpen(false);
    if (esAdmin) {
      navigate(tab === "reponer" ? "/admin/reorden" : "/admin/alertas");
    } else {
      navigate("/ops/inventario?estado=Agotado");
    }
  };

  const filas = datos[tab];
  const size = mobile ? "h-10 w-10" : "h-9 w-9";
  const icon = mobile ? "h-[18px] w-[18px]" : "h-4 w-4";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`focus-ring relative grid ${size} place-items-center rounded-md text-white/85 hover:bg-white/10`}
        aria-label={
          count > 0
            ? `${count} ${count === 1 ? "producto" : "productos"} por reponer`
            : "Nada por reponer"
        }
        title={
          count > 0
            ? `${count} ${count === 1 ? "producto" : "productos"} por reponer`
            : "Nada por reponer"
        }
      >
        <PackageX className={icon} strokeWidth={1.75} />
        {count > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 grid min-h-[16px] min-w-[16px] place-items-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ backgroundColor: "var(--warn-500)" }}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-[340px] overflow-hidden rounded-xl border shadow-lg"
          style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-200)" }}
        >
          <div className="flex border-b" style={{ borderColor: "var(--n-150)" }}>
            {TABS.map((t) => {
              const activo = t.key === tab;
              const n = t.key === "reponer" ? count : totalFaltantes;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className="flex-1 px-3 py-2 text-xs font-semibold"
                  style={{
                    color: activo ? "var(--p-700)" : "var(--n-500)",
                    borderBottom: activo
                      ? "2px solid var(--p-700)"
                      : "2px solid transparent",
                  }}
                >
                  {t.label}
                  {n !== null && n !== undefined ? ` (${n})` : ""}
                </button>
              );
            })}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {filas === null ? (
              <p
                className="px-3 py-6 text-center text-sm"
                style={{ color: "var(--n-500)" }}
              >
                Cargando…
              </p>
            ) : filas.length === 0 ? (
              <p
                className="px-3 py-6 text-center text-sm"
                style={{ color: "var(--n-500)" }}
              >
                {tab === "reponer"
                  ? "Nada por reponer"
                  : "Nada agotado que se esté vendiendo"}
              </p>
            ) : (
              filas.map((f) => (
                <button
                  key={`${f.producto_id}-${f.sede_id}`}
                  onClick={() => {
                    setOpen(false);
                    navigate(`/ops/inventario/${f.producto_id}`);
                  }}
                  className="block w-full border-b px-3 py-2.5 text-left last:border-b-0"
                  style={{
                    borderColor: "var(--n-100)",
                    backgroundColor: "var(--n-0)",
                  }}
                >
                  <p
                    className="truncate text-[13px] font-semibold"
                    style={{ color: "var(--n-950)" }}
                  >
                    {f.nombre}
                  </p>
                  <p className="text-xs" style={{ color: "var(--n-700)" }}>
                    {f.referencia} · {f.sede_nombre ?? f.sede_id} ·{" "}
                    {tab === "reponer"
                      ? `pedir ${f.cantidad_sugerida}`
                      : `${f.ventas_90d} ventas en 90 días`}
                  </p>
                </button>
              ))
            )}
          </div>

          <button
            onClick={verTodo}
            className="w-full border-t px-3 py-2.5 text-center text-xs font-medium"
            style={{ borderColor: "var(--n-150)", color: "var(--p-700)" }}
          >
            Ver todo
          </button>
        </div>
      )}
    </div>
  );
}
