# Herramientas visibles en todas las sedes — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cualquiera pueda ver dónde está cada herramienta de la empresa, sin poder tocar las de otras sedes.

**Architecture:** Una migración que abre el `SELECT` de las dos tablas de herramientas, más trabajo de pantalla. Ninguna función que mueva inventario se toca: quién presta y quién devuelve se queda exactamente como hoy. Lo delicado no es la RLS sino el frontend — al ver herramientas de otras sedes, los botones dejan de ser válidos para todas las filas, así que el permiso pasa a decidirse por fila y no por rol global.

**Tech Stack:** React 19, Supabase (PostgreSQL + RLS), Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-20-ajustes-permisos-cotizaciones-design.md` (grupo C2)

---

## Antes de empezar

**Rama:** `feat/herramientas-ver-todas-sedes`, ya creada desde `main`.

**Verificación:** `npx eslint`, `npm run build`, consultas SQL con cifras esperadas, y
prueba manual por rol. El PIN de Admin lo tiene el dueño; las pruebas de sesión las
corre él.

### Los permisos del servidor, que NO cambian

Esto es lo que decide qué botón puede aparecer. Verificado contra producción:

| Función                                                                                               | Quién puede                                         |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `fn_prestar_herramientas_lote`                                                                        | Admin en cualquier sede; el resto solo en la suya   |
| `fn_devolver_herramienta` (y su versión por lote, que delega)                                         | Admin o Bodeguero, y solo en su sede si no es Admin |
| `fn_consumir_herramienta`                                                                             | Solo Admin                                          |
| `fn_enviar_herramienta_mantenimiento`, `fn_marcar_herramienta_extraviada`, `fn_recuperar_herramienta` | Admin o Bodeguero, su sede                          |

**Ninguna se toca.** Se revirtió a propósito la idea de centralizar el préstamo en el
Admin: le quitaba a los bodegueros algo que usan a diario.

## Estructura de archivos

| Archivo                                                                  | Responsabilidad                                                            |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `supabase/migrations/20260820000001_herramientas_select_todas_sedes.sql` | Crear: abrir el `SELECT` de las dos tablas                                 |
| `src/pages/ops/Herramientas.jsx`                                         | Modificar: quitar el filtro, mostrar la sede, decidir los botones por fila |

---

## Task 1: Abrir la lectura en la base

**Files:**

- Create: `supabase/migrations/20260820000001_herramientas_select_todas_sedes.sql`

- [ ] **Step 1: Medir el estado previo**

```sql
select tablename, policyname, qual::text
from pg_policies
where tablename in ('herramientas_prestamo','herramientas_historial') and cmd='SELECT';
```

Esperado ANTES: las dos políticas dicen
`(get_my_rol() = 'Admin') OR (sede_id = get_my_sede_id())`.

- [ ] **Step 2: Escribir la migración**

```sql
-- Herramientas visibles en todas las sedes (solo lectura).
--
-- Las herramientas viajan entre sedes y hoy nadie puede saber dónde quedó una
-- sin llamar por teléfono: la RLS solo dejaba ver las de la sede propia.
-- Se abre el SELECT a cualquier usuario autenticado.
--
-- Qué NO cambia: las políticas de escritura y las funciones de préstamo,
-- devolución, consumo y mantenimiento siguen exigiendo sede propia salvo al
-- Admin. Ver es distinto de tocar.
--
-- Qué se expone: nombre, código, estado, quién la tiene y desde cuándo. No hay
-- dinero, costos ni datos de clientes en estas tablas.

DROP POLICY IF EXISTS hp_select ON public.herramientas_prestamo;
CREATE POLICY hp_select ON public.herramientas_prestamo
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS hh_select ON public.herramientas_historial;
CREATE POLICY hh_select ON public.herramientas_historial
  FOR SELECT TO authenticated
  USING (true);
```

- [ ] **Step 3: Aplicar**

Aplicar con el MCP de Supabase (`apply_migration`) sobre el proyecto
`kbgwygnmhjeyiyyxosmb`, nombre `herramientas_select_todas_sedes`.

- [ ] **Step 4: Verificar que solo cambió la lectura**

```sql
select tablename, cmd, policyname, qual::text
from pg_policies
where tablename in ('herramientas_prestamo','herramientas_historial')
order by tablename, cmd;
```

Esperado: las dos filas de `SELECT` dicen `true`. **Las de INSERT, UPDATE y DELETE
deben seguir exactamente igual que antes** — si alguna cambió, se tocó de más.

- [ ] **Step 5: Confirmar que hay algo que ver**

```sql
select sede_id, count(*) total, count(*) filter (where estado = 'prestada') prestadas
from herramientas_prestamo group by 1 order by 2 desc;
```

Guardar el resultado: son las cifras que la pantalla debe mostrar cuando entre un
usuario que no sea Admin.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260820000001_herramientas_select_todas_sedes.sql
git commit -m "feat(herramientas): lectura de todas las sedes"
```

