/**
 * Configuración de presentación del shell de admin (diseño Lovable).
 *
 * Porta `SECCIONES_ADMIN` de la rama `frontend-lovable` a las rutas REALES
 * que existen en `src/App.jsx` (`/admin/...`). Es solo presentación: agrupa
 * los módulos del panel admin en secciones e iconos. NO contiene lógica.
 */
import {
  LayoutDashboard,
  Bell,
  BarChart3,
  TrendingUp,
  RefreshCw,
  ClipboardCheck,
  FileBarChart,
  ClipboardList,
  Settings,
  Users,
  CreditCard,
  HandCoins,
} from "lucide-react";

/**
 * Secciones del sidebar admin → módulos con rutas reales de App.jsx.
 * @type {{ id: string, label: string, modulos: { id: string, label: string, href: string, icon: import('lucide-react').LucideIcon }[] }[]}
 */
export const SECCIONES_ADMIN = [
  {
    id: "vision",
    label: "Visión general",
    modulos: [
      {
        id: "dashboard",
        label: "Dashboard",
        href: "/admin",
        icon: LayoutDashboard,
      },
      { id: "alertas", label: "Alertas", href: "/admin/alertas", icon: Bell },
    ],
  },
  {
    id: "analisis",
    label: "Análisis y reportes",
    modulos: [
      {
        id: "abc",
        label: "Análisis ABC",
        href: "/admin/abc",
        icon: BarChart3,
      },
      { id: "top10", label: "Top 10", href: "/admin/top10", icon: TrendingUp },
      {
        id: "reorden",
        label: "Reorden",
        href: "/admin/reorden",
        icon: RefreshCw,
      },
      {
        id: "auditoria",
        label: "Auditoría",
        href: "/admin/auditoria",
        icon: ClipboardCheck,
      },
      {
        id: "cierres",
        label: "Cierres",
        href: "/admin/cierres",
        icon: FileBarChart,
      },
    ],
  },
  {
    id: "operacion-admin",
    label: "Operación administrativa",
    modulos: [
      {
        id: "conteo",
        label: "Conteo cíclico",
        href: "/admin/conteo",
        icon: ClipboardList,
      },
      {
        id: "notas-credito",
        label: "Notas crédito",
        href: "/admin/notas-credito",
        icon: CreditCard,
      },
      {
        id: "cuentas",
        label: "Cuentas cobrar/pagar",
        href: "/admin/cuentas",
        icon: HandCoins,
      },
      {
        id: "configuracion",
        label: "Configuración",
        href: "/admin/configuracion",
        icon: Settings,
      },
      {
        id: "usuarios",
        label: "Usuarios",
        href: "/admin/usuarios",
        icon: Users,
      },
    ],
  },
];

/** Lista plana de módulos admin (para bottom-nav móvil). */
export const MODULOS_ADMIN = SECCIONES_ADMIN.flatMap((s) => s.modulos);

/** Iniciales de un nombre para el avatar del header. */
export const getInitials = (name = "") =>
  name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
