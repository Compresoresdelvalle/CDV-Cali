# Retenciones fase 2 (compras) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Compresores del Valle pueda registrar la retención que le hace a un
proveedor, y que esa retención se refleje en lo que sale del cajón (cierre) y en
lo que se le queda debiendo al proveedor (Cuentas por Pagar), sin tocar el gasto
contable.

**Architecture:** Las tres columnas de valor de `compras` pasan a ser generadas
(espejo de `ventas`), así que la app solo manda porcentajes y el servidor hace la
aritmética. `fn_registrar_compra` recibe los tres porcentajes con default 0, de
modo que la firma vieja sigue funcionando y el backend puede desplegarse antes
que el frontend. El cierre resta `retenciones_total` en sus seis sitios de
`compras.total` y la vista `v_cuentas_por_pagar` en su saldo; el camino de
`pagos_cuenta` y el panel de resultado **no se tocan**.

**Tech Stack:** PostgreSQL (Supabase, migraciones vía MCP `apply_migration`),
React 19 + Vite, Vitest (`npm test`), worktree `C:\Users\davi-\cdv-picking-compras`,
rama `feat/retenciones-compras`.

**Spec:** `docs/superpowers/specs/2026-09-07-retenciones-fase2-compras-design.md`

---

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
| --- | --- | --- |
| `supabase/migrations/20260907T1_compras_retencion_generadas.sql` | Recrear las 4 columnas de retención de `compras` como generadas | Crear |
| `supabase/migrations/20260907T2_fn_registrar_compra_retenciones.sql` | `fn_registrar_compra` acepta y guarda los 3 porcentajes | Crear |
| `supabase/migrations/20260907T3_cxp_saldo_neto.sql` | `v_cuentas_por_pagar.saldo` neto de retención | Crear |
| `supabase/migrations/20260907T4_cierre_compras_netas.sql` | Los 6 sitios de `compras.total` en `_fn_cierre_totales` | Crear |
| `src/components/ventas/BloqueRetenciones.jsx` | Prop `modo` que cambia los tres textos | Modificar |
| `src/pages/ops/CompraNueva.jsx` | Captura de porcentajes y envío al RPC | Modificar |
| `src/pages/ops/CompraDetalle.jsx` | Desglose en solo lectura | Modificar |
| `src/pages/ops/Cuentas.jsx` | Corregir el comentario de la fórmula del saldo | Modificar |
| `tests/integration/retenciones-compra-render.test.js` | Render de `modo="compra"` | Crear |

**Reglas del proyecto que aplican aquí** (ver `CLAUDE.md`): nunca hardcodear
colores (usar `hsl(var(--token))`), botones de 48px mínimo, y `CompraNueva` /
`CompraDetalle` usan además su propio CSS local (`iblock`, `cart-line`,
`totals`, `var(--n-500)`) — respetarlo donde ya existe en lugar de mezclarlo.

**Prueba en producción:** este proyecto solo tiene base de producción. Toda
verificación con datos va dentro de `BEGIN ... ROLLBACK` y usa los productos
`INVENTARIO DE PRUEBA (999)`.

---

### Task 1: Columnas de retención de `compras` como generadas

**Files:**
- Create: `supabase/migrations/20260907T1_compras_retencion_generadas.sql`

Hoy `retefuente_valor`, `reteica_valor` y `reteiva_valor` son columnas normales
con default 0, y solo su suma (`retenciones_total`) es generada. Eso deja los
sumandos sin blindar: un `UPDATE` podría dejar el valor pegado a un subtotal
viejo. PostgreSQL no permite convertir una columna existente en generada, así
que hay que bajarlas y recrearlas. Las cuatro valen 0 en todas las filas, así
que no se pierde ningún dato.

- [ ] **Paso 1: Confirmar que no hay datos que perder**

Ejecutar (MCP `execute_sql`):

```sql
select count(*) filter (where coalesce(retefuente_valor,0) <> 0
                          or coalesce(reteica_valor,0) <> 0
                          or coalesce(reteiva_valor,0) <> 0) as con_valor,
       count(*) filter (where coalesce(retefuente_pct,0) <> 0
                          or coalesce(reteica_pct,0) <> 0
                          or coalesce(reteiva_pct,0) <> 0) as con_pct,
       count(*) as total
from compras;
```

Esperado: `con_valor = 0` y `con_pct = 0`. **Si alguno es distinto de 0, PARAR y
avisar**: significa que alguien ya escribió retenciones a mano y recrear las
columnas las borraría.

- [ ] **Paso 2: Escribir la migración**

Crear `supabase/migrations/20260907T1_compras_retencion_generadas.sql`:

```sql
-- Fase 2 de retenciones: blindar los sumandos, no solo la suma.
--
-- En `ventas` las tres columnas de valor son generadas desde el porcentaje y la
-- base, asi que nadie puede escribir un valor que no corresponda. En `compras`
-- eran columnas normales y solo `retenciones_total` era generada: la suma
-- protegida y los sumandos no. Un UPDATE del subtotal dejaba el valor de la
-- retencion pegado al subtotal viejo, y ese desfase es invisible hasta el
-- cierre.
--
-- Sale mas simple que en ventas: compras no tiene domicilio ni descuento
-- porcentual (solo `descuento_valor`) y el IVA es columna guardada, no algo que
-- haya que recalcular.
--
-- Las cuatro columnas valen 0 en todas las filas, verificado antes de correr
-- esto, asi que recrearlas no toca ningun dato.

alter table compras drop column if exists retenciones_total;
alter table compras drop column if exists retefuente_valor;
alter table compras drop column if exists reteica_valor;
alter table compras drop column if exists reteiva_valor;

alter table compras
  add column retefuente_valor numeric
    generated always as (
      round(greatest(0, coalesce(subtotal,0) - coalesce(descuento_valor,0))
            * coalesce(retefuente_pct,0) / 100)
    ) stored,
  add column reteica_valor numeric
    generated always as (
      round(greatest(0, coalesce(subtotal,0) - coalesce(descuento_valor,0))
            * coalesce(reteica_pct,0) / 100)
    ) stored,
  add column reteiva_valor numeric
    generated always as (
      round(coalesce(iva,0) * coalesce(reteiva_pct,0) / 100)
    ) stored;

alter table compras
  add column retenciones_total numeric
    generated always as (
      round(greatest(0, coalesce(subtotal,0) - coalesce(descuento_valor,0))
            * coalesce(retefuente_pct,0) / 100)
    + round(greatest(0, coalesce(subtotal,0) - coalesce(descuento_valor,0))
            * coalesce(reteica_pct,0) / 100)
    + round(coalesce(iva,0) * coalesce(reteiva_pct,0) / 100)
    ) stored;

comment on column compras.retenciones_total is
  'Lo que la empresa le retiene al proveedor y consigna a la DIAN. Se resta de '
  'lo que sale del cajon (cierre) y del saldo por pagar, NUNCA del gasto: una '
  'retencion no abarata la mercancia.';
```

