import { toast } from "sonner";
import { safeError } from "./utils";

/**
 * Avisos flotantes (pop-up) para RESULTADOS DE ACCIÓN: "se creó", "falló",
 * "stock insuficiente". Saltan a la vista sin importar dónde esté el scroll,
 * a diferencia del texto fijo arriba de la pantalla, que se pierde cuando el
 * operario está más abajo en un formulario largo.
 *
 * Regla de uso: esto es para lo EFÍMERO (acaba de pasar). Un ESTADO PERMANENTE
 * (un conteo pendiente, una OT sin facturar) NO va aquí: eso debe quedar fijo
 * en la pantalla, porque un pop-up desaparece y se perdería.
 *
 * El Toaster se monta una sola vez en App.jsx.
 */

/** Éxito: verde, corto. */
export const avisarOk = (mensaje, opts) =>
  toast.success(mensaje, { duration: 3500, ...opts });

/**
 * Error: rojo, más tiempo en pantalla (hay que leerlo). Acepta un Error de
 * Supabase/Postgres (lo pasa por `safeError` para no filtrar el esquema) o un
 * string ya listo para mostrar.
 */
export const avisarError = (
  errOrMsg,
  fallback = "Ocurrió un error inesperado",
) =>
  toast.error(
    typeof errOrMsg === "string" ? errOrMsg : safeError(errOrMsg, fallback),
    { duration: 6000 },
  );

/** Informativo/neutro. */
export const avisarInfo = (mensaje, opts) =>
  toast(mensaje, { duration: 4000, ...opts });
