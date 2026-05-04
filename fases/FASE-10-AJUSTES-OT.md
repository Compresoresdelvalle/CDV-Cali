# Fase 10 — Ajustes Órdenes de Trabajo (OT)

> **Cambio de orden vs primera versión:** esta fase pasó de Fase 9 a **Fase 10** porque depende de `checklist_componentes` y `parametros_sistema.dias_alerta_ot_abandonada` que se crean en Fase 9 (Configuración General).

> **Estado:** pendiente de planeación detallada (`/plan mode`).
> **Fuente cliente:** `requerimientos_reunion_cliente.md` §2.

## Propósito

Corregir la implementación actual de OT para que cumpla con la realidad operativa descrita por el cliente: checklist configurable, bifurcación autorización vs valor por revisión, múltiples abonos, regla de 30 días sin entrar al inventario, vínculo OT→Cotización.

## Alcance

### 10.1 Checklist de recepción (§2.3) — consume catálogo de F9

**`checklist_componentes` se crea y se siembra con los 24 ítems en Fase 9 §9.2.** Esta fase solo lo consume.

- Crear tabla M2M `ot_checklist` (FK a `ordenes_servicio`, FK a `checklist_componentes`, `marcado` boolean).
- UI: al crear/editar una OT, render de los componentes activos del catálogo (`checklist_componentes` where `activo=true`) con checkbox por cada uno.
- **Lógica:** se marca lo que SÍ trae. Lo no marcado = no llegó (soporte legal).

> _"Suele pasar que cuando recibimos las órdenes de trabajo, los compresores, el cliente reclama y dice: 'Vea, lo que pasa es que el compresor traía el filtro y no me lo entregaron con filtro'. Pero el soporte de que el compresor llegó sin filtro es la orden de trabajo, porque no se marcó."_

### 10.2 Bifurcación autorización vs valor por revisión (§2.5, §2.5b)

| Caso                | Camino                                                                          |
| ------------------- | ------------------------------------------------------------------------------- |
| Cliente AUTORIZA    | Anticipo obligatorio para iniciar. Sin anticipo, el trabajo no inicia.          |
| Cliente NO AUTORIZA | No se ejecuta. Se cobra **valor por revisión** (monto manual por OT) al cierre. |

- Estado `estado_autorizacion` en OT (`autorizado` / `no_autorizado`).
- Validación "no iniciar sin anticipo" SOLO aplica a OTs autorizadas.
- Valor por revisión NO es parámetro global — se escribe manualmente por OT.
- Tratamiento contable: el valor por revisión **se factura como servicio normal** → entra en "Ingresos por servicios" del dashboard (Fase 15).

### 10.3 Múltiples abonos (§2.6)

> _"Pues ahí también van los abonos, van en las ordenes de trabajo porque la gente siempre hace anticipos."_

- Tabla nueva `abonos` (FK a OT, fecha, monto, método_pago).
- Recibo final (Fase 14) consolida todos los abonos previos.

### 10.4 Regla 30 días → "Pendiente de recogida" (§2.9)

- Día 30: alerta interna al usuario operativo (NO al cliente).
- Estado nuevo `pendiente_recogida` en OT.
- **Equipo NUNCA entra al inventario** (ni siquiera como segunda mano).
- OTs en ese estado se quedan ahí indefinidamente — no requiere acción automática.
- Si cliente reaparece: cerrar OT contra pago + entregar.
- Días configurable vía `fn_get_parametro('dias_alerta_ot_abandonada')` (Fase 9).

### 10.5 Confirmar §2.7 y §2.8 (ya implementado, validar)

- §2.7 — Piezas usadas en OT SÍ se descuentan del inventario. **Validar con E2E.**
- §2.8 — Equipo del cliente NUNCA entra al inventario. **Validar con E2E.**

### 10.6 Vínculo OT → Cotización (§2.4 paso 3) — gap cubierto

El flujo §2.4 dice: "1) Recepción → 2) Diagnóstico → **3) Generación de cotización** → 4) Envío al cliente → 5) Bifurcación autorización".

Implica que desde el detalle de una OT, el técnico debe poder **generar una cotización** asociada.

- Botón en `OrdenDetalle.jsx`: "Generar cotización desde esta OT".
- Pre-llena cliente (texto libre desde la OT), ítems sugeridos (vacío inicialmente), referencia a la OT (`cotizaciones.ot_id` FK opcional).
- Cuando el cliente autoriza, esa cotización queda vinculada a la OT y al recibo final (Fase 14).

**Columna nueva** en `cotizaciones`: `ot_id` UUID NULL FK a `ordenes_servicio`.

## Tablas / migrations

- **Nuevas en esta fase:** `ot_checklist` (M2M), `abonos`.
- **Tablas consumidas (creadas en F9):** `checklist_componentes`, `parametros_sistema`.
- **Columnas nuevas en `ordenes_servicio`:** `estado_autorizacion` (enum `autorizado`|`no_autorizado`|`pendiente`), `valor_revision` numeric, `fecha_alerta_30_dias` timestamp, `pendiente_recogida_at` timestamp.
- **Columna nueva en `cotizaciones`:** `ot_id` (FK a `ordenes_servicio`, nullable).

## Frontend afectado

- `src/pages/ops/OrdenNueva.jsx`
- `src/pages/ops/OrdenDetalle.jsx` (botón "Generar cotización", lista abonos)
- `src/pages/ops/OrdenHistorial.jsx`
- `src/pages/admin/Alertas.jsx` (alerta día 30)
- `src/pages/ops/CotizacionNueva.jsx` (pre-llenado desde OT)

## Verificación

- E2E `tests/e2e/ordenes.spec.js` cubre:
  - Checklist consume catálogo de F9 (no falla si admin agrega/quita componentes).
  - Bifurcación autorización vs valor por revisión.
  - Múltiples abonos en una OT.
  - Estado `pendiente_recogida` se aplica al día 30 y NO entra al inventario.
  - Generar cotización desde OT crea registro con `cotizaciones.ot_id` poblado.
- Migration valida que el equipo del cliente sigue sin entrar al inventario tras el día 30.