Una columna generada no puede referirse a otra generada, por eso
`retenciones_total` repite las tres expresiones en vez de sumar las columnas.
Cada una se redondea por separado y después se suman, igual que en `ventas` y
que en `src/lib/retenciones.js`; redondear la suma daría un peso de diferencia
entre lo que la pantalla promete y lo que la base guarda.

- [ ] **Paso 3: Aplicar la migración**

Aplicar con el MCP de Supabase (`apply_migration`, name
`compras_retencion_generadas`) usando el cuerpo del paso 2.

- [ ] **Paso 4: Verificar que quedaron generadas y que calculan bien**

```sql
select column_name, is_generated from information_schema.columns
where table_name='compras' and column_name like '%rete%' order by ordinal_position;
```

Esperado: las seis columnas listadas, con `retefuente_valor`, `reteica_valor`,
`reteiva_valor` y `retenciones_total` en `ALWAYS`, y los tres `_pct` en `NEVER`.

Luego, contra una compra real sin tocarla:

```sql
begin;
update compras set retefuente_pct = 2.5, reteica_pct = 0.414, reteiva_pct = 15
 where id = (select id from compras where estado <> 'cancelada'
              and coalesce(subtotal,0) > 0 order by fecha desc limit 1);
select subtotal, descuento_valor, iva,
       retefuente_valor, reteica_valor, reteiva_valor, retenciones_total
  from compras where retefuente_pct = 2.5;
rollback;
```

Esperado: `retefuente_valor = round((subtotal - descuento) * 0.025)`,
`reteiva_valor = round(iva * 0.15)` y `retenciones_total` igual a la suma de las
tres. Comprobar la aritmética a mano con los números que devuelva.

- [ ] **Paso 5: Commit**

```bash
git add supabase/migrations/20260907T1_compras_retencion_generadas.sql
git commit -m "feat(retenciones): las tres columnas de valor de compras son generadas

Fase 1 dejo blindada la suma pero no los sumandos: retenciones_total era
generada y las tres columnas de valor eran normales con default 0. Un UPDATE
del subtotal dejaba el valor de la retencion pegado al subtotal viejo, y ese
desfase no se nota hasta que el cierre no cuadra.

Ahora son generadas, espejo de ventas. Salen mas simples porque compras no
tiene domicilio ni descuento porcentual y el IVA ya esta guardado.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `fn_registrar_compra` recibe los tres porcentajes

**Files:**
- Create: `supabase/migrations/20260907T2_fn_registrar_compra_retenciones.sql`

Los tres parámetros van **al final** de la firma y con default 0. Así la llamada
que hace hoy `CompraNueva` sigue siendo válida, y el backend puede quedar en
producción antes que el frontend sin romper nada.

- [ ] **Paso 1: Escribir la migración**

Crear `supabase/migrations/20260907T2_fn_registrar_compra_retenciones.sql` con
el cuerpo completo de la función actual (obtenerlo con
`select pg_get_functiondef(oid) from pg_proc where proname='fn_registrar_compra'`)
y estos cuatro cambios exactos:

1. En la firma, después de `p_descuento_valor numeric DEFAULT NULL::numeric`, agregar:

```sql
  , p_retefuente_pct numeric DEFAULT 0
  , p_reteica_pct    numeric DEFAULT 0
  , p_reteiva_pct    numeric DEFAULT 0
```

2. En el bloque `declare`, después de `v_metodo text;`, agregar:

```sql
  v_rf numeric; v_ri numeric; v_riva numeric;
```

3. Justo después de la línea `v_iva_pct := greatest(0, least(100, coalesce(p_iva_pct, 19)));`, agregar:

```sql
  -- Retenciones: la empresa como agente retenedor. Se recortan a [0,100] igual
  -- que el CHECK de la tabla, para no mandar nunca algo que el servidor vaya a
  -- rechazar con un mensaje de constraint. Los VALORES no se calculan aqui: las
  -- columnas de compras son generadas.
  v_rf   := greatest(0, least(100, coalesce(p_retefuente_pct, 0)));
  v_ri   := greatest(0, least(100, coalesce(p_reteica_pct, 0)));
  v_riva := greatest(0, least(100, coalesce(p_reteiva_pct, 0)));
```

4. En el `insert into compras (...)`, agregar a la lista de columnas, después de
`descuento_valor`:

```sql
    , retefuente_pct, reteica_pct, reteiva_pct
```

y a la lista de valores, después de `nullif(v_desc, 0)`:

```sql
    , v_rf, v_ri, v_riva
```

Nada más cambia. En particular, el `returning` y el `jsonb_build_object` final
se quedan como están.

- [ ] **Paso 2: Aplicar la migración**

Aplicar con `apply_migration`, name `fn_registrar_compra_retenciones`.

- [ ] **Paso 3: Verificar que la firma vieja sigue sirviendo**

```sql
select pg_get_function_identity_arguments(oid)
from pg_proc where proname='fn_registrar_compra' and pronamespace='public'::regnamespace;
```

Esperado: **una sola** fila (si salen dos, se creó una sobrecarga por haber
cambiado el orden o el tipo de un parámetro; hay que borrar la vieja con
`drop function` indicando su firma exacta, porque una llamada ambigua desde
PostgREST falla en tiempo de ejecución). La firma debe terminar en
`p_descuento_valor numeric, p_retefuente_pct numeric, p_reteica_pct numeric, p_reteiva_pct numeric`.

- [ ] **Paso 4: Verificar que guarda y que calcula**

```sql
begin;
select fn_registrar_compra(
  p_sede_id := 'BOD-PRINCIPAL',
  p_proveedor := 'PRUEBA RETENCION FASE 2',
  p_items := jsonb_build_array(jsonb_build_object(
     'producto_id', (select id from productos where nombre ilike '%INVENTARIO DE PRUEBA%' and activo limit 1),
     'cantidad', 10, 'costo_unitario', 100000, 'destino', 'venta')),
  p_iva_pct := 19,
  p_metodo_pago := 'Efectivo',
  p_retefuente_pct := 2.5
) as creada;
select subtotal, iva, total, retefuente_pct, retefuente_valor, retenciones_total
  from compras where proveedor = 'PRUEBA RETENCION FASE 2';
rollback;
```

Esperado: `subtotal = 1000000`, `iva = 190000`, `total = 1190000`,
`retefuente_valor = 25000`, `retenciones_total = 25000`. Si `retefuente_valor`
sale 0, el `insert` no está guardando el porcentaje.

Correr también la misma llamada **sin** los parámetros de retención y confirmar
que no falla y que `retenciones_total` queda en 0.

- [ ] **Paso 5: Commit**

```bash
git add supabase/migrations/20260907T2_fn_registrar_compra_retenciones.sql
git commit -m "feat(retenciones): fn_registrar_compra guarda los tres porcentajes

