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

// Mapa de uid (usuarios.id === auth.users.id) → email en Supabase Auth.
// FUENTE DE VERDAD del login: se indexa por el ID, que es INMUTABLE, para que
// renombrar usuarios en el panel de Admin NUNCA rompa el inicio de sesión.
// (El comentario al lado es solo referencia humana — no se usa para nada.)
export const EMAIL_BY_UID = {
  "8742975c-d3ef-44b7-94ce-372eafbc943b": "compresorescvsas@gmail.com", // Admin (Maritza)
  "dfc41ee2-2e1d-47e0-9378-741ba277743c":
    "ventascompresoresdelvalle@hotmail.com", // Bodega
  "d72f0e68-f2c6-4bee-a834-4134af328f6b": "compresoresdelvalle1@hotmail.com", // Sofía
  "07765b25-ab57-4ebf-b1af-33996ab149f4": "compresoresdelvallesas@gmail.com", // Deyanira
  "0c5dc64e-8d13-4c6e-ac27-64663d99c8ed": "compresoresdelvallesas@hotmail.com", // Bladimir
  "0cbf1692-1570-4ccd-8a0c-6b94b27b5d36": "compresorescv@hotmail.com", // Edna
  "672d3434-e1aa-4030-a4e4-5ce62ea95006":
    "tecnico.prueba@compresoresdelvalle.com", // TecPrueba
  // Bloque 0 — 5 usuarios nuevos (4 técnicos + 1 bodeguero), sede BODEGA.
  "227b9209-a9da-4a66-bcba-e47d8e052553": "servteccompresores@hotmail.com", // Paolo (Técnico)
  "16fbc125-8644-4c53-8d29-a0320fb9f0a1": "servtec1compresores@hotmail.com", // Carlos A (Técnico)
  "43a3add6-4bb7-4a99-bedd-f63e2decf27b": "servtec2compresores@hotmail.com", // Dario (Técnico)
  "2b002595-31b0-4066-bff9-38a9f8a68c47": "servtec3compresores@hotmail.com", // Fabián A (Técnico)
  "bfc400ec-93f6-4a0a-83f0-7f16155aa49a": "bodegacompresores@hotmail.com", // Bodega2 (Bodeguero)
};

// Respaldo heredado: nombre → email. Solo se consulta si un usuario aún no está
// en EMAIL_BY_UID. NO depender de este mapa: el nombre es editable y romperá el
// login si se renombra. Se conserva por compatibilidad durante la transición.
export const EMAIL_MAP = {
  Admin: "compresorescvsas@gmail.com",
  Bodega: "ventascompresoresdelvalle@hotmail.com",
  Sofía: "compresoresdelvalle1@hotmail.com",
  Deyanira: "compresoresdelvallesas@gmail.com",
  Bladimir: "compresoresdelvallesas@hotmail.com",
  Edna: "compresorescv@hotmail.com",
  TecPrueba: "tecnico.prueba@compresoresdelvalle.com",
  // Bloque 0 — usuarios nuevos (respaldo por nombre; el primario es EMAIL_BY_UID).
  Paolo: "servteccompresores@hotmail.com",
  "Carlos A": "servtec1compresores@hotmail.com",
  Dario: "servtec2compresores@hotmail.com",
  "Fabián A": "servtec3compresores@hotmail.com",
  Bodega2: "bodegacompresores@hotmail.com",
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
    "Cierre",
  ],
  Vendedor: [
    "Inventario",
    "Traspasos",
    "Ventas",
    "Compras",
    "Órdenes",
    "Ensambles",
    "Cotizaciones",
    "Garantías",
    "Recibos",
    "Herramientas",
    "Productos",
    "Clientes",
  ],
  Tecnico: ["Órdenes", "Ensambles", "Herramientas"],
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
  Cierre: "🧮",
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
  Cierre: "/ops/cierre",
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
