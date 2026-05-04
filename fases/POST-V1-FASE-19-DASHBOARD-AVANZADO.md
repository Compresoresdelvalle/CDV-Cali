# Fase 19 (post-v1.0) — Garantías y Recibos en Dashboard avanzado

> **Estado:** post-v1.0. NO entra en el roadmap actual hacia v1.0.
> **Fuente cliente:** `requerimientos_reunion_cliente.md` §8.4.

## Propósito

Categorización avanzada del dashboard incluyendo métricas de garantías y recibos. Explícitamente postergada por el cliente.

## Alcance

### 19.1 Categorización avanzada (§8.4)

> _"Salieron en esta conversación garantías que son una fase, recibos a otra fase."_

Métricas a incluir:

- **Garantías de venta:**
  - Cantidad de garantías abiertas / cerradas en el periodo.
  - Tiempo promedio de resolución (objetivo: 15 días).
  - Distribución por tipo de resolución (devolver dinero / cambiar pieza / arreglar).
  - Tasa de garantías sobre total de ventas (calidad operativa).

- **Garantías de compra:**
  - Cantidad por proveedor (identifica proveedores problemáticos).
  - Distribución nota_credito vs reposicion.
  - Tiempo promedio de respuesta del proveedor.

- **Recibos:**
  - Cantidad emitidos por periodo.
  - Distribución por forma de pago (efectivo, transferencia, tarjeta).
  - Distribución por cuenta bancaria usada.
  - Recibos sin OT vinculada vs con OT vinculada.

### 19.2 Por qué postergado

- En v1.0 se entrega el dashboard básico (Fase 15) con ingresos productos vs servicios + cierres.
- Métricas avanzadas requieren histórico de datos (al menos 1-3 meses de uso real).
- Sin datos históricos las métricas son ruido — mejor esperar.

## Tablas / migrations (futuras)

- Probablemente solo nuevas RPCs / vistas materializadas:
  - `fn_metricas_garantias(desde, hasta)`
  - `fn_metricas_recibos(desde, hasta)`
  - Vista `mv_dashboard_kpis_avanzado` (refresh diario).

## Verificación (futura)

- Dashboard Admin tiene tab nuevo "Métricas avanzadas".
- Filtros por periodo (día / semana / mes / trimestre).
- Exportar reporte a PDF / CSV.

## Notas

- Esta fase NO bloquea v1.0.
- El dashboard básico (Fase 15) es suficiente para la operación diaria.
- Considerar para v1.1 después de 3 meses de datos productivos.