Van al final de la firma y con default 0, asi que la llamada que hace hoy
CompraNueva sigue siendo valida y el backend puede quedar en produccion antes
que el frontend sin romper nada.

Solo guarda porcentajes: los valores los calcula la base, porque las columnas
son generadas.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: El saldo de Cuentas por Pagar nace neto

**Files:**
- Create: `supabase/migrations/20260907T3_cxp_saldo_neto.sql`
- Modify: `src/pages/ops/Cuentas.jsx:44-46`

Este es el hueco que fase 1 dejó partido: `fn_registrar_pago_cuenta` ya resta
`retenciones_total` en su rama de pago, pero la vista no. Con una retención
real, la pantalla mostraría un saldo que el servidor rechaza pagar.

- [ ] **Paso 1: Reproducir el hueco antes de taparlo**

```sql
begin;
update compras set retefuente_pct = 2.5
 where id = (select compra_id from v_cuentas_por_pagar
              where saldo > 100000 order by fecha desc limit 1);
select v.numero, v.total, v.retenciones_total, v.saldo,
       v.total - v.retenciones_total - v.pagos as saldo_correcto
  from v_cuentas_por_pagar v where v.retenciones_total > 0;
rollback;
```

Esperado: `saldo` y `saldo_correcto` difieren exactamente en
`retenciones_total`. Esto confirma el bug antes de arreglarlo.

- [ ] **Paso 2: Escribir la migración**

Crear `supabase/migrations/20260907T3_cxp_saldo_neto.sql`:

```sql
-- El saldo por pagar nace neto de la retencion, igual que el saldo por cobrar.
--
-- Fase 1 dejo esto partido: v_cuentas_por_cobrar.saldo resta retenciones_total
-- pero v_cuentas_por_pagar.saldo no, mientras que fn_registrar_pago_cuenta SI
-- la resta en su rama de pago. Con una retencion real la pantalla mostraria un
-- saldo de un millon y el servidor rechazaria cualquier pago mayor a
-- novecientos cincuenta mil, con un mensaje que contradice lo que la misma
-- pantalla acaba de mostrar. La compra jamas llegaria a "pagada".
--
-- Se resta aqui y NO en el camino de pagos_cuenta. Restarla en los dos seria
-- restarla dos veces: el saldo ya nace neto, asi que el pago que se registra
-- contra el ya es plata real.

create or replace view v_cuentas_por_pagar as
 select c.id as compra_id,
    c.numero,
    c.fecha,
    c.proveedor,
    c.sede_destino_id,
    c.estado,
    coalesce(c.total, 0::numeric) as total,
    coalesce(pc.pagos, 0::numeric) as pagos,
    ((coalesce(c.total, 0::numeric) - coalesce(c.retenciones_total, 0::numeric))
      - coalesce(pc.pagos, 0::numeric)) as saldo,
    coalesce(c.retenciones_total, 0::numeric) as retenciones_total
   from compras c
     left join lateral ( select sum(p.monto) as pagos
           from pagos_cuenta p
          where p.compra_id = c.id and p.tipo = 'pago'::text
            and coalesce(p.anulado, false) = false) pc on true
  where c.metodo_pago = 'Crédito'::text and c.estado <> 'cancelada'::estado_compra;
```

- [ ] **Paso 3: Aplicar y verificar**

Aplicar con `apply_migration`, name `cxp_saldo_neto`. Luego repetir el SQL del
paso 1: ahora `saldo` y `saldo_correcto` deben ser iguales.

Verificar además que la vista conserva sus permisos:

```sql
select grantee, privilege_type from information_schema.role_table_grants
where table_name = 'v_cuentas_por_pagar';
```

Esperado: `authenticated` con `SELECT`. **Si no aparece**, `create or replace
view` no conservó el grant y hay que reponerlo con
`grant select on v_cuentas_por_pagar to authenticated;`.

- [ ] **Paso 4: Corregir el comentario que decía lo contrario**

En `src/pages/ops/Cuentas.jsx`, reemplazar el bloque de las líneas 44-46:

```js
 * Estado de cuenta: NO es una columna, se deriva de saldo vs total. Como
 * `saldo = total - retenciones - abonado` en ambas vistas (la retención de
 * compras es fase 2 y hoy vale 0), "parcial" equivale a "abonado > 0",
```

por:

```js
 * Estado de cuenta: NO es una columna, se deriva de saldo vs total. Como
 * `saldo = total - retenciones - abonado` en ambas vistas (en la de pagar eso
 * es cierto desde la fase 2; antes el saldo salía bruto y contradecía a
 * fn_registrar_pago_cuenta), "parcial" equivale a "abonado > 0",
```

- [ ] **Paso 5: Correr la suite y commitear**

```bash
npm test
```

Esperado: todo en verde, mismo número de pruebas que antes (nada cambió de
comportamiento en el frontend, solo un comentario).

