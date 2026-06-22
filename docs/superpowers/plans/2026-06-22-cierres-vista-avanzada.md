# Cierres — Vista Avanzada (desglose por sede, método, cuenta, producto + arqueo) Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el módulo de Cierres muestre, por sede y de forma desglosada, cómo entró y salió el dinero (efectivo/transferencia/tarjeta), a qué cuenta bancaria, en qué se fue cada egreso (proveedor/concepto), qué productos se vendieron en cada almacén, y un arqueo de caja (efectivo esperado vs. contado). Más dos correcciones menores: aclarar la "conciliación" y permitir contar productos sin fila de inventario.

**Architecture:** Toda la analítica nueva se calcula server-side en `_fn_cierre_totales` y viaja dentro del jsonb `detalle` (retrocompatible: campos nuevos, los cierres viejos simplemente no los tienen y la UI hace guard). El arqueo manual entra por un parámetro nuevo opcional en `fn_generar_cierre` y se recalcula en el servidor (no se confía el "esperado" al cliente). El frontend `Cierres.jsx` renderiza el `detalle` con un set de tabs reutilizable tanto en la vista previa como en el histórico expandido.

**Tech Stack:** PostgreSQL (funciones SECURITY DEFINER, jsonb), Supabase RPC, React 19 + Tailwind con design tokens.

---

## Contexto verificado (estado real a 2026-06-22)

Backend desplegado en prod:

- `_fn_cierre_totales(p_desde date, p_hasta date, p_sede text)` → jsonb. Hoy `detalle` = `{ por_sede:[{sede_id,sede_nombre,productos,servicios,egresos}], por_metodo_pago:[{metodo,productos,servicios}], generado_en, tz }`.
- `fn_preview_cierre(desde,hasta,sede)` → pasa por `_fn_cierre_totales` y añade `fecha_desde/hasta/sede_id/ya_cubierto/solapamiento`. **No requiere cambios** (hereda los campos nuevos del detalle).
- `fn_generar_cierre(p_desde,p_hasta,p_tipo,p_observaciones,p_sede)` → valida Admin, bloquea solapamiento, guarda el jsonb en `cierres.detalle`.

Esquema relevante:

- `cierres`: `detalle jsonb NOT NULL`, sin columna de arqueo → el arqueo va dentro de `detalle.arqueo`.
- `ventas`: `sede_id`, `metodo_pago` (NOT NULL), `cuenta_bancaria` (nullable), `total`, `origen` ('directa'|'ot'), `anulada`, `fecha` (timestamptz).
- `abonos`: `metodo_pago`, `monto`, `fecha`, `orden_id`, `venta_id` (nullable); **sin** `cuenta_bancaria`.
- `compras`: `sede_destino_id`, `metodo_pago` (NOT NULL), `cuenta_bancaria` (nullable), `proveedor`, `factura_proveedor`, `concepto`, `es_caja_menor` (bool), `total`, `estado`, `fecha`.
- `detalle_venta`: `venta_id`, `producto_id` (nullable, null=línea de servicio), `cantidad`, `subtotal`.
- `sedes`: `id` (text), `nombre`, `activa`.

Anti-doble-conteo (se respeta): ingresos_servicios = ventas(origen='ot') + abonos(venta_id IS NULL, OT no cancelada). El desglose por método/cuenta usa la **misma base** que los totales para no descuadrar (ventas directas + ventas-OT + abonos sin venta).

Notas:

- Ventas-OT se generan con `metodo_pago='Varios'` y sin `cuenta_bancaria` → aparecerán en columna "Varios"/"Sin cuenta". Es correcto: la plata real entró como abonos (que sí traen su método).
- Normalización de método: agrupar por `lower(metodo_pago)`. Labels en frontend ya existen (`METODO_LABELS`), añadir `varios`.

---

## Forma final del `detalle` jsonb

```
detalle: {
  por_sede:        [{ sede_id, sede_nombre, productos, servicios, egresos }],         // EXISTE
  por_metodo_pago: [{ metodo, productos, servicios }],                               // EXISTE (se conserva)
  por_sede_metodo: [{ sede_id, sede_nombre, metodo, ingresos, egresos }],            // NUEVO
  por_cuenta:      [{ sede_id, sede_nombre, cuenta, ingresos, egresos }],            // NUEVO
  egresos_detalle: [{ sede_id, sede_nombre, proveedor, concepto, es_caja_menor,
                      factura, metodo, cuenta, total, fecha }],                      // NUEVO
  por_producto:    [{ sede_id, sede_nombre, referencia, nombre, unidades, ingreso }],// NUEVO
  arqueo_esperado: [{ sede_id, sede_nombre, efectivo_esperado }],                    // NUEVO (derivado)
  arqueo:          [{ sede_id, sede_nombre, efectivo_esperado,
                      efectivo_contado, diferencia }],                               // NUEVO (solo al generar, si se capturó)
  generado_en, tz
}
```

