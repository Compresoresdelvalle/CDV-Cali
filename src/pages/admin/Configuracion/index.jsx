import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import PageHeader from "../../../components/layout/PageHeader";
import CuentasBancarias from "./CuentasBancarias";
import ChecklistOT from "./ChecklistOT";
import Parametros from "./Parametros";

const TABS = [
  { id: "cuentas", label: "Cuentas Bancarias", icon: "🏦" },
  { id: "checklist", label: "Checklist OT", icon: "📋" },
  { id: "parametros", label: "Parámetros", icon: "⚙️" },
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

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Configuración"
        description="Cuentas bancarias, parámetros del sistema y catálogo de checklist OT"
      />

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className="px-4 py-2.5 rounded-lg text-sm font-medium border cursor-pointer whitespace-nowrap min-h-[48px]"
              style={{
                backgroundColor: active
                  ? "hsl(var(--primary))"
                  : "hsl(var(--card))",
                color: active
                  ? "hsl(var(--primary-foreground))"
                  : "hsl(var(--foreground))",
                borderColor: active
                  ? "hsl(var(--primary))"
                  : "hsl(var(--border))",
              }}
            >
              <span className="mr-2">{t.icon}</span>
              {t.label}
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
