# Fase 13 — Garantías (módulo nuevo)

> **Estado:** pendiente de planeación detallada (`/plan mode`).
> **Fuente cliente:** `requerimientos_reunion_cliente.md` §5.

## Propósito

Crear desde cero el módulo Garantías. Distinto de Devoluciones (compras) y Traslados.

## Distinción conceptual (§5.0)

| Concepto                 | Significado                                          |
| ------------------------ | ---------------------------------------------------- |
| **Traslado**             | Movimiento de inventario entre ubicaciones internas. |
| **Garantía**             | Cliente trae de vuelta un equipo/pieza que falló.    |
| **Devolución (compras)** | Producto comprado al proveedor llegó defectuoso.     |

> **Aclaración del cliente:** _"La devolución es lo mismo que traslado"_ fue desestimado. Cuando el cliente trae algo de vuelta, **eso es garantía, no devolución**.

## Alcance

### 13.1 Garantías de COMPRAS — proveedor → nosotros (§5.1)

Producto comprado al proveedor llegó defectuoso. **Dos resoluciones posibles:**

1. **Nota crédito** del proveedor (descuento sobre la factura).
2. **Reposición física** (proveedor envía producto nuevo).

> _"En el área de compras pueden haber 2 factores: una, que ellos nos hagan una nota crédito... o la otra, que nos devuelvan el producto nuevo. Es variable."_

- Asociar a `compras` original (FK) — coordina con Fase 12 §12.8.

### 13.2 Garantías de VENTAS — nosotros → cliente (§5.2)

**Tiempo de garantía:** **3 meses** sobre reparación o mantenimiento.

> _"Las garantías cumplen un tiempo de tres meses por reparación o mantenimiento."_

**Tiempo estándar de respuesta:** 15 días, idealmente inmediato.

> _"Estamos en un gremio donde los clientes quieren ya las cosas."_

**Tres resoluciones posibles:**

1. **Devolver dinero** (nota crédito al cliente).
2. **Cambiar la pieza** por una nueva.
3. **Arreglar** el producto.

**Política declarada:**

- Sin stock + cliente insistente → preferir **devolver dinero**. _"Preferimos devolver la plata que engalletarnos."_
- Hay stock o se consigue del proveedor en **3-4 días hábiles** → reponer.
- Si la solución es arreglar → entregar arreglado.

- Asociar a `ventas` o a `ordenes_servicio` original (FK).
- Fecha vencimiento auto-calculada = `fecha_venta + parametros_sistema.dias_garantia` (Fase 10 §10.3).

## Tablas / migrations

- **Tablas nuevas:**
  - `garantias_compra` (FK a `compras`, resolución enum `nota_credito`/`reposicion`, fecha, monto, observaciones).
  - `garantias_venta` (FK a `ventas` o `ordenes_servicio`, resolución enum `devolver_dinero`/`cambiar_pieza`/`arreglar`, fecha, fecha_vencimiento auto, observaciones).

- **Triggers:**
  - Si resolución `reposicion` o `cambiar_pieza` → afecta inventario (sumar producto repuesto).
  - Si resolución `devolver_dinero` → registrar en movimientos como egreso.

## Frontend afectado

- `src/pages/ops/Garantias/ListadoCompras.jsx` (nueva carpeta)
- `src/pages/ops/Garantias/ListadoVentas.jsx`
- `src/pages/ops/Garantias/Nueva.jsx`
- `src/pages/ops/Garantias/Detalle.jsx`
- Sidebar: agregar entrada "Garantías".

## Verificación

- Crear garantía de compra desde una compra existente → resolución (nota_credito | reposicion).
- Crear garantía de venta desde una venta/OT existente → resolución (devolver_dinero | cambiar_pieza | arreglar).
- Verificar fecha_vencimiento auto-calculada (3 meses por defecto).
- Inventario se ajusta correctamente según resolución.
- E2E `tests/e2e/garantias.spec.js` cubre ambos flujos.
