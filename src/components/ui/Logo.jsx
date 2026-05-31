import logoCdv from "../../assets/logo-cdv.jpeg";

/**
 * Logo circular de Compresores del Valle S.A.S.
 *
 * El asset original es cuadrado con fondo gris claro; `rounded-full` +
 * `object-cover` recortan las esquinas y muestran solo el badge circular,
 * por lo que se ve limpio sobre fondos oscuros o de marca.
 *
 * El tamaño se controla con clases de Tailwind vía `className` (ej. "h-7 w-7"),
 * siguiendo el patrón de los demás badges del layout.
 *
 * @param {{ className?: string, alt?: string }} props
 */
export default function Logo({
  className = "h-7 w-7",
  alt = "Compresores del Valle S.A.S.",
}) {
  return (
    <img
      src={logoCdv}
      alt={alt}
      loading="eager"
      className={`shrink-0 rounded-full object-cover ${className}`}
    />
  );
}