```bash
git add supabase/migrations/20260907T3_cxp_saldo_neto.sql src/pages/ops/Cuentas.jsx
git commit -m "fix(retenciones): el saldo por pagar nace neto de la retencion

v_cuentas_por_cobrar.saldo restaba retenciones_total y v_cuentas_por_pagar.saldo
no, pero fn_registrar_pago_cuenta SI la restaba en su rama de pago. Con una
retencion real la pantalla mostraria un saldo de un millon y el servidor
rechazaria cualquier pago mayor a novecientos cincuenta mil, con un mensaje que
contradice lo que la misma pantalla acaba de mostrar, y la compra nunca llegaria
a pagada.

El comentario de Cuentas.jsx afirmaba que la formula era igual en ambas vistas.
No lo era; ahora si.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Los seis sitios de `compras.total` en el cierre

**Files:**
- Create: `supabase/migrations/20260907T4_cierre_compras_netas.sql`

El spec de fase 1 decía "dos sitios". Son seis. Si se arreglan unos y se olvidan
otros, el cierre se contradice consigo mismo: el total dice una cosa y el arqueo
otra, y la diferencia aparece al cuadrar la caja.

- [ ] **Paso 1: Contar los sitios antes de tocarlos**

```sql
select (length(pg_get_functiondef(oid)) - length(replace(pg_get_functiondef(oid), 'from compras', ''))) / 12 as apariciones
from pg_proc where proname='_fn_cierre_totales' and pronamespace='public'::regnamespace;
```

Anotar el número. Al terminar debe ser el mismo: no se agregan ni se quitan
consultas, solo cambia lo que suman.

- [ ] **Paso 2: Escribir la migración**

Obtener el cuerpo completo con
`select pg_get_functiondef(oid) from pg_proc where proname='_fn_cierre_totales'`
y crear `supabase/migrations/20260907T4_cierre_compras_netas.sql` con ese cuerpo
y **exactamente seis** reemplazos. Estos son los seis, con su contexto para no
confundirlos:

| # | Variable | Texto actual | Texto nuevo |
| --- | --- | --- | --- |
| 1 | `v_egresos` | `sum(total) from compras` | `sum(total - coalesce(retenciones_total,0)) from compras` |
| 2 | `v_por_sede` (subconsulta `egresos`) | `sum(c.total) from compras c where c.sede_destino_id=se.id` | `sum(c.total - coalesce(c.retenciones_total,0)) from compras c where c.sede_destino_id=se.id` |
| 3 | `v_por_sede_metodo` | `select c.sede_destino_id, lower(c.metodo_pago), 0::numeric, c.total from compras c` | `select c.sede_destino_id, lower(c.metodo_pago), 0::numeric, c.total - coalesce(c.retenciones_total,0) from compras c` |
| 4 | `v_por_cuenta` | `select c.sede_destino_id, nullif(trim(c.cuenta_bancaria),''), 0::numeric, c.total from compras c` | `select c.sede_destino_id, nullif(trim(c.cuenta_bancaria),''), 0::numeric, c.total - coalesce(c.retenciones_total,0) from compras c` |
| 5 | `v_egresos_detalle` | `'total', c.total, 'fecha', (c.fecha at time zone 'America/Bogota')::date) as obj` | `'total', c.total - coalesce(c.retenciones_total,0), 'fecha', (c.fecha at time zone 'America/Bogota')::date) as obj` |
| 6 | `v_arqueo_esp` | `sum(case when lower(c.metodo_pago)='efectivo' then c.total else 0 end)` | `sum(case when lower(c.metodo_pago)='efectivo' then c.total - coalesce(c.retenciones_total,0) else 0 end)` |

**Lo que NO se toca, y es igual de importante:**

- Ninguna de las consultas sobre `pagos_cuenta` con `pc.tipo='pago'`. El saldo ya
  nace neto desde Task 3, así que el pago que se registra contra él ya es plata
  real. Restar ahí también sería restar dos veces, y ese es el bug que descuadra
  la caja.
- El contador `v_cc`: cuenta documentos, no plata.
- Las consultas de `garantias_venta`, `devoluciones` y todo el lado de ventas.

Encabezar el archivo con:

```sql
-- Cierre: una compra de contado saca del cajon el NETO, no el total.
--
-- Seis sitios, no dos como decia el spec de fase 1: total global, por sede, por
-- sede y metodo, por sede y cuenta, detalle de egresos y arqueo esperado. Son
-- los mismos seis que fase 1 toco para ventas. Arreglar unos y olvidar otros
-- deja el cierre contradiciendose a si mismo, con el total diciendo una cosa y
-- el arqueo otra, y la diferencia aparece al cuadrar la caja, cuando ya nadie
-- se acuerda de que compra la causo.
--
-- El camino de pagos_cuenta NO se toca en ninguno de los seis: el saldo por
-- pagar ya nace neto, asi que el pago registrado contra el ya es plata real.
-- Restarla en los dos lados seria restarla dos veces.
```

- [ ] **Paso 3: Aplicar la migración**

Aplicar con `apply_migration`, name `cierre_compras_netas`.

- [ ] **Paso 4: Verificar que el cierre de hoy no cambió**

```sql
select fn_preview_cierre(current_date, current_date, null);
```

Comparar contra el resultado de la misma llamada antes de aplicar (guardarlo en
el paso 1 si hace falta). Como hoy ninguna compra tiene retención, **todos los
números deben ser idénticos**. Cualquier diferencia significa que un reemplazo
tocó algo que no debía.

- [ ] **Paso 5: Verificar que con retención sí cambia, y en los seis sitios**

```sql
begin;
update compras set retefuente_pct = 2.5
 where id = (select id from compras
              where estado <> 'cancelada' and metodo_pago = 'Efectivo'
                and coalesce(subtotal,0) > 0
                and (fecha at time zone 'America/Bogota')::date = current_date
              order by fecha desc limit 1);
select retenciones_total from compras where retefuente_pct = 2.5;
select fn_preview_cierre(current_date, current_date, null);
rollback;
```

Esperado, llamando `R` al `retenciones_total` que devuelve la primera consulta:

1. `egresos` bajó exactamente `R`.
2. En `detalle.por_sede`, el `egresos` de la sede de esa compra bajó `R`.
3. En `detalle.por_sede_metodo`, la fila `efectivo` de esa sede bajó `R`.
4. En `detalle.por_cuenta`, la fila correspondiente bajó `R`.
5. En `detalle.egresos_detalle`, la línea de esa compra muestra el neto.
6. En `detalle.arqueo_esperado`, el `efectivo_esperado` de esa sede subió `R`
   (sube porque es una resta que se hizo más pequeña).

Y `margen` subió `R`, porque `margen = ingresos - egresos`.

**Si la compra elegida no es de hoy o no es en efectivo, el paso 6 no se puede
comprobar.** Si la consulta no devuelve ninguna fila, registrar una compra de
prueba dentro de la misma transacción con el `fn_registrar_compra` del Task 2 y
seguir desde ahí.

- [ ] **Paso 6: Commit**

```bash
git add supabase/migrations/20260907T4_cierre_compras_netas.sql
git commit -m "feat(retenciones): el cierre saca del cajon el neto de la compra

Seis sitios, no dos como decia el spec de fase 1: total global, por sede, por
sede y metodo, por sede y cuenta, detalle de egresos y arqueo esperado. Los
mismos seis que fase 1 toco para ventas.

El camino de pagos_cuenta queda intacto a proposito. El saldo por pagar ya nace
neto, asi que el pago registrado contra el ya es plata real; restarla en los dos
lados seria restarla dos veces, y ese es el bug que descuadra la caja.

Verificado contra produccion en BEGIN/ROLLBACK: sin retencion el cierre da
identico, y con 2,5% los seis numeros se mueven en la misma cifra.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `BloqueRetenciones` aprende el modo compra

**Files:**
- Create: `tests/integration/retenciones-compra-render.test.js`
- Modify: `src/components/ventas/BloqueRetenciones.jsx`

El sentido del dinero es opuesto, así que solo cambian tres textos. Sin la prop,
el componente se comporta exactamente como hoy.

- [ ] **Paso 1: Escribir la prueba que falla**

Crear `tests/integration/retenciones-compra-render.test.js`:

