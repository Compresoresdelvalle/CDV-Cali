# Fase 9 — Configuración General

> **Cambio de orden vs primera versión del roadmap:** esta fase pasó de ser Fase 10 a **Fase 9** porque las fases siguientes (Ajustes OT, Cotizaciones, Garantías, Recibos, Dashboard) dependen de las tablas y parámetros que aquí se crean. Ejecutar primero esta fase elimina forward dependencies del roadmap.

> **Estado:** pendiente de planeación detallada (`/plan mode`).
> **Fuente cliente:** `requerimientos_reunion_cliente.md` §9.

## Propósito

Crear el módulo Admin → Configuración para que el cliente maneje cuentas bancarias, parámetros del sistema y catálogos sin tocar código. **Esta fase es prerequisito de todas las fases siguientes (10–17).**

## Alcance

### 9.1 Cuentas Bancarias (§9.1, §1.5)

CRUD completo: banco, tipo, número, titular, marca opcional `con_iva` / `sin_iva`.

**Por qué la marca con/sin IVA:**

> _"Puede que el cliente pague con IVA, entonces el cliente paga con IVA cierta cuenta; si el cliente paga sin IVA, cierta cuenta."_

**Datos iniciales sugeridos (placeholder, totalmente editables por el admin):**

| Banco           | Tipo              | Número         | Titular                      | Marca   |
| --------------- | ----------------- | -------------- | ---------------------------- | ------- |
| Bancolombia     | Ahorros           | XXX-XXXXXX-XX  | Compresores del Valle S.A.S. | Con IVA |
| Davivienda      | Corriente         | XXXX-XXXX-XXXX | Compresores del Valle S.A.S. | Sin IVA |
| Nequi           | Billetera digital | 3XX XXX XXXX   | Compresores del Valle S.A.S. | Sin IVA |
| Banco de Bogotá | Ahorros           | XXX-XXXXXX     | Compresores del Valle S.A.S. | Con IVA |

> Los datos arriba son placeholders. El admin debe editarlos con valores reales antes de uso productivo.

### 9.2 Componentes de checklist OT (§9.2) — **dueño exclusivo de esta tabla**

**Esta fase es responsable única de crear y poblar `checklist_componentes`.** Fase 10 (OT) solo la consume.

- CRUD: nombre, activo.
- Sembrar los **24 ítems iniciales** (lista oficial del cliente reproducida abajo).
- Permitir agregar / quitar / editar componentes en el tiempo sin cambio de código.
- La lista aplica de forma genérica para todos los tipos de equipo (compresor, neumática, hidráulica) — el usuario marca solo los que apliquen al equipo recibido.

**Lista oficial de 24 ítems para sembrado inicial:**

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

### 9.3 Parámetros del sistema (§9.3)

| Parámetro                    | Default         | Editable              | Consumido por                                        |
| ---------------------------- | --------------- | --------------------- | ---------------------------------------------------- |
| `iva_pct`                    | 19%             | Por cotización/recibo | F11, F14                                             |
| `validez_cotizacion_dias`    | 15 días hábiles | Por cotización        | F11                                                  |
| `dias_alerta_ot_abandonada`  | 30              | Global                | F10                                                  |
| `dias_garantia_venta`        | 90 (3 meses)    | Global                | F13                                                  |
| `dias_conteo_ciclico` (§3.6) | 15              | Global                | F12 (consumido por módulo `Conteo.jsx` ya existente) |

> El **valor por revisión** NO es parámetro global — se ingresa manualmente en cada OT que aplique (ver Fase 10 §10.2).

## Tablas / migrations

- **Nuevas (todas creadas en esta fase, sin compartir dueño):**
  - `cuentas_bancarias`
  - `parametros_sistema` (key/value tipado)
  - `checklist_componentes`
- **RPC nueva:** `fn_get_parametro(p_key TEXT) RETURNS TEXT` para que las demás fases lean parámetros con un solo método.

## Frontend afectado

- `src/pages/admin/Configuracion/CuentasBancarias.jsx` (nueva carpeta)
- `src/pages/admin/Configuracion/Parametros.jsx`
- `src/pages/admin/Configuracion/ChecklistOT.jsx`
- Actualizar `AdminShell` para incluir entrada Configuración en sidebar.

## Verificación

- Admin → Configuración renderiza los 3 CRUDs.
- Migration sembrada con 5 valores default en `parametros_sistema` y los 4 placeholders en `cuentas_bancarias` y los 24 ítems en `checklist_componentes`.
- `SELECT fn_get_parametro('iva_pct')` retorna `'19'`.
- Otras fases (10–17) leen estos valores con `fn_get_parametro(key)`.
