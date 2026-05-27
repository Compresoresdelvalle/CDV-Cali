import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { CreditCard, ClipboardList, Sliders } from "lucide-react";
import { supabase } from "../../../lib/supabase";
import CuentasBancarias from "./CuentasBancarias";
import ChecklistOT from "./ChecklistOT";
import Parametros from "./Parametros";

const TABS = [
  {
    id: "cuentas",
    label: "Cuentas bancarias",
    icon: CreditCard,
    desc: "Cuentas para recaudo y datos de pago en cotizaciones",
  },
  {
    id: "checklist",
    label: "Checklist OT",
    icon: ClipboardList,
    desc: "Catálogo oficial de recepción de equipos en Órdenes de Trabajo",
  },
  {
    id: "parametros",
    label: "Parámetros del sistema",
    icon: Sliders,
    desc: "Defaults globales que se propagan en tiempo real a documentos nuevos",
  },
];
const TAB_IDS = TABS.map((t) => t.id);

export default function Configuracion() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = searchParams.get("tab");
  const [tab, setTab] = useState(
    TAB_IDS.includes(initial) ? initial : "cuentas",
  );

  // Sincroniza tab activo con la URL (deep-link compartible)
  useEffect(() => {
    if (searchParams.get("tab") !== tab) {
      const next = new URLSearchParams(searchParams);
      next.set("tab", tab);
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Conteos para los badges de cada tab (read-only, replican el diseño
  // Lovable: "4", "24 ítems"). Usa COUNT en cabecera (head:true) — sin filas.
  const [counts, setCounts] = useState({
    cuentas: null,
    checklist: null,
  });
  useEffect(() => {
    let activo = true;
    Promise.all([
      supabase
        .from("cuentas_bancarias")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("checklist_componentes")
        .select("id", { count: "exact", head: true }),
    ])
      .then(([c, k]) => {
        if (!activo) return;
        setCounts({
          cuentas: c.error ? null : (c.count ?? 0),
          checklist: k.error ? null : (k.count ?? 0),
        });
      })
      .catch(() => {
        /* Badge es decorativo: si falla, simplemente no se muestra. */
      });
    return () => {
      activo = false;
    };
  }, []);

  const badgeFor = (id) => {
    if (id === "cuentas" && counts.cuentas != null)
      return String(counts.cuentas);
    if (id === "checklist" && counts.checklist != null)
      return `${counts.checklist} ítems`;
    return null;
  };

  const activa = TABS.find((t) => t.id === tab);

  return (
    <div className="flex flex-col gap-6 px-5 pb-8 pt-6 sm:px-7 animate-fade-in">
      {/* Page head */}
      <div>
        <p
          className="m-0 mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Admin · Configuración
        </p>
        <h1
          className="m-0 text-[24px] font-semibold leading-tight tracking-[-0.018em]"
          style={{ color: "hsl(var(--foreground))" }}
        >
          Configuración del sistema
        </h1>
        <p
          className="mt-1 text-[13px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {activa?.desc}
        </p>
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 overflow-x-auto border-b"
        role="tablist"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          const Icon = t.icon;
          const badge = badgeFor(t.id);
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className="inline-flex min-h-[48px] items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-[13px] transition-colors cursor-pointer"
              style={{
                borderColor: active ? "hsl(var(--primary))" : "transparent",
                color: active
                  ? "hsl(var(--foreground))"
                  : "hsl(var(--muted-foreground))",
                fontWeight: active ? 600 : 500,
              }}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              {t.label}
              {badge && (
                <span
                  className="rounded-full px-1.5 py-0.5 font-mono text-[10.5px] font-medium tabular-nums"
                  style={{
                    backgroundColor: "hsl(var(--muted) / 0.5)",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {tab === "cuentas" && <CuentasBancarias />}
        {tab === "checklist" && <ChecklistOT />}
        {tab === "parametros" && <Parametros />}
      </div>
    </div>
  );
}