```js
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import BloqueRetenciones from "../../src/components/ventas/BloqueRetenciones";

/**
 * El bloque de retenciones se comparte entre venta y compra, pero el sentido
 * del dinero es el opuesto: en venta el cliente nos retiene y nos entra menos;
 * en compra nosotros le retenemos al proveedor y le pagamos menos.
 *
 * Si los textos se cruzan, el bodeguero lee "Neto a recibir" mientras le está
 * pagando a alguien, y eso es exactamente el tipo de confusión que termina en
 * una caja descuadrada.
 */

const montar = (props) =>
  renderToStaticMarkup(createElement(BloqueRetenciones, props));

const BASE = {
  base: 1000000,
  iva: 190000,
  total: 1190000,
  valores: { retefuentePct: 0, reteicaPct: 0, reteivaPct: 0 },
};

describe("BloqueRetenciones en modo compra", () => {
  it("invita a retenerle al proveedor, no a que el cliente retenga", () => {
    const html = montar({ ...BASE, modo: "compra" });
    expect(html).toContain("¿Le retenemos al proveedor?");
    expect(html).not.toContain("El cliente retiene");
  });

  it("abierto dice Neto a pagar, no Neto a recibir", () => {
    const html = montar({ ...BASE, modo: "compra", abierto: true });
    expect(html).toContain("Neto a pagar");
    expect(html).not.toContain("Neto a recibir");
  });

  it("sin modo se comporta como venta, igual que hoy", () => {
    const html = montar({ ...BASE, abierto: true });
    expect(html).toContain("¿El cliente retiene?");
    expect(html).toContain("Neto a recibir");
  });

  it("no aplica ninguna tarifa sugerida al montar", () => {
    const html = montar({
      ...BASE,
      modo: "compra",
      abierto: true,
      sugeridas: { retefuentePct: 2.5, reteicaPct: 0.414, reteivaPct: 15 },
    });
    // El neto debe seguir siendo el total completo: abrir no retiene nada.
    // Con esas tres tarifas la retención sería 25.000 + 4.140 + 28.500 =
    // 57.640, y el neto 1.132.360. Ese número no puede aparecer.
    expect(html).toContain("1.190.000");
    expect(html).not.toContain("1.132.360");
  });

  it("con retención manda el monto en el encabezado", () => {
    const html = montar({
      ...BASE,
      modo: "compra",
      valores: { retefuentePct: 2.5, reteicaPct: 0, reteivaPct: 0 },
    });
    expect(html).toContain("25.000");
    expect(html).not.toContain("¿Le retenemos al proveedor?");
  });
});
```

- [ ] **Paso 2: Correr la prueba y verificar que falla**

```bash
npm test -- retenciones-compra-render
```

Esperado: FALLAN las dos primeras (`¿Le retenemos al proveedor?` y
`Neto a pagar` no existen todavía). Las otras tres pasan ya.

- [ ] **Paso 3: Implementar la prop `modo`**

En `src/components/ventas/BloqueRetenciones.jsx`:

Agregar a la lista de props de `BloqueRetenciones`, después de `sugeridas = null,`:

```js
  modo = "venta",
```

Justo antes del `return (`, agregar:

```js
  // El sentido del dinero es el opuesto en cada lado: en venta el cliente nos
  // retiene y nos entra menos; en compra nosotros le retenemos al proveedor y
  // le pagamos menos. La aritmética es idéntica, solo cambian las palabras.
  const esCompra = modo === "compra";
  const invitacion = esCompra
    ? "¿Le retenemos al proveedor? Tocar para aplicar"
    : "¿El cliente retiene? Tocar para aplicar";
  const etiquetaNeto = esCompra ? "Neto a pagar" : "Neto a recibir";
  const etiquetaTotal = esCompra ? "Total de la factura" : "Total facturado";
```

Reemplazar el ternario del encabezado:

```js
            : "¿El cliente retiene? Tocar para aplicar"}
```

por:

```js
            : invitacion}
```

Reemplazar el texto `Total facturado` del pie por `{etiquetaTotal}` y el texto
`Neto a recibir` por `{etiquetaNeto}`.

En el JSDoc del componente, agregar antes de `@param {boolean}  [p.abierto]`:

```
 * @param {"venta"|"compra"} [p.modo] cambia las palabras, no la aritmética
```

Y en el párrafo de descripción, cambiar la primera línea:

```
 * Bloque plegable de retenciones, compartido por Nueva Venta y la OT.
```

por:

```
 * Bloque plegable de retenciones, compartido por Nueva Venta, la OT y Nueva
 * Compra. En venta el cliente nos retiene; en compra le retenemos al proveedor.
```

- [ ] **Paso 4: Correr las pruebas**

```bash
npm test
```

Esperado: las cinco de `retenciones-compra-render` en verde, y toda la suite
anterior también (incluida `retenciones-render.test.js`, que monta el bloque sin
`modo` y debe seguir viendo los textos de venta).

- [ ] **Paso 5: Commit**

```bash
git add src/components/ventas/BloqueRetenciones.jsx tests/integration/retenciones-compra-render.test.js
git commit -m "feat(retenciones): el bloque aprende el modo compra

El sentido del dinero es el opuesto: en venta el cliente nos retiene y nos entra
menos; en compra nosotros le retenemos al proveedor y le pagamos menos. La
aritmetica es identica, asi que se comparte el componente y solo cambian tres
textos. Sin la prop se comporta exactamente como hoy.

Si los textos se cruzaran, el bodeguero leeria 'Neto a recibir' mientras le esta
pagando a alguien.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Nueva Compra captura la retención

**Files:**
- Modify: `src/pages/ops/CompraNueva.jsx`

Solo en `modo === "normal"` (orden de compra). Caja menor es un recibo de
transporte o un cafetería: no lleva retención y usa otro camino
(`guardarCajaMenor`).

> **Ojo con el nombre `modo`.** `CompraNueva` ya tiene un estado propio llamado
> `modo` (`"normal"` | `"caja_menor"`). La prop `modo="compra"` que se le pasa a
> `BloqueRetenciones` es un literal en el JSX y no choca con él, pero no hay que
> confundirlos: son dos cosas distintas que se llaman igual.

- [ ] **Paso 1: Importar lo necesario**

En `src/pages/ops/CompraNueva.jsx`, después de la línea 21
(`import NumeroInput from "../../components/forms/NumeroInput";`), agregar:

```js
import BloqueRetenciones from "../../components/ventas/BloqueRetenciones";
import {
  calcularRetenciones,
  CLAVES_TARIFA_RETENCION,
} from "../../lib/retenciones";
```

- [ ] **Paso 2: Agregar el estado y las tarifas sugeridas**

Después de la línea 43 (`const [descuentoValor, setDescuentoValor] = useState(0);`), agregar:

```js
  // Retenciones: la empresa como agente retenedor. Arrancan en CERO, nunca en
  // las tarifas sugeridas. Si se precargaran solas, bastaría abrir el bloque
  // por curiosidad para que el sistema diera por salidos $950.000 mientras del
  // cajón salió un millón, y el descuadre aparece al cerrar.
  const [retenciones, setRetenciones] = useState({
    retefuentePct: 0,
    reteicaPct: 0,
    reteivaPct: 0,
  });
  const [tarifasSugeridas, setTarifasSugeridas] = useState(null);
