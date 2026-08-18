# Las dos campanas del header: rediseño

**Fecha:** 2026-08-18
**Estado:** diseño aprobado, pendiente de plan de implementación

## El problema

El header tiene dos botones con el mismo isotipo de campana, uno al lado del otro
(`AdminShell.jsx:151` y `AdminShell.jsx:154`). A 16px `Bell` y `BellDot` son el
mismo dibujo, así que nadie distingue cuál es cuál. Ese es el síntoma visible.
Debajo hay dos problemas de fondo, uno por campana.

### Campana A (alertas de stock) cuenta ruido

Cuenta filas de `inventario` con `estado_stock IN ('Bajo','Agotado')`. Medido en
producción el 2026-08-18:

| Medida                                              | Filas |
| --------------------------------------------------- | ----- |
| Lo que muestra el badge                             | 2.868 |
| De esas, con `cantidad = 0`                         | 2.853 |
| De esas, sin `stock_minimo` configurado             | 2.792 |
| Realmente en `Bajo` (bajo un mínimo de verdad)      | 15    |
| Agotadas que esa sede sí vende (movimiento 90 días) | 219   |
| Lo que ya calcula `v_sugerencias_reorden`           | 76    |

`inventario` tiene una fila por (producto × sede): cuatro sedes por unos 1.400
productos son unas 5.500 filas. La mayoría de los ceros son legítimos, porque CV
nunca ha tenido lo que tiene BODEGA, y eso es el catálogo, no una alerta. El badge
grita 2.868 cuando lo accionable son 76. Es 92% ruido, y por eso nadie lo mira.

La inteligencia buena ya existe: `v_sugerencias_reorden` da los 76 correctos. La
campana simplemente no la usa.

### Campana B (notificaciones) tiene seis defectos

Se monta solo en `AdminShell`, en el header de escritorio. De ahí sale todo:

1. **236 notificaciones que nadie puede ver.** El trigger de traspasos manda
   `traspaso_en_camino` a `para_rol` `Vendedor` (221) o `Bodeguero` (15). La RLS
   les da permiso de leerlas, pero esos roles viven en `AppShell`, donde la campana
   no existe. Están al 100% sin leer desde el 17 de julio.
2. **El badge miente por debajo.** La query trae 30 filas y cuenta los no leídos de
   esas 30. El real para Admin es 763.
3. **"Marcar todas leídas" solo marca 30.** Arma una lista de ids de lo cargado, así
   que el badge nunca baja aunque se le dé veinte veces.
4. **No se refresca sola.** Carga una vez al montar, sin realtime ni polling.
5. **El clic solo marca leída.** Cada aviso trae el `data` jsonb con lo necesario
   para navegar (`traspaso_id`, `ensamble_id`, `producto_id` mas `sede_id`) y no se usa.
6. **El ruido la mató.** 840 de 886 avisos (95%) son `conversion_insumo`, que dispara
   en cada conversión venta a insumo, y por diseño el 88% de las descargas de OT
   exigen esa conversión a mano. La campana está permanentemente roja repitiendo lo
   mismo.

## Restricciones descubiertas

Verificadas contra producción, condicionan la implementación:

- **`notificaciones` no está en la publicación `supabase_realtime`.** Sin migración
  que la agregue, cualquier suscripción de realtime no haría nada, en silencio.
- **`inv_select` es `USING (true)`.** La RLS de `inventario` no filtra por sede, así
  que el conteo por sede se filtra explícito en la query, como ya hace
  `useAlertasCount` en `AppShell.jsx:761`.
- **`v_sugerencias_reorden` es `security_invoker=true`**, pero por lo anterior eso no
  la limita a la sede del usuario. Mismo tratamiento: filtro explícito.
- **`notificaciones` no tiene policy de INSERT a propósito.** Solo escriben funciones
  `SECURITY DEFINER`. Cualquier upsert va dentro de una de ellas.
- **`/admin/auditoria` ya filtra por `tipo = conversion_a_insumo`** mas sede, usuario
  y rango de fechas, pero no lee query params. Es el destino natural del detalle de
  las conversiones agrupadas, y hay que enseñarle a leer la URL.
