// Utilidades globales — se completan según necesidad

import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Combina clases condicionales (clsx) y resuelve conflictos de Tailwind
// (tailwind-merge). Requerido por los componentes shadcn/ui.
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

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

// Sanitiza input para `.or()` + `.ilike()` de PostgREST.
// Estrategia híbrida: ELIMINA metacaracteres del parser de PostgREST y
// ESCAPA wildcards SQL para preservar intención del usuario (p.ej. "100%").
//
// Caracteres eliminados (rompen el parser de .or()):
//   ,  separador de filtros entre subexpresiones
//   .  separador columna.operador.valor
//   *  wildcard alternativo
//   (  )  agrupación de subexpresiones
//   :  prefijo de operadores compuestos
//
// Caracteres escapados con \ (significan algo en SQL pero usuario los puede querer):
//   %  wildcard ILIKE
//   _  wildcard ILIKE single-char
//   \  escape SQL — escapado primero para no romper el resto
//
// También limita longitud a 100 chars para prevenir DOS por strings largos.
export const sanitizeSearch = (q) => {
  const s = (q ?? "").toString().trim().slice(0, 100);
  return s
    .replace(/\\/g, "\\\\") // primero: escapar backslash existente
    .replace(/[%_]/g, "\\$&") // luego: escapar wildcards SQL
    .replace(/[,.*():]/g, ""); // finalmente: eliminar metacaracteres PostgREST
};

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
  if (m.includes("transición") || m.includes("transicion")) return err.message; // Mostrar mensaje exacto del trigger ("Transición ilegal de X a Y")
  if (m.includes("entregada"))
    return "No se puede modificar una orden entregada";
  if (m.includes("anticipo")) return err.message; // "OT autorizada requiere..."
  if (
    m.includes("convertir") ||
    m.includes("aprobada") ||
    m.includes("rechazada") ||
    m.includes("vencida") ||
    m.includes("autorizada con trabajo")
  )
    return err.message; // mensaje exacto del trigger BD
  if (m.includes("stock_fisico"))
    return "Conteo corrupto: stock físico es NULL";
  if (m.includes("stock insuficiente del componente")) return err.message; // Mensaje detallado de ensamble
  if (m.includes("duplicate key") || code === "23505")
    return "Ya existe un registro con esos datos";
  if (m.includes("foreign key") || code === "23503")
    return "Referencia inválida — el registro no existe";
  if (m.includes("network") || m.includes("fetch"))
    return "Sin conexión — revisa tu internet";
  return fallback;
};