```

Agregar un `useEffect` **nuevo** (no meterlo en el que carga `cuentasBanco`: ese
tiene sus propias dependencias y mezclarlos vuelve a disparar una consulta que no
hace falta). Va junto a los demás `useEffect` del componente, y carga las tarifas — son las **mismas tres claves que
ventas**, porque son las tarifas de ley y duplicarlas solo crearía un segundo
sitio donde quedarse desactualizado:

```js
  useEffect(() => {
    let vivo = true;
    supabase
      .from("parametros_sistema")
      .select("key, value")
      .in("key", Object.values(CLAVES_TARIFA_RETENCION))
      .then(({ data }) => {
        if (!vivo || !data) return;
        const porClave = Object.fromEntries(
          data.map((p) => [p.key, Number(p.value) || 0]),
        );
        setTarifasSugeridas({
          retefuentePct: porClave[CLAVES_TARIFA_RETENCION.retefuentePct] ?? 0,
          reteicaPct: porClave[CLAVES_TARIFA_RETENCION.reteicaPct] ?? 0,
          reteivaPct: porClave[CLAVES_TARIFA_RETENCION.reteivaPct] ?? 0,
        });
      });
    return () => {
      vivo = false;
    };
  }, []);
```

- [ ] **Paso 3: Calcular el neto**

Después de la línea 300 (`const total = subtotal - descuento + iva;`), agregar:

```js
  // Espejo exacto de las columnas generadas de `compras`: la base es el
  // subtotal menos el descuento, y el reteIVA va sobre el IVA. Si esta fórmula
  // y la del servidor divergen, la pantalla promete un neto distinto del que
  // va a salir del cajón.
  const retencionesCalculadas = calcularRetenciones({
    base: subtotal - descuento,
    iva,
    total,
    retefuentePct: retenciones.retefuentePct,
    reteicaPct: retenciones.reteicaPct,
    reteivaPct: retenciones.reteivaPct,
  });
```

- [ ] **Paso 4: Montar el bloque en la columna principal**

En el JSX, justo **después** del bloque `{modo === "normal" && ( ... )}` que
contiene "Pago de la compra" (el que termina alrededor de la línea 1127 con el
texto "Se resta del subtotal antes del IVA."), agregar:

```jsx
          {/* Retenciones: nosotros como agente retenedor. Solo en orden de
              compra — un recibo de caja menor no lleva retención. */}
          {modo === "normal" && (
            <BloqueRetenciones
              modo="compra"
              base={subtotal - descuento}
              iva={iva}
              total={total}
              valores={retenciones}
              onChange={setRetenciones}
              sugeridas={tarifasSugeridas}
            />
          )}
```

- [ ] **Paso 5: Mostrar el neto en el resumen pegajoso**

En el `aside.cart`, justo después del bloque `<div className="cart-line tot">`
que dice "Total estimado", agregar:

```jsx
              {retencionesCalculadas.hay && (
                <>
                  <div
                    className="cart-line"
                    style={{ color: "var(--warn-700)" }}
                  >
                    <span>Retenciones</span>
                    <span className="v" style={{ color: "var(--warn-700)" }}>
                      −{formatCOP(retencionesCalculadas.total)}
                    </span>
                  </div>
                  <div className="cart-line tot">
                    <span>Neto a pagar</span>
                    <span className="v">
                      {formatCOP(retencionesCalculadas.neto)}
                    </span>
                  </div>
                </>
              )}
```

Se usan las clases locales `cart-line` / `tot` y `var(--warn-700)` porque es lo
que ya usa esa tarjeta para el descuento; mezclar ahí los tokens del sistema de
diseño se vería como un parche.

- [ ] **Paso 6: Mandar los porcentajes al RPC**

En `guardarCompra`, dentro de la llamada a `supabase.rpc("fn_registrar_compra", {...})`,
después de `p_descuento_valor: descuento,`, agregar:

```js
        p_retefuente_pct: retenciones.retefuentePct,
        p_reteica_pct: retenciones.reteicaPct,
        p_reteiva_pct: retenciones.reteivaPct,
```

- [ ] **Paso 7: Verificar que compila y que la suite sigue verde**

```bash
npm run lint && npm run build && npm test
```

Esperado: los tres en verde. `npm run build` es el que atrapa un import mal
escrito; `npm test` no monta esta pantalla.

- [ ] **Paso 8: Commit**

```bash
git add src/pages/ops/CompraNueva.jsx
git commit -m "feat(retenciones): Nueva Compra captura lo que le retenemos al proveedor

El bloque va en la columna principal, debajo de la forma de pago, y solo en
orden de compra: un recibo de caja menor no lleva retencion y ademas usa otro
camino de guardado.

Arranca en cero, nunca en las tarifas sugeridas. Si se precargaran solas
bastaria abrirlo por curiosidad para que el sistema diera por salidos \$950.000
mientras del cajon salio un millon.

El resumen pegajoso muestra la retencion y el neto a pagar con las clases
locales de esa tarjeta, no con los tokens del sistema de diseno, para que no se
vea como un parche.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: El detalle de la compra muestra el desglose

**Files:**
- Modify: `src/pages/ops/CompraDetalle.jsx`

Quien va a pagarle al proveedor tiene que ver de dónde salió el neto. Acá **no**
se monta `BloqueRetenciones`: el bloque de totales de esta pantalla tiene su
propio CSS (`totals`, `ln`, `tot`) y meterle una tarjeta con tokens distintos se
vería fuera de lugar. Se agregan líneas al patrón que ya existe para el
descuento.

- [ ] **Paso 1: Traer las columnas**

En el `.select(...)` de `compras` (línea 78), cambiar:

```
             metodo_pago, cuenta_bancaria, descuento_valor, es_caja_menor, concepto,
```

por:

```
             metodo_pago, cuenta_bancaria, descuento_valor, es_caja_menor, concepto,
             retefuente_pct, reteica_pct, reteiva_pct,
             retefuente_valor, reteica_valor, reteiva_valor, retenciones_total,
```

- [ ] **Paso 2: Agregar el desglose al bloque de totales**

En el `<div className="totals">`, justo **después** del `<div className="ln tot">`
que muestra "Total", agregar:

