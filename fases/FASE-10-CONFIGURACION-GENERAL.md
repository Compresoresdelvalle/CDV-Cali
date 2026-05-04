# Fase 10 — Configuración General

> **Estado:** pendiente de planeación detallada (`/plan mode`).
> **Fuente cliente:** `requerimientos_reunion_cliente.md` §9.

## Propósito

Crear el módulo Admin → Configuración para que el cliente maneje cuentas bancarias, parámetros del sistema y catálogos sin tocar código.

## Alcance

### 10.1 Cuentas Bancarias (§9.1, §1.5)

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

### 10.2 Componentes de checklist OT (§9.2)

CRUD de componentes posibles del checklist de OT (compartido con Fase 9 — coordinar orden).

- Sembrar los **24 ítems iniciales** (ver Fase 9).
- Permitir agregar / quitar / editar componentes en el tiempo sin cambio de código.
- La lista aplica de forma genérica para todos los tipos de equipo (compresor, neumática, hidráulica) — el usuario marca solo los que apliquen al equipo recibido.

### 10.3 Parámetros del sistema (§9.3)

| Parámetro                         | Default         | Editable                  |
| --------------------------------- | --------------- | ------------------------- |
| % IVA                             | 19%             | Sí, por cotización/recibo |
| Validez de cotización             | 15 días hábiles | Sí, por cotización        |
| Días para alerta de OT abandonada | 30 días         | Sí, global                |
| Tiempo de garantía de venta       | 3 meses         | Sí, global                |

> El **valor por revisión** NO es parámetro global — se ingresa manualmente en cada OT que aplique (ver Fase 9 §9.2).

## Tablas / migrations

- **Nuevas:** `cuentas_bancarias`, `parametros_sistema` (key/value tipado), `checklist_componentes` (compartido con Fase 9 — coordinar quién la crea primero).

## Frontend afectado

- `src/pages/admin/Configuracion/CuentasBancarias.jsx` (nueva carpeta)
- `src/pages/admin/Configuracion/Parametros.jsx`
- `src/pages/admin/Configuracion/ChecklistOT.jsx`
- Actualizar `AdminShell` para incluir entrada Configuración en sidebar.

## Verificación

- Admin → Configuración renderiza los 3 CRUDs.
- Migration sembrada con 4 valores default en `parametros_sistema` y los 4 placeholders en `cuentas_bancarias`.
- Otras fases (11, 13, 14, 15) leen estos valores con `fn_get_parametro(key)`.