`cuenta` null → se etiqueta "Sin cuenta / efectivo" en UI. `metodo` se guarda en minúscula.

---

## Task 1: Backend — `_fn_cierre_totales` con desgloses nuevos

**Files:**

- Create: `supabase/migrations/20260622000001_cierres_detalle_avanzado.sql`

Migración aplicada a prod vía `apply_migration` (constraint: testing solo en prod; cambio aditivo y retrocompatible).

- [ ] **Step 1: Escribir la migración que reemplaza `_fn_cierre_totales`**

`CREATE OR REPLACE FUNCTION public._fn_cierre_totales(p_desde date, p_hasta date, p_sede text DEFAULT NULL)` — misma firma (replace limpio, sin overload). Conserva el cálculo actual de `v_productos/v_servicios/v_egresos/v_anticipos/counts/por_sede/por_metodo` **tal cual** y añade, antes del `return`, estos bloques (todos respetan `p_sede` y la zona `America/Bogota`):

```sql
-- por_sede_metodo: matriz sede × método (ingresos y egresos)
select coalesce(jsonb_agg(jsonb_build_object(
         'sede_id', x.sede_id, 'sede_nombre', x.sede_nombre,
         'metodo', x.metodo, 'ingresos', x.ingresos, 'egresos', x.egresos
       ) order by x.sede_nombre, x.metodo), '[]'::jsonb)
  into v_por_sede_metodo
from (
  select se.id as sede_id, se.nombre as sede_nombre, m.metodo,
         coalesce(sum(m.ingresos),0) as ingresos, coalesce(sum(m.egresos),0) as egresos
  from sedes se
  join (
      select v.sede_id as sede_id, lower(v.metodo_pago) as metodo, v.total as ingresos, 0::numeric as egresos
        from ventas v
       where v.anulada=false and v.origen in ('directa','ot')
         and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
      union all
      select o.sede_id, lower(a.metodo_pago), a.monto, 0::numeric
        from abonos a join ordenes_servicio o on o.id=a.orden_id
       where a.venta_id is null and o.estado<>'cancelada'
         and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
      union all
      select c.sede_destino_id, lower(c.metodo_pago), 0::numeric, c.total
        from compras c
       where c.estado<>'cancelada'
         and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
  ) m on m.sede_id = se.id
  where se.activa=true and (p_sede is null or se.id=p_sede)
    and m.metodo is not null
  group by se.id, se.nombre, m.metodo
) x;

-- por_cuenta: sede × cuenta bancaria (ingresos y egresos)
select coalesce(jsonb_agg(jsonb_build_object(
         'sede_id', x.sede_id, 'sede_nombre', x.sede_nombre,
         'cuenta', x.cuenta, 'ingresos', x.ingresos, 'egresos', x.egresos
       ) order by x.sede_nombre, x.cuenta nulls first), '[]'::jsonb)
  into v_por_cuenta
from (
  select se.id as sede_id, se.nombre as sede_nombre, m.cuenta,
         coalesce(sum(m.ingresos),0) as ingresos, coalesce(sum(m.egresos),0) as egresos
  from sedes se
  join (
      select v.sede_id, nullif(trim(v.cuenta_bancaria),'') as cuenta, v.total as ingresos, 0::numeric as egresos
        from ventas v
       where v.anulada=false and v.origen in ('directa','ot')
         and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
      union all
      select c.sede_destino_id, nullif(trim(c.cuenta_bancaria),''), 0::numeric, c.total
        from compras c
       where c.estado<>'cancelada'
         and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
  ) m on m.sede_id = se.id
  where se.activa=true and (p_sede is null or se.id=p_sede)
  group by se.id, se.nombre, m.cuenta
) x;

-- egresos_detalle: cada compra (en qué se fue el dinero)
select coalesce(jsonb_agg(jsonb_build_object(
         'sede_id', c.sede_destino_id, 'sede_nombre', se.nombre,
         'proveedor', c.proveedor, 'concepto', c.concepto,
         'es_caja_menor', c.es_caja_menor, 'factura', c.factura_proveedor,
         'metodo', lower(c.metodo_pago), 'cuenta', nullif(trim(c.cuenta_bancaria),''),
         'total', c.total, 'fecha', (c.fecha at time zone 'America/Bogota')::date
       ) order by se.nombre, c.fecha), '[]'::jsonb)
  into v_egresos_detalle
from compras c join sedes se on se.id=c.sede_destino_id
where c.estado<>'cancelada'
  and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
  and (p_sede is null or c.sede_destino_id=p_sede);

-- por_producto: productos vendidos por sede (excluye líneas de servicio)
select coalesce(jsonb_agg(jsonb_build_object(
         'sede_id', x.sede_id, 'sede_nombre', x.sede_nombre,
         'referencia', x.referencia, 'nombre', x.nombre,
         'unidades', x.unidades, 'ingreso', x.ingreso
       ) order by x.sede_nombre, x.ingreso desc), '[]'::jsonb)
  into v_por_producto
from (
  select v.sede_id, se.nombre as sede_nombre, p.referencia, p.nombre,
         sum(dv.cantidad) as unidades, sum(dv.subtotal) as ingreso
  from detalle_venta dv
  join ventas v on v.id=dv.venta_id
  join sedes se on se.id=v.sede_id
  join productos p on p.id=dv.producto_id
  where dv.producto_id is not null and v.anulada=false
    and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or v.sede_id=p_sede)
  group by v.sede_id, se.nombre, p.referencia, p.nombre
) x;

-- arqueo_esperado: efectivo esperado por sede = ingresos efectivo - egresos efectivo
select coalesce(jsonb_agg(jsonb_build_object(
         'sede_id', x.sede_id, 'sede_nombre', x.sede_nombre,
         'efectivo_esperado', x.esperado
       ) order by x.sede_nombre), '[]'::jsonb)
  into v_arqueo_esp
from (
  select se.id as sede_id, se.nombre as sede_nombre,
    coalesce((select sum(case when lower(v.metodo_pago)='efectivo' then v.total else 0 end)
              from ventas v where v.sede_id=se.id and v.anulada=false and v.origen='directa'
                and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
   + coalesce((select sum(case when lower(a.metodo_pago)='efectivo' then a.monto else 0 end)
              from abonos a join ordenes_servicio o on o.id=a.orden_id
              where o.sede_id=se.id and a.venta_id is null and o.estado<>'cancelada'
                and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
   - coalesce((select sum(case when lower(c.metodo_pago)='efectivo' then c.total else 0 end)
              from compras c where c.sede_destino_id=se.id and c.estado<>'cancelada'
                and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
      as esperado
  from sedes se
  where se.activa=true and (p_sede is null or se.id=p_sede)
) x;
```

