# Fase 14 — Recibos manuales completos (módulo nuevo)

> **Estado:** pendiente de planeación detallada (`/plan mode`).
> **Fuente cliente:** `requerimientos_reunion_cliente.md` §6.

## Propósito

Convertir el flujo de recibos en un módulo formal con PDF (igual que cotización), dos modos de creación, y consolidación de abonos de OT.

## Alcance

### 14.1 Generación NO automática (§6.1)

- El usuario crea el recibo **manualmente**. La app asiste con formato y datos.
- Decisión técnica/operativa explícita:
  > _"Yo no voy a hacer que sea automático, no, porque la verdad no me pagan lo suficiente."_

### 14.2 Dos modos de creación (§6.2)

1. **Desde una cotización existente:** elegir cotización → app pre-llena datos del recibo (incluyendo nombre del cliente que estaba en esa cotización) → usuario edita → imprime.
2. **Desde cero:** llenar todos los datos manualmente, **incluyendo escribir el nombre del cliente como texto libre** (no hay lista de clientes — §7). Opcionalmente vincular una cotización para trazabilidad sin auto-rellenar.

> _"Te pondré unas casillas, nombre... o eliges la cotización... la aplicación te va a dejar elegir una cotización o hacerlo desde cero sin cotización o con cotización."_

### 14.3 Edición antes de imprimir (§6.3)

- Usuario puede agregar/quitar campos al recibo antes de imprimirlo.

### 14.4 Imprimir directo + exportar PDF (§6.4)

- Imprimir directamente y/o exportar a **PDF** (igual que cotización).
- **No abrir Word ni otras herramientas.**
- _"Para que no tengas que abrir Word."_

### 14.5 Vinculación con anticipos/abonos de OT (§6.5)

- Si la OT asociada tiene anticipos o abonos previos (Fase 10 §10.3), deben reflejarse y descontarse en el recibo final.

### 14.6 Campos del recibo (§6.6)

| Campo                    | Tipo                   | Notas                                                 |
| ------------------------ | ---------------------- | ----------------------------------------------------- |
| Número de recibo         | Consecutivo automático | Trigger BD lo genera.                                 |
| Fecha                    | Automática             | Día de emisión.                                       |
| Nombre del cliente       | Texto libre            | Sin CRUD (§7). Auto-rellena si viene de cotización.   |
| Teléfono                 | Texto libre, opcional  |                                                       |
| NIT / Identificación     | Texto libre, opcional  |                                                       |
| Concepto / Detalle       | Texto libre o ítems    | Producto, servicio o ambos. Permite múltiples líneas. |
| Cotización vinculada     | Referencia opcional    | Para trazabilidad.                                    |
| OT vinculada             | Referencia opcional    | Cuando aplique; trae los abonos asociados.            |
| Subtotal                 | Calculado              | Suma de ítems.                                        |
| IVA                      | Editable, default 19%  | Permite 0%. Mismo comportamiento que cotización.      |
| Total                    | Calculado              | Subtotal + IVA.                                       |
| Abonos previos           | Calculado/listado      | Sumatoria de abonos de la OT vinculada.               |
| Saldo pendiente / pagado | Calculado              | Total – Abonos.                                       |
| Forma de pago            | Selector               | Efectivo, transferencia, tarjeta, otro.               |
| Cuenta bancaria usada    | Selector opcional      | Si fue transferencia, qué cuenta recibió (Fase 9).    |
| Recibido por             | Auto                   | Usuario logueado que emite el recibo.                 |
| Observaciones            | Texto libre            | Notas adicionales.                                    |

## Tablas / migrations

- **Tablas nuevas:** `recibos`, `detalle_recibo`.
- **Trigger BD:** consecutivo único en `recibos.numero` (no por app).
- Considerar `cierres` (Fase 15) para "cerrar" un día de recibos.

## Frontend afectado

- `src/pages/ops/Recibos/Nuevo.jsx` (nueva carpeta)
- `src/pages/ops/Recibos/Detalle.jsx`
- `src/pages/ops/Recibos/Historial.jsx`
- Reusar `src/lib/pdf*` (generador PDF de cotizaciones — Fase 11).

## Verificación

- Recibo nuevo desde cotización: pre-llena cliente + ítems + IVA. Editable.
- Recibo nuevo desde cero: usuario llena todo, opcional vincula OT.
- Si OT tiene 3 abonos de $100 y total es $500 → recibo muestra "Abonos previos: $300, Saldo pendiente: $200".
- PDF descargable e imprimible.
- Consecutivo único — no hay duplicados aún en concurrencia.
- E2E `tests/e2e/recibos.spec.js` cubre ambos modos.
