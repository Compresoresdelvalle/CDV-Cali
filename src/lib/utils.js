// Utilidades globales — se completan según necesidad

export const formatCOP = (amount) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(amount);

export const formatDate = (date) =>
  new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(date));

// Escapa caracteres con significado especial en PostgREST .or() y .ilike():
//   ,  separador de filtros
//   .  separador operador/columna
//   *  wildcard alternativo
//   (  )  agrupación
//   %  wildcard ILIKE inyectado
//   \  escape SQL
export const sanitizeSearch = (q) =>
  (q ?? "").replace(/[,.*()\\%]/g, "").trim();

// Mensaje seguro para mostrar al usuario sin filtrar schema/columnas.
// En desarrollo logueamos el err crudo a la consola.
export const safeError = (err, fallback = "Ocurrió un error inesperado") => {
  if (import.meta.env.DEV) console.error("[safeError]", err);
  if (!err) return fallback;
  // Códigos PostgREST/Supabase comunes con mensajes amigables
  const code = err.code || err.status;
  const m = (err.message ?? "").toLowerCase();
  if (m.includes("permission denied") || code === "42501")
    return "No tienes permisos para esta acción";
  if (m.includes("violates row-level security"))
    return "No tienes permisos para esta acción";
  if (m.includes("stock insuficiente"))
    return "Stock insuficiente para este producto";
  if (m.includes("transición") || m.includes("transicion"))
    return "Cambio de estado no permitido";
  if (m.includes("entregada"))
    return "No se puede modificar una orden entregada";
  if (m.includes("duplicate key") || code === "23505")
    return "Ya existe un registro con esos datos";
  if (m.includes("foreign key") || code === "23503")
    return "Referencia inválida — el registro no existe";
  if (m.includes("network") || m.includes("fetch"))
    return "Sin conexión — revisa tu internet";
  return fallback;
};