- Rutas que ya existen para deep-link: `/ops/traspasos/:id`,
  `/ops/ensambles/:ensambleId`, `/ops/inventario/:productoId`.

## Decisión de isotipos

La clave no es cambiar una campana por otra campana. Es que **una de las dos deje de
ser campana**, porque dos campanas siempre se van a confundir por mucho que difieran
en el detalle.

|           | Isotipo             | Color del badge      | Qué es                                 |
| --------- | ------------------- | -------------------- | -------------------------------------- |
| Campana A | `PackageX` (lucide) | `--warn-500` naranja | Inventario. No es un aviso.            |
| Campana B | `Bell` (lucide)     | `--dang-500` rojo    | Avisos de gente. La campana de verdad. |

Formas de familias distintas y colores distintos, así que no se confunden ni de
reojo. La B pasa de `BellDot` a `Bell` porque ya no necesita diferenciarse con un
punto y el trazo queda más limpio.

---

## Parte 1: Campana A pasa a ser "Reposición"

Deja de contar estados de inventario y pasa a contar trabajo pendiente: qué hay que
comprar. Nada se elimina, `/admin/alertas` sigue igual con sus siete pestañas, que
tienen valor propio. Lo que cambia es qué cuenta el botón del header y a dónde lleva.

### Componente

Nuevo `src/components/layout/ReposicionButton.jsx`, sin la palabra "bell" en el
nombre porque ya no lo es. Vive en `layout/` y no en `admin/` porque lo usan los dos
shells. Responsabilidad única: mostrar el conteo de reposición y abrir un panel con
lo que hay que pedir. Depende de `v_sugerencias_reorden`, de la vista nueva
`v_faltantes_con_demanda` y de `authStore` para la sede y el rol.

### Badge

Cuenta `v_sugerencias_reorden` con `count:'exact', head:true`, filtrada por
`sede_id = perfil.sede_id` cuando el rol no es Admin. Tope visual en `99+`. Cuenta
solo la primera pestaña, para que el número siga siendo un número que se puede bajar
a cero.

El reparto por sede hoy es L3 21, CHV 20, CV 18 y BODEGA 17, con 76 en total. Importa
porque confirma que el badge sirve para los cinco usuarios y no solo para el Admin: a
cada vendedora le queda una cifra de unas veinte líneas, atendible en una mañana, en
vez de un cero permanente que volvería el botón inútil para cuatro de los cinco.

Si la query falla se conserva el último conteo conocido en vez de caer a 0, igual que
hoy: un 0 falso se lee como "todo en orden" y eso sería mentir.

### Panel, dos pestañas

**Reponer**, desde `v_sugerencias_reorden`. Ordenada por `clasificacion` (A antes de
B antes de C) y luego `cantidad_sugerida` descendente. Muestra los primeros 8 con
referencia, nombre, sede y cantidad sugerida.

**Se vende y no hay**, desde la vista nueva. Cubre el punto ciego de la primera:
2.792 SKUs no tienen `stock_minimo`, así que `v_sugerencias_reorden` es ciega a ellos.
Esta pestaña mide plata que se está dejando de vender en vez de cumplimiento de un
parámetro. Hoy daría 219.

Pie del panel con "Ver todo": Admin va a `/admin/reorden` desde la primera pestaña y
a `/admin/alertas` desde la segunda. Los demás roles van a
`/ops/inventario?estado=Agotado`, lo que exige que `Inventario.jsx` acepte ese param
además del `?q=` que ya lee.

El panel resuelve de paso el defecto de que hoy el botón lleva al inventario completo
de 2.900 SKUs sin aplicar ningún filtro: el badge decía 2.868 y la página no mostraba
esos 2.868.

### Vista nueva

`v_faltantes_con_demanda`, con `security_invoker = true` para seguir el patrón de
`v_sugerencias_reorden`. Filas de `inventario` con `cantidad = 0` de productos
activos que esa misma sede vendió en los últimos 90 días. Columnas: `producto_id`,
`referencia`, `nombre`, `clasificacion`, `sede_id`, `sede_nombre`, `ventas_90d`,
`unidades_90d`, `ultima_venta`.