---

## Task 2: Quitar el filtro y mostrar la sede

**Files:**

- Modify: `src/pages/ops/Herramientas.jsx:112-113`

- [ ] **Step 1: Quitar el filtro de la consulta principal**

Borrar estas dos líneas (112-113):

```jsx
if (perfil?.rol !== "Admin" && perfil?.sede_id)
  query = query.eq("sede_id", perfil.sede_id);
```

Y dejar en su lugar un comentario que explique por qué ya no está, para que nadie lo
reponga por costumbre:

```jsx
// Sin filtro por sede a propósito: las herramientas viajan y todos deben
// poder ver dónde quedó cada una. Lo que sigue acotado por sede son las
// ACCIONES, que se deciden fila por fila más abajo.
```

- [ ] **Step 2: NO tocar el filtro de la lista de usuarios**

Las líneas 142-143 filtran por sede la lista de personas a quienes prestar:

```jsx
if (perfil?.rol !== "Admin" && perfil?.sede_id)
  q = q.eq("sede_id", perfil.sede_id);
```

**Se queda como está.** Una herramienta se presta a alguien de su sede, y ese filtro no
le estorba a nadie. Ampliarlo sería alcance que nadie pidió.

- [ ] **Step 3: Mostrar la sede en la fila de escritorio**

`sede_id` ya viene en `SELECT_COLS`, y `sedeLabel` ya está importado (línea 28).

En `LoanRow` (línea 855), dentro de la celda que muestra el nombre de la herramienta,
añadir la sede bajo el código. Localizar el `<td>` que pinta `h.herramienta_nombre` y
añadir debajo:

```jsx
<span
  className="ml-2 rounded px-1.5 py-0.5 font-mono text-[10.5px]"
  style={{
    backgroundColor: "var(--n-100)",
    color: "var(--n-600)",
  }}
>
  {sedeLabel(h.sede_id)}
</span>
```

Sin esto la pantalla empeora: cuatro sedes mezcladas sin distinguir cuál es cuál es
peor que ver solo la propia.

- [ ] **Step 4: Mostrar la sede en la tarjeta móvil**

Lo mismo en `LoanCard` (línea 1012), junto al código de la herramienta, con el mismo
marcado del paso anterior.

- [ ] **Step 5: Verificar**

Run: `npx eslint src/pages/ops/Herramientas.jsx && npm run build`
Expected: 0 problemas y build exitoso.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ops/Herramientas.jsx
git commit -m "feat(herramientas): ver todas las sedes con la sede visible en cada fila"
```

---

## Task 3: Decidir los botones por fila, no por rol

Esta es la tarea que importa. Sin ella, un bodeguero de BODEGA verá herramientas de CHV
con botones que al pulsarlos devuelven _"No tienes permiso sobre herramientas de esta
sede"_ — el mismo error que ya cometimos con las campanas y con el botón de la chatarra.

**Files:**

- Modify: `src/pages/ops/Herramientas.jsx`

- [ ] **Step 1: Añadir el cálculo en el componente padre**

Junto a `isAdmin` y `esBodega` (líneas 63-66):

```jsx
const miSede = perfil?.sede_id;
/** Las funciones del servidor solo dejan actuar sobre la sede propia, salvo
 *  al Admin. Ahora que se ven herramientas de las cuatro sedes, el permiso
 *  ya no depende solo del rol: depende de CADA herramienta. */
const puedeOperarEn = (sedeId) => isAdmin || sedeId === miSede;
```

- [ ] **Step 2: Pasarlo a las filas de préstamos activos**

`TabActivos` (línea 680) reparte a `LoanRow` y `LoanCard`. Donde hoy pasa
`esAdmin` y `esBodega` (líneas 802-803 y 843-844), añadir la capacidad por fila:

```jsx
                puedeOperar={puedeOperarEn(g.anchor.sede_id)}