```jsx
              {/* Lo que le retenemos al proveedor y consignamos a la DIAN. La
                  factura no cambia: cambia cuánta plata sale del cajón. */}
              {Number(compra.retenciones_total ?? 0) > 0 && (
                <>
                  {Number(compra.retefuente_valor ?? 0) > 0 && (
                    <div className="ln">
                      <span>
                        Retefuente {Number(compra.retefuente_pct ?? 0)}%
                      </span>
                      <span className="v">
                        −{formatCOP(Number(compra.retefuente_valor))}
                      </span>
                    </div>
                  )}
                  {Number(compra.reteica_valor ?? 0) > 0 && (
                    <div className="ln">
                      <span>ReteICA {Number(compra.reteica_pct ?? 0)}%</span>
                      <span className="v">
                        −{formatCOP(Number(compra.reteica_valor))}
                      </span>
                    </div>
                  )}
                  {Number(compra.reteiva_valor ?? 0) > 0 && (
                    <div className="ln">
                      <span>ReteIVA {Number(compra.reteiva_pct ?? 0)}%</span>
                      <span className="v">
                        −{formatCOP(Number(compra.reteiva_valor))}
                      </span>
                    </div>
                  )}
                  <div className="ln tot">
                    <span>Neto a pagar</span>
                    <span className="v">
                      {formatCOP(
                        Math.max(
                          0,
                          Number(compra.total ?? 0) -
                            Number(compra.retenciones_total ?? 0),
                        ),
                      )}
                    </span>
                  </div>
                </>
              )}
```

Se muestra cada retención solo si tiene valor, porque una compra rara vez lleva
las tres y tres ceros seguidos no informan nada.

- [ ] **Paso 3: Verificar**

```bash
npm run lint && npm run build && npm test
```

Esperado: los tres en verde.

- [ ] **Paso 4: Commit**

```bash
git add src/pages/ops/CompraDetalle.jsx
git commit -m "feat(retenciones): el detalle de la compra muestra el desglose

Quien va a pagarle al proveedor tiene que poder ver de donde salio el neto. Se
usan las clases del bloque de totales que ya existe, no el componente compartido:
esa pantalla tiene su propio CSS y meterle una tarjeta con tokens distintos se
veria fuera de lugar.

Cada retencion aparece solo si tiene valor. Una compra rara vez lleva las tres y
tres ceros seguidos no informan nada.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Recorrido completo contra producción

**Files:** ninguno (verificación)

Acá se cubre el punto 9 del spec (paridad entre `calcularRetenciones` y las
columnas generadas). No lleva prueba unitaria propia: la fórmula ya está probada
en `tests/integration/retenciones.test.js` y es la misma para venta y compra; lo
único que cambia es la base que se le pasa (`subtotal - descuento`), y eso solo
se puede comprobar contra la base de datos real, que es lo que hace el paso 1.

Ni el build ni las pruebas montan estas pantallas contra datos reales. Este es el
paso que de verdad dice si la funcionalidad sirve.

- [ ] **Paso 1: Compra de contado, el caso del criterio de aceptación**

Todo dentro de una transacción:

```sql
begin;
select fn_registrar_compra(
  p_sede_id := 'BOD-PRINCIPAL',
  p_proveedor := 'PRUEBA FASE 2 CONTADO',
  p_items := jsonb_build_array(jsonb_build_object(
     'producto_id', (select id from productos where nombre ilike '%INVENTARIO DE PRUEBA%' and activo limit 1),
     'cantidad', 10, 'costo_unitario', 100000, 'destino', 'venta')),
  p_iva_pct := 0,
  p_metodo_pago := 'Efectivo',
  p_retefuente_pct := 2.5
);
select total, retenciones_total, total - retenciones_total as neto
  from compras where proveedor = 'PRUEBA FASE 2 CONTADO';
select fn_preview_cierre(current_date, current_date, 'BOD-PRINCIPAL');
rollback;
```

Esperado: `total = 1000000`, `retenciones_total = 25000`, y en el cierre el
egreso de la compra entra como **975.000**, el arqueo esperado baja 975.000 (no
un millón), y la línea del detalle de egresos muestra 975.000. Los tres números
tienen que coincidir entre sí. Si no coinciden, volver al Task 4 y revisar cuál
de los seis sitios quedó sin cambiar.

- [ ] **Paso 2: Compra a crédito, el caso del doble descuento**

```sql
begin;
select fn_registrar_compra(
  p_sede_id := 'BOD-PRINCIPAL',
  p_proveedor := 'PRUEBA FASE 2 CREDITO',
  p_items := jsonb_build_array(jsonb_build_object(
     'producto_id', (select id from productos where nombre ilike '%INVENTARIO DE PRUEBA%' and activo limit 1),
     'cantidad', 10, 'costo_unitario', 100000, 'destino', 'venta')),
  p_iva_pct := 0,
  p_metodo_pago := 'Crédito',
  p_retefuente_pct := 2.5
);
select total, retenciones_total, pagos, saldo
  from v_cuentas_por_pagar where proveedor = 'PRUEBA FASE 2 CREDITO';
select fn_preview_cierre(current_date, current_date, 'BOD-PRINCIPAL');
rollback;
```

Esperado: `saldo = 975000` (no un millón), y el cierre **no** registra ningún
egreso por esta compra: una compra a crédito no saca plata del cajón el día que
se registra.

- [ ] **Paso 3: El pago del crédito no descuenta dos veces**

```sql
begin;
-- (repetir el fn_registrar_compra a crédito del paso 2 aquí)
select fn_registrar_pago_cuenta(jsonb_build_object(
  'tipo', 'pago',
  'compra_id', (select id from compras where proveedor = 'PRUEBA FASE 2 CREDITO'),
  'monto', 975000,
  'metodo_pago', 'Efectivo'));
select saldo from v_cuentas_por_pagar where proveedor = 'PRUEBA FASE 2 CREDITO';
select fn_preview_cierre(current_date, current_date, 'BOD-PRINCIPAL');
rollback;
```

Esperado: el RPC acepta los 975.000 sin quejarse, el saldo queda en 0, y el
cierre registra un egreso de **975.000** — no de 950.625, que sería la retención
aplicada dos veces. Este paso es el que atrapa el bug más caro de todo el plan.

Probar además que rechaza pagar de más:

```sql
begin;
-- (repetir el fn_registrar_compra a crédito)
select fn_registrar_pago_cuenta(jsonb_build_object(
  'tipo', 'pago',
  'compra_id', (select id from compras where proveedor = 'PRUEBA FASE 2 CREDITO'),
  'monto', 1000000, 'metodo_pago', 'Efectivo'));
