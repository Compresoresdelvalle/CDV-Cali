import { QRCodeSVG } from "qrcode.react";

/**
 * Genera un código QR SVG con la referencia del producto.
 * Props:
 *   value:  string — referencia del producto (ej: 'CMP-2HP-24')
 *   size:   number — tamaño en px (default 128)
 *   level:  'L'|'M'|'Q'|'H' — nivel de corrección (default 'H')
 */
// Default 'H' (30% de tolerancia a daño, contra 15% de 'M'): las etiquetas
// viven pegadas en bodega con grasa, polvo y roces. El QR ocupa los mismos
// `size` px; con referencias de más de 7 caracteres solo sube de versión 1 a
// 2, o sea módulos algo más pequeños, que se siguen leyendo sin problema.
export default function QRGenerator({ value, size = 128, level = "H" }) {
  if (!value) return null;

  return (
    <QRCodeSVG
      value={value}
      size={size}
      level={level}
      marginSize={2}
      style={{ display: "block" }}
    />
  );
}
