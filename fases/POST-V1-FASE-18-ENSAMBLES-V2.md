# Fase 18 (post-v1.0) — Ensambles avanzados v2

> **Estado:** post-v1.0. NO entra en el roadmap actual hacia v1.0.
> **Fuente cliente:** `requerimientos_reunion_cliente.md` §3.5.

## Propósito

Completar el flujo de ensambles para reflejar la realidad operativa: cuando se ensambla un compresor desde componentes individuales, restar los componentes del inventario y crear el compresor armado como nuevo ítem comerciable.

## Alcance

### 18.1 Flujo de ensamble (§3.5)

> _"Se vende el compresor armado, pues debería restar de los inventarios los componentes para hacer el compresor y crear el nuevo compresor como producto en el inventario."_

- BOM (Bill of Materials) por modelo de compresor armado.
- Al "ensamblar":
  - Resta componentes del inventario.
  - Crea un nuevo ítem `compresor_armado_X` en el inventario, categoría `nuevo` o `segunda_mano` según componentes usados.
  - Costo del armado = suma de costos de componentes + horas/mano de obra (opcional).
- El compresor armado se vende como cualquier otro producto.

### 18.2 Decisión del cliente

> _"Vamos por partes, luego vemos ensambles."_

→ Postergar hasta v1.1 o v2.0.

## Estado actual (Fase 7)

Ya hay implementación parcial:

- Tabla `ensambles` existe.
- Trigger `trg_ensamble_stock` resta componentes y suma producto resultado.
- Hardening con `pg_advisory_xact_lock` aplicado en Fase 7+8 audit.

**Lo que falta para v2:**

- BOM tipado en BD (catálogo de "recetas" reusables).
- UI para crear/editar BOMs.
- UI para ejecutar un ensamble eligiendo BOM + cantidad.
- Reportes de costos de ensamble.
- Soporte para ensambles parciales / abortados.

## Tablas / migrations (futuras)

- `bom_recetas` (modelo, descripción, producto_resultado_id).
- `bom_componentes` (FK a `bom_recetas`, FK a `productos`, cantidad).
- Refactor `ensambles` para apuntar a `bom_recetas`.

## Verificación (futura)

- Crear BOM "Compresor X-100" con 5 componentes.
- Ejecutar 3 ensambles desde ese BOM → 15 componentes restados, 3 compresores creados.
- Reporte de costo promedio del ensamble.

## Notas

- Esta fase NO bloquea v1.0.
- La implementación parcial actual de Fase 7 es suficiente para casos simples uno a uno.
