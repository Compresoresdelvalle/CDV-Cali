# Fase 9 — Ajustes Órdenes de Trabajo (OT)

> **Estado:** pendiente de planeación detallada (`/plan mode`).
> **Fuente cliente:** `requerimientos_reunion_cliente.md` §2.

## Propósito

Corregir la implementación actual de OT para que cumpla con la realidad operativa descrita por el cliente: checklist configurable, bifurcación autorización vs valor por revisión, múltiples abonos, regla de 30 días sin entrar al inventario.

## Alcance

### 9.1 Checklist de recepción configurable (§2.3)

Lista oficial de **24 ítems** aportada por el cliente (set inicial sembrado, **CRUD por admin** después):

| Columna 1          | Columna 2            |
| ------------------ | -------------------- |
| Compresor          | Cabezote             |
| Motor              | Automático           |
| Manómetro          | V. cheque            |
| V. seguridad       | Llave bola 1/2       |
| Llave bola 1/4     | Llave de bola 3/8    |
| Correa             | Polea                |
| Filtros            | Unidad mantenimiento |
| Filtro trampa      | Tubo de carga        |
| Arrancador         | Desfogue             |
| Motor quemado      | Tanque roto          |
| Engrasadora        | Grapadora            |
| Pistola de impacto | Guarda polea         |

**Lógica:** se **marca lo que SÍ trae**. Lo no marcado = no llegó (soporte legal).

**Cita:** _"Suele pasar que cuando recibimos las órdenes de trabajo, los compresores, el cliente reclama y dice: 'Vea, lo que pasa es que el compresor traía el filtro y no me lo entregaron con filtro'. Pero el soporte de que el compresor llegó sin filtro es la orden de trabajo, porque no se marcó."_

### 9.2 Bifurcación autorización vs valor por revisión (§2.5, §2.5b)

| Caso                | Camino                                                                          |
| ------------------- | ------------------------------------------------------------------------------- |
| Cliente AUTORIZA    | Anticipo obligatorio para iniciar. Sin anticipo, el trabajo no inicia.          |
| Cliente NO AUTORIZA | No se ejecuta. Se cobra **valor por revisión** (monto manual por OT) al cierre. |

- Estado `estado_autorizacion` en OT (autorizado / no_autorizado).
- Validación "no iniciar sin anticipo" SOLO aplica a OTs autorizadas.
- Valor por revisión NO es parámetro global — se escribe manualmente por OT.
- Tratamiento contable: el valor por revisión **se factura como servicio normal** — entra en "Ingresos por servicios" del dashboard (Fase 15).

### 9.3 Múltiples abonos (§2.6)

> _"Pues ahí también van los abonos, van en las ordenes de trabajo porque la gente siempre hace anticipos."_

- Tabla nueva `abonos` (FK a OT, fecha, monto, método).
- Recibo final (Fase 14) consolida todos los abonos previos.

### 9.4 Regla 30 días → "Pendiente de recogida" (§2.9)

- Día 30: alerta interna al usuario operativo (NO al cliente).
- Estado nuevo `pendiente_recogida`.
- **Equipo NUNCA entra al inventario** (ni siquiera como segunda mano).
- OTs en ese estado se quedan ahí indefinidamente — no requiere acción automática.
- Si cliente reaparece: cerrar OT contra pago + entregar.

### 9.5 Confirmar §2.7 y §2.8 (ya implementado)

- §2.7 — Piezas usadas en OT SÍ se descuentan del inventario. **Validar.**
- §2.8 — Equipo del cliente NUNCA entra al inventario. **Validar.**

## Tablas / migrations

- **Nuevas:** `checklist_componentes`, `ot_checklist`, `abonos`.
- **Columnas nuevas en `ordenes_servicio`:** `estado_autorizacion`, `valor_revision`, `fecha_alerta_30_dias`, `pendiente_recogida_at`.

## Frontend afectado

- `src/pages/ops/OrdenNueva.jsx`
- `src/pages/ops/OrdenDetalle.jsx`
- `src/pages/ops/OrdenHistorial.jsx`
- `src/pages/admin/Alertas.jsx` (alerta día 30)

## Verificación

- E2E `tests/e2e/ordenes.spec.js` cubre checklist configurable + autorización + abonos + estado 30 días.
- Migration valida que el equipo del cliente sigue sin entrar al inventario tras el día 30.