### Badge en el header de escritorio de admin

`HeaderAdmin` (`AdminShell.jsx:129`) recibe `perfil`, `initials` y `onLogout`, sin
`alertCount`. El conteo se calcula en la línea 515 y se pasa a móvil y al bottom nav,
pero no al escritorio, así que en PC el botón es un adorno que no dice nada hasta que
le dan clic. Se corrige pasándole el conteo.

### Costo del realtime

La suscripción actual es `postgres_changes` sobre toda la tabla `inventario`: cada
venta, traspaso o entrada re-dispara un count sobre unas 2.900 filas en cada
dispositivo conectado. Una venta de 20 líneas son 20 recuentos. Se agrega un debounce
de cola de 3 segundos, así una venta produce un recuento y no veinte.

---

## Parte 2: Campana B, mismo propósito, seis correcciones

### B1. Montarla donde están sus destinatarios

`src/components/admin/NotificacionesBell.jsx` se mueve a
`src/components/layout/NotificacionesBell.jsx`, porque ya no es solo de admin. Se
monta en el header de escritorio de `AppShell`, en `MobileHeader` de `AppShell` y en
`MobileHeaderAdmin` de `AdminShell`, además de donde ya está. Con eso las 236
notificaciones de traspaso dejan de morir en la base.

### B2. Badge contado en servidor

Query aparte con `count:'exact', head:true` y `.eq('leida', false)`, separada de la
que trae las 30 filas del panel. Tope visual `99+`.

### B3. Marcar todas leídas de verdad

`update({ leida: true }).eq('leida', false)` sin lista de ids. La RLS ya limita el
alcance a `para_rol = get_my_rol()` o `created_by = auth.uid()`, así que no puede
tocar filas de otros.

### B4. Realtime

Migración que agrega `notificaciones` a la publicación `supabase_realtime`, y
suscripción a `INSERT` y `UPDATE` filtrada por la tabla. Hace falta escuchar `UPDATE`
además de `INSERT` por lo que viene en B6.

### B5. Clic que navega

Usando el `data` jsonb que ya viene lleno:

| tipo                 | destino                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| `traspaso_en_camino` | `/ops/traspasos/{traspaso_id}`                                                         |
| `ensamble_creado`    | `/ops/ensambles/{ensamble_id}`                                                         |
| `conversion_insumo`  | `/admin/auditoria?tipo=conversion_a_insumo&sede={sede_id}&desde={fecha}&hasta={fecha}` |
| `costo_revisar`      | `/ops/inventario/{producto_id}`                                                        |

Marcar leída y navegar en el mismo clic. Si el `data` no trae la clave esperada, el
aviso solo se marca leída sin navegar, en vez de romper la ruta.

`Auditoria.jsx` aprende a leer `tipo`, `sede`, `desde` y `hasta` de la URL para
inicializar sus filtros. Es la única página que lo necesita.

### B6. Conversiones agrupadas por día y sede, con actualización en vivo

Un solo aviso por día y por sede, que se actualiza cada vez que entra una conversión
nueva en vez de crear otra fila.

Cambios de esquema en `notificaciones`:

- `dedupe_key text`, con índice único parcial `where dedupe_key is not null`. Los
  avisos que no se agrupan siguen con `dedupe_key` nulo y no chocan entre sí.
- `updated_at timestamptz not null default now()`, backfill a `created_at`. Sin esto
  el aviso agrupado se hundiría en la lista, porque el orden es por `created_at` y esa
  fecha no cambia al actualizar. El panel pasa a ordenar por `updated_at desc`.

`fn_convertir_a_insumo` cambia su `INSERT` por un
`INSERT ... ON CONFLICT (dedupe_key) DO UPDATE`, con
`dedupe_key = 'conversion_insumo:' || p_sede_id || ':' || (now() at time zone 'America/Bogota')::date`.
La fecha se calcula en hora Colombia, no en UTC, para que el corte del día coincida
con el día laboral. En el conflicto incrementa los contadores en `data`
(`eventos`, `unidades`), reconstruye el `mensaje`, pone `updated_at = now()` y
`leida = false`.