Declarar las variables nuevas (`v_por_sede_metodo jsonb; v_por_cuenta jsonb; v_egresos_detalle jsonb; v_por_producto jsonb; v_arqueo_esp jsonb;`) y añadirlas al `jsonb_build_object('detalle', ...)` final junto a las existentes. Mantener `por_sede`, `por_metodo_pago`, `generado_en`, `tz`.

- [ ] **Step 2: Aplicar la migración a prod**

Vía `apply_migration` con name `cierres_detalle_avanzado`.

- [ ] **Step 3: Verificar con una llamada read-only**

`select fn_preview_cierre('2026-06-01','2026-06-30', null);` y confirmar que `detalle` trae las 5 llaves nuevas y que `ingresos_total`/`margen` no cambiaron respecto al cálculo previo (los campos viejos intactos). Verificar también con `p_sede` de una sede concreta.

---

## Task 2: Backend — arqueo manual en `fn_generar_cierre`

**Files:**

- Modify (misma migración o nueva): `supabase/migrations/20260622000002_cierres_arqueo.sql`

- [ ] **Step 1: Reemplazar `fn_generar_cierre` añadiendo `p_arqueo jsonb`**

Como cambia la lista de argumentos, **dropear el overload viejo** para evitar ambigüedad:

```sql
drop function if exists public.fn_generar_cierre(date,date,text,text,text);
```

Recrear con firma `(p_desde date, p_hasta date, p_tipo text, p_observaciones text DEFAULT NULL, p_sede text DEFAULT NULL, p_arqueo jsonb DEFAULT NULL)`. Mantener todas las validaciones actuales. Antes del `insert`, construir el arqueo final recomputando el esperado server-side (de `v_totales->'detalle'->'arqueo_esperado'`) y cruzando con el `efectivo_contado` que venga en `p_arqueo` (array `[{sede_id, efectivo_contado}]`):

