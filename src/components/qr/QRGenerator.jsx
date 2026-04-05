import { QRCodeSVG } from 'qrcode.react'

/**
 * Genera un código QR SVG con la referencia del producto.
 * Props:
 *   value:  string — referencia del producto (ej: 'CMP-2HP-24')
 *   size:   number — tamaño en px (default 128)
 *   level:  'L'|'M'|'Q'|'H' — nivel de corrección (default 'M')
 */
export default function QRGenerator({ value, size = 128, level = 'M' }) {
  if (!value) return null

  return (
    <QRCodeSVG
      value={value}
      size={size}
      level={level}
      marginSize={2}
      style={{ display: 'block' }}
    />
  )
}