El reset de `leida` es deliberado: si entran conversiones nuevas después de que el
Admin revisó, el badge vuelve, que es lo pedido. Con el `UPDATE` de B4 escuchado, el
aviso sube solo a la cabeza de la lista con el número nuevo sin recargar.

El detalle no se guarda en `data`. El contador basta para el mensaje y el detalle
completo se consulta en `/admin/auditoria` filtrada por ese día y sede, que siempre
está exacta y no crece dentro del jsonb.

### B7. Endurecer la policy de UPDATE

`notif_update` valida `para_rol` y `created_by` en su `WITH CHECK`, pero Postgres no
tiene RLS por columna, así que hoy un usuario autenticado podría modificar `data` o
el `dedupe_key` nuevo por REST. Como ya estamos tocando la tabla, se corrige con
grants por columna: `REVOKE UPDATE ON notificaciones FROM authenticated` seguido de
`GRANT UPDATE (leida) ON notificaciones TO authenticated`.

---

## Flujo de datos

```
inventario --(realtime, debounce 3s)--> ReposicionButton
                                          |  badge = count(v_sugerencias_reorden)
                                          +- panel -+- v_sugerencias_reorden
                                                    +- v_faltantes_con_demanda

fn_convertir_a_insumo -+
trg_ensamble           +-> notificaciones --(realtime INSERT+UPDATE)--> NotificacionesBell
trg_traspaso_salida   -+    (upsert por dedupe_key)                      | badge = count(leida=false)
                                                                         +- clic -> ruta según data
```

## Manejo de errores

Cada conteo conserva su último valor conocido si la query falla, en vez de mostrar 0.
Un 0 falso se lee como "todo en orden", y ese es el peor error posible en un badge.
Los paneles muestran el estado vacío solo cuando la query volvió bien y sin filas.
Si un deep-link no encuentra su destino, la notificación se marca leída y no navega,
sin dejar la app en una ruta muerta. Esto es coherente con la regla del proyecto de
que todo bloqueo diga causa y salida, y de no ofrecer un botón que va a fallar igual.

## Migración de datos

Las 840 `conversion_insumo` históricas se marcan `leida = true`. Son ruido que nadie
va a revisar retroactivamente y siguen consultables en `movimientos` y en
`/admin/auditoria`. Sin esto el badge arranca en 763 y el rediseño no se siente.
**Esto necesita el OK explícito del dueño antes de aplicarse.**

Las 236 de traspaso se dejan sin leer a propósito: son las que nunca se pudieron ver
y ahora sí tienen dónde mostrarse.

## Verificación

En base de datos, contra producción: `v_faltantes_con_demanda` devuelve 219 filas;
`v_sugerencias_reorden` sigue en 76; el upsert de conversión produce una sola fila por
día y sede, y una segunda conversión en el mismo día incrementa contadores en vez de
insertar; `notificaciones` aparece en `pg_publication_tables` para
`supabase_realtime`; `authenticated` solo tiene `UPDATE(leida)`.

En la app, siguiendo la restricción de que las pruebas van contra producción con los
productos `INVENTARIO DE PRUEBA (999)`: el badge de reposición coincide con el conteo
real por sede para Admin y para una vendedora; el badge de notificaciones muestra el
total real y no 30; marcar todas leídas lo deja en 0; una vendedora ve sus avisos de
traspaso y el clic la lleva al traspaso; una conversión nueva actualiza el aviso
agrupado en vivo sin recargar; los dos botones del header se distinguen a simple
vista. El E2E con login lo corre el dueño.

## Fuera de alcance

No se toca `/admin/alertas` ni `/admin/reorden` por dentro. No se cambian permisos ni
roles. No se toca auth ni el candado append-only de `movimientos`. No se reconfiguran
los 2.792 `stock_minimo` faltantes: la segunda pestaña existe precisamente para no
depender de ese trabajo.