rollback;
```

Esperado: excepción "El monto (1000000) supera el saldo pendiente (975000)". Ese
mensaje ahora sí concuerda con lo que muestra la pantalla.

- [ ] **Paso 4: El panel de resultado no se movió**

```sql
select fn_panel_resultado(date_trunc('month', current_date)::date, current_date, null);
```

Comparar contra el mismo resultado de antes de empezar el plan. Debe ser
idéntico. Una retención no abarata la mercancía: el gasto sigue siendo el total,
lo que cambia es a quién se le paga.

- [ ] **Paso 5: Recorrido a mano por rol**

Con el servidor de desarrollo (`npm run dev`, puerto 5174 en este worktree),
entrar como **Bodega** y como una **vendedora**, y en cada uno:

1. Nueva Compra: el bloque aparece plegado, dice "¿Le retenemos al proveedor?" y
   los tres campos están en 0.
2. Abrirlo no cambia ningún número: el resumen sigue mostrando solo "Total
   estimado", sin línea de retención.
3. Pulsar "Aplicar las tarifas de siempre" sí aplica, y aparecen "Retenciones" y
   "Neto a pagar" en el resumen.
4. En caja menor el bloque **no** aparece.
5. Registrar la compra y abrir su detalle: el desglose está y el neto coincide
   con el del resumen.
6. En ancho de celular (390px) el bloque no desborda y los campos son tocables.

Anotar cualquier diferencia. Un botón de menos de 48px o un desborde horizontal
cuentan como defecto.

- [ ] **Paso 6: Advisors de seguridad**

Correr `get_advisors` con `type: "security"` y confirmar que la vista recreada no
introdujo ningún hallazgo nuevo (en particular, nada sobre `SECURITY DEFINER` en
`v_cuentas_por_pagar`). Comparar contra el resultado de antes del plan.

- [ ] **Paso 7: Suite completa y cierre**

```bash
npm run lint && npm run build && npm test
```

Esperado: todo en verde. Reportar el número final de pruebas y archivos.

**No desplegar.** El dueño pidió explícitamente terminar todo antes de subir
nada. El merge a `main` y el push a `cdv-cali` son una decisión suya.

---

## Resumen del alcance

| Toca | No toca |
| --- | --- |
| `compras`: 4 columnas generadas | `ventas`, `ordenes_servicio` |
| `fn_registrar_compra` (3 params nuevos, default 0) | `fn_registrar_venta`, `fn_convertir_cotizacion` |
| `v_cuentas_por_pagar.saldo` | `v_cuentas_por_cobrar` |
| `_fn_cierre_totales`: 6 sitios de `compras.total` | Los caminos de `pagos_cuenta` en esos mismos 6 |
| `BloqueRetenciones` (prop `modo`) | `fn_panel_resultado`, `fn_dashboard_admin`, `fn_dashboard_kpis` |
| `CompraNueva`, `CompraDetalle`, comentario de `Cuentas.jsx` | `fn_registrar_pago_cuenta` (ya estaba lista) |

---

## Cómo quedó (ejecutado el 2026-09-07)

Tres cosas salieron distintas del plan. Las tres las descubrió la verificación,
no el build.

**El Task 3 se fundió en el Task 1.** `v_cuentas_por_pagar` depende de
`retenciones_total`, así que bajar la columna exigía bajar la vista. Recrearla
dos veces en producción no aportaba nada, de modo que la migración
`20260907T1` hace las dos cosas y `20260907T3` no existe.

**Recrear una vista no conserva ni sus reloptions ni sus grants.** Al reponerla
pasaron dos cosas a la vez: el default ACL del esquema le regaló permisos a
`anon`, que no tenía ninguno, y el `create view` sin opciones se comió el
`security_invoker = true` que la vista traía desde `20260613000001`. Juntas
habrían dejado la deuda con proveedores visible para cualquier usuario
autenticado de cualquier sede, y para la anon key. El advisor de seguridad lo
marcó como ERROR. Corregido en `20260907T5`, con `20260907T1` ya arreglado para
que una reproducción desde cero no repita el error. Verificado después con
`set local role authenticated`: Bodega ve su compra, Sofía (L3) no ve nada.

**Agregar parámetros a una función crea una sobrecarga, no la reemplaza.**
`create or replace` habría dejado viva la firma de diez argumentos, y una
llamada por nombre desde PostgREST habría podido fallar con "function is not
unique" en tiempo de ejecución. Se baja primero, y al bajarla se pierden los
GRANTs, que el default del esquema le regala a PUBLIC y a `anon` — un agujero,
tratándose de una función `SECURITY DEFINER`. Repuesto el ACL exacto y
verificado que quede una sola firma.

**Resultado de las verificaciones.** Sin retenciones el cierre da idéntico al
peso (hoy 1.369.699 de egresos y 4.236.678 de margen; el mes 28.223.485,81 y
11.760.327,19). Con una compra de un millón al 2,5%, los seis sitios se mueven
en 975.000 y el arqueo baja 975.000, no un millón. Un crédito retenido nace con
saldo 975.000, no mueve el cierre al registrarse, acepta el pago de 975.000
dejando saldo 0, y el cierre registra 975.000 — no 950.625, que sería la
retención aplicada dos veces. Pagar 1.000.000 se rechaza con el mensaje correcto.
El panel de resultado no se movió. Advisor de seguridad: de 1 ERROR a ninguno.
lint sin problemas nuevos, build en verde, 277 pruebas pasando.

**Queda pendiente el paso 5 del Task 8**, el recorrido a mano por rol en el
navegador. Eso lo hace el dueño: exige iniciar sesión.

---

## Revisión profunda (2026-09-07, después de terminar)

Recorrido adversarial buscando vacíos y daños colaterales. Lo que se comprobó,
todo contra producción dentro de `BEGIN … ROLLBACK`:

**Un hueco encontrado y cerrado.** Cada porcentaje estaba recortado a [0,100],
pero la suma no. Retefuente 100% más reteICA 100% sobre una factura de 1.190.000
daba una retención de 2.000.000, y el cierre registraba un egreso de −810.000:
la compra aparecía como un ingreso. Cerrado en `20260907T6` con aviso en
pantalla, y probado en los tres puntos (rechaza el absurdo, deja pasar
2,5/0,414/15 y también el borde exacto de retención igual al total).

**Lo que se verificó sano y no hizo falta tocar.** El picking que ajusta la
factura: con 6 de 10 llegadas la retención bajó sola de 25.000 a 15.000 y el
cierre reflejó 585.000 — funciona *porque* las columnas son generadas; calculadas
en la RPC habrían quedado en 25.000 sobre una factura de 600.000. Cancelar una
compra retenida la saca de Cuentas por Pagar y devuelve el cierre a su línea
base. Caja menor sigue registrando con retención en cero y por su propio camino.
Ninguna función ni trigger escribe las columnas generadas, y ninguna pantalla
escribe en `compras` por REST: todas leen. `PagoCuentaModal` ya venía preparado
de la fase 1 y calcula el neto correcto. `CompraNueva` navega fuera al guardar,
así que la retención no se filtra a la compra siguiente. `pgrst_ddl_watch`
recarga la caché de PostgREST sola, y además se mandó el `NOTIFY` a mano.

**Un hallazgo que NO se tocó, a propósito.** `ventas` tiene exactamente el mismo
hueco de la retención que se pasa del total, desde la fase 1, y esa parte ya
está desplegada y en uso. Cerrarlo exige tocar `fn_registrar_venta`,
`fn_convertir_cotizacion` y el camino de la OT: es su propio cambio, con su
propia verificación. El aviso en pantalla sí lo hereda, porque el bloque es
compartido.