```sql
-- merge arqueo: esperado server-side + contado del cliente
if p_arqueo is not null then
  v_arqueo := (
    select coalesce(jsonb_agg(jsonb_build_object(
       'sede_id', e->>'sede_id', 'sede_nombre', e->>'sede_nombre',
       'efectivo_esperado', (e->>'efectivo_esperado')::numeric,
       'efectivo_contado', coalesce((
          select (a->>'efectivo_contado')::numeric from jsonb_array_elements(p_arqueo) a
          where a->>'sede_id' = e->>'sede_id'), 0),
       'diferencia', coalesce((
          select (a->>'efectivo_contado')::numeric from jsonb_array_elements(p_arqueo) a
          where a->>'sede_id' = e->>'sede_id'), 0) - (e->>'efectivo_esperado')::numeric
    )), '[]'::jsonb)
    from jsonb_array_elements(v_totales->'detalle'->'arqueo_esperado') e
  );
  v_detalle := (v_totales->'detalle') || jsonb_build_object('arqueo', v_arqueo);
else
  v_detalle := v_totales->'detalle';
end if;
```

Insertar `v_detalle` en `cierres.detalle` (en lugar de `v_totales->'detalle'`). Declarar `v_arqueo jsonb; v_detalle jsonb;`.

- [ ] **Step 2: Re-grant execute**

```sql
revoke execute on function public.fn_generar_cierre(date,date,text,text,text,jsonb) from public, anon;
grant execute on function public.fn_generar_cierre(date,date,text,text,text,jsonb) to authenticated;
```

- [ ] **Step 3: Aplicar y verificar en transacción reversible**

Probar en un `do`/rolled-back o un `select` de simulación que pasar `p_arqueo` produce `detalle.arqueo` con `diferencia` correcta, y que sin `p_arqueo` el cierre se genera igual que antes (sin la llave `arqueo`). No dejar cierres de prueba persistidos.

---

## Task 3: Frontend — componente `DetalleCierreAvanzado` (tabs)

**Files:**

- Modify: `src/pages/admin/Cierres.jsx`

Reemplaza el actual `DetalleCierre` (solo "Por sede" + "Por método") por un componente con tabs que cubra todo el `detalle`, reutilizable en preview e histórico. Guard para cierres viejos (campos nuevos ausentes → tab oculto).

- [ ] **Step 1: Añadir labels de método faltantes**

En `METODO_LABELS` añadir `varios: "Varios"`. Añadir helper `cuentaLabel = (c) => c || "Sin cuenta / efectivo"`.

- [ ] **Step 2: Crear `DetalleCierreAvanzado({ detalle })`**

Tabs: `Por sede` (matriz sede×método, pivot: filas=sede, columnas=métodos presentes + Egresos), `Cuentas` (tabla sede/cuenta/ingresos/egresos), `Egresos` (lista `egresos_detalle`: sede, proveedor o concepto si `es_caja_menor`, método, cuenta, total), `Productos` (`por_producto`: sede, referencia, nombre, unidades, ingreso), `Arqueo` (si existe `detalle.arqueo`: sede, esperado, contado, diferencia con token success/destructive). Cada tab solo se muestra si su array tiene datos. Estilo: tokens, patrón `MiniTable` existente, móvil scroll-x. Mantener `Por método` global como sub-bloque del tab "Por sede" o eliminarlo (queda subsumido por la matriz).

- [ ] **Step 3: Pivot de la matriz sede×método**

De `por_sede_metodo` derivar en cliente: set de métodos presentes, y por sede un objeto `{metodo: ingresos}` + `egresos` (sumando los `egresos` de las filas de esa sede, o tomándolo de `por_sede`). Render tabla con columnas dinámicas.

- [ ] **Step 4: Cablear en preview e histórico**

Sustituir los dos usos de `<DetalleCierre detalle=... />` (preview línea ~403 y filas histórico ~997/1059) por `<DetalleCierreAvanzado detalle=... />`.

- [ ] **Step 5: `npm run build` verde**

---

## Task 4: Frontend — captura de arqueo en la vista previa

**Files:**

- Modify: `src/pages/admin/Cierres.jsx`

- [ ] **Step 1: Estado de arqueo**

`const [arqueo, setArqueo] = useState({})` (mapa `sede_id -> contado` string). Reset en `invalidarPreview`.

- [ ] **Step 2: UI de captura**

En la vista previa, bajo los Stats, si `preview.detalle?.arqueo_esperado?.length`, render bloque "Arqueo de caja" con una fila por sede: nombre, esperado (`formatCOP`, solo lectura), input numérico "efectivo contado" (min-h 48px, token styles), y diferencia en vivo `contado - esperado` con color success/destructive. Es **opcional** (si no se llena, no se envía).

