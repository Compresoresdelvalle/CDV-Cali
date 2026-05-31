// Sedes
export const SEDES = {
  BODEGA: "BODEGA",
  CV: "CV",
  L3: "L3",
  CHV: "CHV",
};

// #13 — Cuentas bancarias donde puede entrar el pago de una venta.
// ⚠️ PROVISIONAL: reemplazar por las cuentas REALES que indique la empresa.
export const CUENTAS_BANCARIAS = [
  "Bancolombia",
  "Davivienda",
  "Nequi",
  "Daviplata",
];

// Roles
export const ROLES = {
  ADMIN: "Admin",
  BODEGUERO: "Bodeguero",
  VENDEDOR: "Vendedor",
  TECNICO: "Tecnico",
};

// Mapa de nombre → email en Supabase Auth (usuarios reales de producción).
// El nombre debe coincidir EXACTAMENTE con usuarios.nombre (la pantalla de
// login arma la lista desde la tabla usuarios).
export const EMAIL_MAP = {
  Admin: "compresorescvsas@gmail.com",
  Bodega: "ventascompresoresdelvalle@hotmail.com",
  Sofía: "compresoresdelvalle1@hotmail.com",
  Deyanira: "compresoresdelvallesas@gmail.com",
  Bladimir: "compresoresdelvallesas@hotmail.com",
  Edna: "compresorescv@hotmail.com",
  TecPrueba: "tecnico.prueba@compresoresdelvalle.com",
};

// Módulos visibles por rol (orden importa para el menú)
export const ROLE_MODULES = {
  Admin: [
    "Inventario",
    "Ventas",
    "Compras",
    "Traspasos",
    "Órdenes",
    "Ensambles",
    "Cotizaciones",
    "Garantías",
    "Recibos",
    "Herramientas",
    "Devoluciones",
    "Productos",
    "Clientes",
    "→ Panel Admin",
  ],
  Bodeguero: [
    "Inventario",
    "Compras",
    "Traspasos",
    "Ensambles",
    "Garantías",
    "Devoluciones",
    "Herramientas",
    "Productos",
  ],
  Vendedor: [
    "Inventario",
    "Traspasos",
    "Ventas",
    "Órdenes",
    "Ensambles",
    "Cotizaciones",
    "Garantías",
    "Recibos",
    "Herramientas",
    "Productos",
    "Clientes",
  ],
  Tecnico: ["Órdenes", "Ensambles", "Herramientas", "Productos"],
};

// Iconos por módulo
export const MODULE_ICONS = {
  Inventario: "📋",
  Ventas: "💰",
  Compras: "🛍️",
  Traspasos: "🔄",
  Órdenes: "⚙️",
  Ensambles: "🔩",
  Cotizaciones: "📝",
  Herramientas: "🛠️",
  Devoluciones: "↩️",
  Productos: "🏷️",
  Garantías: "🛡️",
  Recibos: "🧾",
  Clientes: "👤",
  "→ Panel Admin": "📊",
};

// Rutas por módulo (para el router)
export const MODULE_ROUTES = {
  Inventario: "/ops/inventario",
  Ventas: "/ops/ventas",
  Compras: "/ops/compras",
  Traspasos: "/ops/traspasos",
  Órdenes: "/ops/ordenes",
  Ensambles: "/ops/ensambles",
  Cotizaciones: "/ops/cotizaciones",
  Herramientas: "/ops/herramientas",
  Devoluciones: "/ops/devoluciones",
  Productos: "/ops/productos",
  Garantías: "/ops/garantias",
  Recibos: "/ops/recibos",
  Clientes: "/ops/clientes",
  "→ Panel Admin": "/admin",
};

// Módulos del Panel Admin
export const ADMIN_MODULES = [
  { nombre: "Dashboard", icon: "📊", ruta: "/admin" },
  { nombre: "Cierres", icon: "🧮", ruta: "/admin/cierres" },
  { nombre: "Alertas", icon: "🔔", ruta: "/admin/alertas" },
  { nombre: "Conteo", icon: "🔢", ruta: "/admin/conteo" },
  { nombre: "Análisis ABC", icon: "📈", ruta: "/admin/abc" },
  { nombre: "Reorden", icon: "♻️", ruta: "/admin/reorden" },
  { nombre: "Auditoría", icon: "🔍", ruta: "/admin/auditoria" },
  { nombre: "Usuarios", icon: "👥", ruta: "/admin/usuarios" },
  { nombre: "Top 10", icon: "🏆", ruta: "/admin/top10" },
  { nombre: "Configuración", icon: "⚙️", ruta: "/admin/configuracion" },
  { nombre: "Notas crédito", icon: "💳", ruta: "/admin/notas-credito" },
];

// Fase 10: etiquetas de estados de OT (incluye pendiente_recogida)
export const ESTADOS_OT_LABELS = {
  abierta: "Abierta",
  en_proceso: "En proceso",
  esperando_repuesto: "Esperando repuesto",
  completada: "Completada",
  pendiente_recogida: "Pendiente de recogida",
  entregada: "Entregada",
};
