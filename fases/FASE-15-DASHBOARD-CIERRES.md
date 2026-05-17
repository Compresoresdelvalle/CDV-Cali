# Fase 15 — Dashboard expandido + Cierres

> **Estado:** ✅ CERRADA (2026-05-17).
> **Fuente cliente:** `requerimientos_reunion_cliente.md` §8.
> **Implementado:** ingresos base CAJA; tabla `cierres` append-only; RPCs
> `fn_preview_cierre` / `fn_generar_cierre`; `fn_dashboard_kpis` extendida;
> página `src/pages/admin/Cierres.jsx`; sección "Ingresos por categoría" en el
> Dashboard. Cierres consolidados (todas las sedes). §15.4 (garantías/recibos
> en dashboard) quedó postergado a F19, como estaba previsto.
> Detalle completo: `docs/ESTADO-PROYECTO.md` §3.

## Propósito

Alinear el dashboard del Admin con la visión del cliente: distinción ingresos productos vs servicios, cierres diarios/periódicos.

## Alcance

### 15.1 Vista del dashboard (§8.1)

Indicadores numéricos:

- **Ingresos totales**
- **Egresos**
- **Rotación de productos** (qué rotó / qué no rotó)

> _"El dashboard es ver números: vos tenés que ver ingresos, egresos, lo que rotó, lo que no."_

(Ya existe parcialmente — validar y expandir.)

### 15.2 Categorización de ingresos (§8.2)

- **Ingresos por ventas de producto**
- **Ingresos por servicios** (mantenimientos, reparaciones, valor por revisión, abonos a OT)

> _"Las ventas no es solamente la venta del producto; la venta también son los servicios."_
> _"Va a haber servicios diarios."_

Implica:

- RPC `fn_dashboard_kpis()` (ya existe — Fase 8) debe retornar dos buckets: `ingresos_productos` y `ingresos_servicios`.
- Sumar abonos de OT (Fase 10 §10.3) y valores por revisión (Fase 10 §10.2) al bucket de servicios.
- UI Dashboard separa visualmente ambos buckets.

### 15.3 Cierres (§8.3)

Funcionalidad de **cierre diario / periódico** que consolida ventas + servicios.

> _"Los cierres es normal, eso de los cierres básicamente es ventas."_ (incluyendo servicios).

- Tabla nueva `cierres` (periodo, fecha_inicio, fecha_fin, total_ventas, total_servicios, total, usuario_que_cerro, fecha_cierre).
- O RPC `fn_cierre_periodo(desde, hasta)` que retorne JSON con totales (decisión en `/plan mode` propio).
- Al "cerrar" un periodo, las ventas/servicios de ese rango quedan marcadas como `cerradas=true`.

### 15.4 Garantías y recibos en el dashboard (§8.4) — POSTERGADO

> _"Salieron en esta conversación garantías que son una fase, recibos a otra fase."_

- **Explícitamente fase posterior** (Fase 19 post-v1.0).
- **NO incluir** en esta fase.

## Tablas / migrations

- **Tablas nuevas:** `cierres`.
- **Columnas nuevas:** `ventas.cerrada`, `ordenes_servicio.cerrada` (boolean).
- **RPCs:** modificar `fn_dashboard_kpis()` para retornar buckets separados; nueva `fn_cierre_periodo(desde, hasta)`.

## Frontend afectado

- `src/pages/admin/Dashboard.jsx` — sección "Ingresos por categoría".
- `src/pages/admin/Cierres.jsx` (nueva).
- Sidebar admin: agregar entrada "Cierres".

## Verificación

- Dashboard Admin muestra `Ingresos productos` e `Ingresos servicios` separados.
- Total de servicios incluye: abonos de OT + valores por revisión + ventas de mantenimientos/reparaciones.
- Crear cierre de un día → suma todas las transacciones del día y queda inmutable.
- E2E cubre cierre diario + verificación de KPIs separados.
