# FASE 13B — Recibo POS de venta + Impresión de OT

> Sub-fase insertada entre F13 (Garantías) y F14 (Recibos manuales).
> Solo frontend — no toca base de datos.

## Contexto

El cliente necesita poder **imprimir** dos documentos que hoy no tienen salida física:

1. **Venta → recibo tipo POS:** al ver el detalle de una venta, un botón genera
   un recibo en formato punto-de-venta (tirilla angosta 80mm) listo para
   imprimir en impresora térmica o normal.
2. **OT → documento imprimible:** la orden de trabajo debe poder imprimirse
   (formato carta) con el detalle del equipo, repuestos, checklist y totales.

F14 (Recibos manuales) sigue siendo el módulo formal completo con su tabla
`recibos`. Esta sub-fase **no** crea esa tabla: solo añade generadores PDF
que renderizan datos ya existentes de `ventas` y `ordenes_servicio`.

## Alcance

### Recibo POS de venta

- Formato: tirilla 80mm de ancho, alto dinámico (estilo impresora térmica).
- Contenido: encabezado de empresa, N° venta, fecha/hora, cliente, lista de
  ítems (cantidad × precio), subtotal, descuento, IVA, total, método de pago,
  vendedor, mensaje de agradecimiento.
- Botón "🖨️ Imprimir recibo" en `VentaDetalle.jsx`.

### Documento imprimible de OT

- Formato: carta (216×279mm), igual estética que el PDF de cotización.
- Contenido: encabezado, N° OT, fecha, cliente + teléfono, equipo + serie,
  diagnóstico, trabajo realizado, tabla de repuestos, mano de obra,
  valor de revisión (si aplica), total, técnico, estado, badge garantía.
- Botón "🖨️ Imprimir OT" en `OrdenDetalle.jsx`.

## Archivos

**Nuevos:**

- `src/lib/pdf/ventaPOS.js` — generador recibo POS (jsPDF formato custom 80mm)
- `src/lib/pdf/ordenPDF.js` — generador documento OT (jsPDF carta)

**Modificados:**

- `src/pages/ops/VentaDetalle.jsx` — botón "Imprimir recibo"
- `src/pages/ops/OrdenDetalle.jsx` — botón "Imprimir OT"

**Reusa:** `src/lib/pdf/pdfStyles.js` (MARCA, COLORES, formatCOP) y el patrón
de API `{ blob, download(), print(), open() }` de `cotizacionPDF.js`.

## Verificación

- `npm run build` + `npx eslint src/` limpios.
- Manual: ver venta → "Imprimir recibo" → abre PDF tirilla con datos correctos.
- Manual: ver OT → "Imprimir OT" → abre PDF carta con repuestos y totales.

## Estado

✅ Implementada — 2026-05-15.
