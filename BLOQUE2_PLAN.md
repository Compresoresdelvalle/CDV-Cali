# Bloque 2 — Catálogo de productos (insumos + ubicación)

> Rama `fix/correcciones-post-deploy`. Migraciones se aplican a **PRODUCCIÓN** vía MCP
> `apply_migration` (un solo proyecto). Probar SOLO con productos `INVENTARIO DE PRUEBA`.

## Decisiones confirmadas con el usuario (2026-05-30)

- **#7 Insumos = pool de stock separado.** El caso real: un filtro con 10 unidades, se
  separan 5 para venta y 5 para insumo; Ventas NO puede tocar las 5 de insumo (si no, las
  vende y al llegar una OT no hay). → stock en **dos baldes** por sede.
  - `inventario.cantidad_insumo` (nuevo balde, separado de `cantidad` = venta).
  - `productos.vendible` (bool): `false` = insumo puro, **oculto en Ventas/Cotizaciones**
    (aerosoles, EPP, cintas…). Los **31** de `categoria='INSUMOS'` → `vendible=false` y su
    stock pasa a `cantidad_insumo`.
  - **Convertir venta↔insumo = SOLO Admin.**
- **#8 Ubicación = STAND (1–8) + POSICIÓN**, a nivel de producto (como su hoja: "stan 2,
  posición 1"). Más una tabla `stands` con la **cercanía a la puerta** para que el módulo
  ABC recomiende el orden (clase A cerca, C al fondo) — la recomendación se hace **después**
  (Bloque 9); aquí solo se **captura** el dato.

### Layout de stands (U, se entra por el lado corto; fondo arriba)

```
        FONDO
   [5]        [4]
[6]              [3]
[7]              [2]
[8]              [1]
       ENTRADA
```

| Stand | Lado                              | orden_cercania (1=más cerca a puerta) |
| :---: | :-------------------------------- | :-----------------------------------: |
|   1   | derecha-abajo (junto a entrada)   |                   1                   |
|   8   | izquierda-abajo (junto a entrada) |                   1                   |
|   2   | derecha-medio                     |                   2                   |
|   7   | izquierda-medio                   |                   2                   |
|   3   | derecha-arriba                    |                   3                   |
|   6   | izquierda-arriba                  |                   3                   |
|   4   | fondo-derecha                     |                   4                   |
|   5   | fondo-izquierda                   |                   4                   |

## Backend (migraciones)

**A1 — esquema aditivo** (`20260530000005`)

- `inventario.cantidad_insumo INTEGER NOT NULL DEFAULT 0 CHECK (>=0)` (espeja `cantidad`).
- `productos.vendible BOOLEAN NOT NULL DEFAULT true`.
- `productos.stand SMALLINT`, `productos.posicion SMALLINT`.
- Tabla `stands (numero SMALLINT PK CHECK 1..8, orden_cercania SMALLINT, lado TEXT, descripcion TEXT)` + seed.
- FK `productos.stand → stands.numero` (nullable).

**A2 — enum (aislado, obligatorio)** (`20260530000006`)

- `tipo_movimiento` += `conversion_a_insumo`, `conversion_a_venta`.

**A3 — funciones + triggers** (`20260530000007`)

- `fn_convertir_a_insumo(p_producto_id uuid, p_sede_id text, p_cantidad int)` — Admin only,
  `FOR UPDATE`, valida `cantidad >= N`, hace `cantidad -= N; cantidad_insumo += N`, registra
  movimiento `conversion_a_insumo`, recalcula estado_stock.
- `fn_revertir_insumo_a_venta(...)` — inverso (`conversion_a_venta`).
- Ajustar **3 triggers de consumo** a `cantidad_insumo`:
  - `trg_orden_consumir_repuesto` (detalle_orden) → consume de `cantidad_insumo`.
  - `trg_orden_revertir_repuesto` (detalle_orden) → devuelve a `cantidad_insumo`.
  - `trg_ensamble_stock`: **componentes** (consumo) de `cantidad_insumo`; **producto
    resultante** (producción) sigue entrando a `cantidad` (es terminado vendible). ⚠️ matiz clave.

**A4 — datos** (`20260530000008`)

- `productos.vendible=false WHERE categoria='INSUMOS'` (31).
- Mover su stock: `inventario.cantidad_insumo += cantidad; cantidad = 0` para esos productos.
- Sin log de movimiento (setup único, sin cambio físico de stock; documentado aquí).

> **Rollout (2026-05-30):** se decidió "escalonado", pero como la **app estaba pausada**
> (sin usuarios en vivo) el usuario autorizó aplicar **TODO** el backend en esta sesión
> (A1, A2, A3a funciones, A3b triggers `...0009`, A4). Verificado: 31 insumos → `vendible=false`,
> 822 uds reclasificadas venta→insumo (total preservado), tabla `stands` (8), 2 funciones.
> El frontend va en la rama y se despliega después. Probar SOLO con `INVENTARIO DE PRUEBA`.

## Frontend (rama)

1. Ventas/Cotizaciones: ocultar `vendible=false` del picker de productos.
2. Picker OT/Ensamble: mostrar insumos (`cantidad_insumo>0`) + acción "Convertir desde venta".
3. UI **Convertir a insumo** (Admin) en inventario / detalle de producto: mover N venta→insumo
   con confirmación; mostrar ambos stocks (venta / insumo).
4. Detalle/inventario de producto: mostrar `cantidad_insumo` junto a `cantidad`.
5. Campos `stand` / `posicion` en `ProductoForm` (editable Admin) y `ProductoDetalle`.

## Notas / pendientes para bloques futuros

- `fn_actualizar_estado_stock` y reórdenes siguen mirando `cantidad` (venta). Afinar alertas
  para insumos (mirar `cantidad_insumo`) → Bloque 9.
- Recomendación ABC de reorganización por cercanía → Bloque 9 (módulo Análisis ABC).
- Ubicación es a nivel de producto (asume bodega principal). Si otros almacenes usan stands,
  extender a `inventario` por sede.
- `categoria` está sucia (typos/duplicados: ACEITE/ACEITES, CODO/CODOS). Limpieza → futuro.