```

`TabActivos` recibe la función por props desde el padre: añadir `puedeOperarEn` a su
lista de props (línea 680) y a la llamada del padre (líneas 571-572 y 594-595).

- [ ] **Step 3: Usarlo en `LoanRow`**

Cambiar la firma (línea 855):

```jsx
function LoanRow({ g, accionando, esAdmin, esBodega, puedeOperar, onOpen, onAccion }) {
```

Y la capacidad (línea 863), que hoy es:

```jsx
const puedeDevolver = (esAdmin || esBodega) && (!h.producto_id || esAdmin);
```

pasa a:

```jsx
// El rol dice QUÉ se puede hacer; la sede, DÓNDE. Las dos condiciones tienen
// que cumplirse o el servidor rechaza la acción.
const puedeDevolver =
  puedeOperar && (esAdmin || esBodega) && (!h.producto_id || esAdmin);
```

El bloque `{esAdmin && (` de la línea 982 (dar de baja) **no necesita cambio**: el
Admin puede operar en cualquier sede, así que `puedeOperar` siempre es cierto para él.

- [ ] **Step 4: Usarlo en `LoanCard`**

Exactamente lo mismo en la versión móvil: firma (línea 1012) y la capacidad de la
línea 1017, con el mismo código del paso anterior. El `{esAdmin && (` de la línea 1112
tampoco cambia.

- [ ] **Step 5: Usarlo en el detalle**

`HerramientaDetalle` (llamado en la línea 590 de `Herramientas.jsx`) recibe `esAdmin` y
`esBodega`. Añadirle la prop en esa llamada:

```jsx
          puedeOperar={puedeOperarEn(detalle.sede_id)}
```

En `src/components/herramientas/HerramientaDetalle.jsx` (export default de la línea
126), añadir `puedeOperar` a la lista de props junto a `esAdmin` y `esBodega`, y
acotar los **dos** puntos que dependen del rol:

Línea 160, hoy:

```jsx
  const puedeGestionar = (esAdmin || esBodega) && !estaRetirada;
```

pasa a:

```jsx
  // El rol dice QUÉ; la sede, DÓNDE. Sin las dos, el servidor rechaza.
  const puedeGestionar = puedeOperar && (esAdmin || esBodega) && !estaRetirada;
```

Líneas 250-251, hoy:

```jsx
            (esAdmin || esBodega) &&
            (!esInventariable || esAdmin) && (
```

pasa a:

```jsx
            puedeOperar &&
            (esAdmin || esBodega) &&
            (!esInventariable || esAdmin) && (
```

Los bloques de las líneas 268 y 355 son **solo de Admin** (`esConsumir` y la acción
sobre inventariables). No se tocan: el Admin opera en cualquier sede, así que
`puedeOperar` siempre es cierto para él y añadirlo sería ruido.

- [ ] **Step 6: Verificar que no queda ninguna acción sin acotar**

Run: `grep -n "esAdmin || esBodega" src/pages/ops/Herramientas.jsx src/components/herramientas/*.jsx`

Expected: **cada resultado debe estar acompañado de `puedeOperar`** en la misma
expresión. Si alguno aparece suelto, es un botón que va a fallar en otra sede.

- [ ] **Step 7: Verificar**

Run: `npx eslint src/pages/ops/Herramientas.jsx src/components/herramientas/ && npm run build`
Expected: 0 problemas y build exitoso.

- [ ] **Step 8: Commit**

```bash
git add src/pages/ops/Herramientas.jsx src/components/herramientas/
git commit -m "fix(herramientas): las acciones se deciden por sede, no solo por rol"
```

---

## Task 4: Verificación final

- [ ] **Step 1: Lint y build**

Run: `npx eslint src/pages/ops/Herramientas.jsx src/components/herramientas/ && npm run build`
Expected: 0 problemas y build exitoso.

- [ ] **Step 2: Comprobar la RLS una vez más**

```sql
select tablename, cmd, qual::text from pg_policies
where tablename in ('herramientas_prestamo','herramientas_historial')
order by tablename, cmd;
```

Esperado: `SELECT` en `true`; el resto de políticas intactas.

- [ ] **Step 3: Prueba manual, la que corre el dueño**

Con sesión de **una vendedora** (por ejemplo Bladimir, CHV):

1. Entrar a Herramientas. Ahora ve herramientas de **las cuatro sedes**, cada una con
   su sede escrita.
2. En una herramienta de **su** sede, los botones aparecen y funcionan igual que antes.
3. En una de **otra** sede, **no aparece ningún botón de acción**. Se ve el estado,
   quién la tiene y desde cuándo, y nada más. Este es el punto que hay que mirar con
   cuidado: si sale un botón y al pulsarlo da error de permisos, la tarea está mal.

Con sesión de **bodeguero**:

4. Igual: ve todo, opera solo sobre BODEGA.

Con sesión de **Admin**:

5. Ve todo y opera sobre todo, como antes.

- [ ] **Step 4: Commit final si hubo ajustes**

```bash
git add -A
git commit -m "chore(herramientas): ajustes de verificacion final"
```

---

## Alcance

No se toca ninguna función de herramientas. No se cambian permisos de escritura ni
roles. No se amplía el filtro de la lista de usuarios a quien prestar. Las otras cinco
funciones (crear desde insumo, mantenimiento, extraviada, recuperar, consumir) se
quedan como están.