- [ ] **Step 3: Pasar `p_arqueo` a `fn_generar_cierre`**

En `generar`, construir `p_arqueo` solo si el usuario capturó algún valor:

```js
const arqueoArr = (preview.detalle?.arqueo_esperado ?? [])
  .filter((e) => arqueo[e.sede_id] !== undefined && arqueo[e.sede_id] !== "")
  .map((e) => ({
    sede_id: e.sede_id,
    efectivo_contado: Number(arqueo[e.sede_id]) || 0,
  }));
const { data, error } = await supabase.rpc("fn_generar_cierre", {
  p_desde: desde,
  p_hasta: hasta,
  p_tipo: tipo,
  p_observaciones: observaciones.trim() || null,
  p_arqueo: arqueoArr.length ? arqueoArr : null,
});
```

- [ ] **Step 4: `npm run build` verde + commit**

---

## Task 5: Menor — aclarar "Conciliación"

**Files:**

- Modify: `src/pages/admin/Cierres.jsx`

- [ ] **Step 1: Subtítulo y panel**

Cambiar el subtítulo (línea ~243) a algo sin botón fantasma, p. ej. "Verificación previa al cierre: revisa ingresos, egresos y margen antes de sellar." Renombrar el título del panel lateral "Checklist de conciliación" → "Verificación previa" y añadir una línea de ayuda en el estado vacío explicando que se llena al previsualizar y que el cierre se firma al generar.

- [ ] **Step 2: `npm run build` verde**

---

## Task 6: Menor — conteo cíclico sin fila de inventario

**Files:**

- Modify: `src/pages/admin/Conteo.jsx`
- Investigar: cómo se crea una fila `inventario` (¿RPC admin o insert directo con RLS?).

- [ ] **Step 1: Verificar mecanismo de alta de inventario**

Buscar en el repo un RPC tipo `fn_*inventario*` o el insert usado por "alta inventariable desde insumos" (commit reciente). Si existe RPC para crear la fila en una sede con cantidad 0, usarlo; si el insert directo está permitido por RLS para Admin/Bodeguero, usarlo.

- [ ] **Step 2: Reemplazar el bloqueo por acción "Iniciar en 0 y contar"**

En `seleccionarProducto` (Conteo.jsx ~874), cuando no hay `inv`: en vez de solo `setError(...)`, guardar el producto en un estado `sinInventario` y mostrar un botón "Iniciar en 0 y contar" (solo Admin/Bodeguero). Al pulsarlo: crear la fila `inventario` (cantidad 0 / cantidad_insumo 0 según corresponda) para `sedeConteo`, luego continuar el flujo normal (`setProductoSel({...p, inventario_id}), setStockSistema(0)`). Mantener el mensaje informativo para roles sin permiso.

- [ ] **Step 3: `npm run build` verde + commit**

---

## Task 7: Verificación integral

- [ ] **Step 1:** `select fn_preview_cierre` de un rango con datos reales → confirmar las 5 llaves nuevas, montos coherentes con totales.
- [ ] **Step 2:** Simular `fn_generar_cierre` con `p_arqueo` en transacción reversible → `detalle.arqueo` correcto, sin persistir.
- [ ] **Step 3:** `npm run build` final verde.
- [ ] **Step 4:** Confirmar que un cierre histórico viejo (sin campos nuevos) sigue renderizando sin romper (guards).
- [ ] **Step 5:** Actualizar memoria del proyecto con el bloque de Cierres completado.

---

## Riesgos / decisiones

- **Retrocompatibilidad:** los campos nuevos son aditivos en `detalle`; el frontend desplegado viejo ignora lo que no lee. Cierres históricos sin los campos → UI con guards (`?.`/length).
- **Doble conteo:** el desglose por método/cuenta usa la misma base que los totales (directa+ot+abonos sin venta) → cuadra con `ingresos_total`.
- **Ventas-OT `Varios`/sin cuenta:** se muestran como "Varios"/"Sin cuenta"; la plata real ya está reflejada vía abonos con su método. Documentado en la UI.
- **Tamaño jsonb:** `por_producto` y `egresos_detalle` en cierres de periodo largo pueden crecer; aceptable para la escala (4 sedes, ~miles de productos pero pocas ventas/día). Si hiciera falta, capar `por_producto` a top-N por sede (no se implementa ahora).
- **Arqueo:** el "esperado" se recalcula server-side al generar; el cliente solo aporta "contado". Opcional.
