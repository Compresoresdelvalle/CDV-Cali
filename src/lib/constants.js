// Sedes
export const SEDES = {
  BOD_PRINCIPAL: "BOD-PRINCIPAL",
  ALM_01: "ALM-01",
  ALM_02: "ALM-02",
  ALM_03: "ALM-03",
};

// Roles
export const ROLES = {
  ADMIN: "Admin",
  BODEGUERO: "Bodeguero",
  VENDEDOR: "Vendedor",
  TECNICO: "Tecnico",
};

// Mapa de nombre → email en Supabase Auth
export const EMAIL_MAP = {
  "Carlos Dueño": "carlos@compresores.local",
  "Pedro Bodeguero": "pedro@compresores.local",
  "María Vendedora": "maria@compresores.local",
  "Juan Vendedor": "juan@compresores.local",
  "Ana Vendedora": "ana@compresores.local",
  "Luis Técnico": "luis@compresores.local",
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
    "Herramientas",
    "Devoluciones",
    "Productos",
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
    "Ventas",
    "Cotizaciones",
    "Garantías",
    "Herramientas",
    "Productos",
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
  "→ Panel Admin": "/admin",
};

// Módulos del Panel Admin
export const ADMIN_MODULES = [
  { nombre: "Dashboard", icon: "📊", ruta: "/admin" },
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
