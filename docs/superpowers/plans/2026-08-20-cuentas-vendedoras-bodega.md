# Cuentas por cobrar y por pagar para vendedoras y bodega — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada vendedora vea y cobre la cartera de su sede, y que bodega vea y pague las compras a crédito que le llegan.

**Architecture:** Leer ya funciona sin tocar la base — las dos vistas son `security_invoker` y la RLS de `ventas` y `compras` ya acota por sede. Lo que hay que abrir es `fn_registrar_pago_cuenta`, hoy exclusiva del Admin, con una matriz de rol y tipo y una comprobación de sede tras cargar la venta o la compra. En pantalla, la página se mueve a Operaciones y las pestañas se derivan del rol.

**Tech Stack:** React 19, Supabase (PostgreSQL + RLS), Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-20-ajustes-permisos-cotizaciones-design.md` (grupo C1)

---

## Antes de empezar

**Rama:** `feat/cuentas-vendedoras-bodega`, ya creada desde `main`.

**Este es el grupo que mueve dinero.** Va de último a propósito. Cada paso lleva su
comprobación, y la prueba con una vendedora y con bodega es obligatoria antes de
mergear.

### Lo que ya funciona sin tocar nada, verificado

- `v_cuentas_por_cobrar` y `v_cuentas_por_pagar` son `security_invoker = true`.
- `ventas_select`: Admin ve todo; el resto, solo su sede.
- `compras_select`: Admin ve todo; el resto, solo `sede_destino_id` = su sede.

O sea que **leer no necesita ningún cambio de base**, y queda acotado solo.

### El patrón de error que ya nos mordió tres veces

Al abrir una pantalla a roles nuevos, los botones que antes siempre eran válidos dejan
de serlo. Pasó con las campanas, con el botón de la chatarra y con herramientas. Aquí
hay **uno ya identificado**: el botón de anular pago de `PagoCuentaModal` no está
acotado por rol —hoy no importa porque solo entra el Admin—, y `fn_eliminar_pago_cuenta`
lo rechaza con _"Solo el administrador puede anular pagos"_. Se arregla en la Task 4.

## Estructura de archivos

| Archivo                                                    | Responsabilidad                                  |
| ---------------------------------------------------------- | ------------------------------------------------ |
| `supabase/migrations/20260820000002_pago_cuenta_roles.sql` | Crear: quién puede registrar cobros y pagos      |
| `src/pages/ops/Cuentas.jsx`                                | Mover desde `admin/`: pestañas derivadas del rol |
| `src/pages/admin/Cuentas.jsx`                              | Borrar (la ruta de admin importa desde `ops/`)   |
| `src/components/cuentas/PagoCuentaModal.jsx`               | Modificar: anular solo para Admin                |
| `src/lib/constants.js`                                     | Modificar: módulo, icono y ruta de Cuentas       |
| `src/components/layout/AppShell.jsx`                       | Modificar: sección del módulo                    |
| `src/App.jsx`                                              | Modificar: ruta de ops e import                  |

---

## Task 1: Abrir el registro de cobros y pagos

**Files:**

- Create: `supabase/migrations/20260820000002_pago_cuenta_roles.sql`

- [ ] **Step 1: Guardar la definición vigente**

```sql
select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname='fn_registrar_pago_cuenta';
```

Guardarla entera en el reporte: es la red de seguridad para revertir.

- [ ] **Step 2: Escribir la migración**

Es la función completa con **dos cambios**: el portero de rol al principio, y una
comprobación de sede dentro de cada rama. Todo lo demás —validación de monto contra
saldo, método de pago, cuenta obligatoria en electrónicos, bloqueo de ventas anuladas
y compras canceladas— se copia literal.

```sql
-- Cuentas por cobrar y por pagar para vendedoras y bodega.
--
-- Antes: solo el Admin podía registrar cobros o pagos, así que abrir la
-- pantalla a otros roles habría mostrado una lista con un botón que revienta.
--
-- Ahora cada rol registra lo suyo y solo en su sede:
--   Vendedor  -> cobros de ventas de su sede
--   Bodeguero -> pagos de compras que llegan a su sede
--   Admin     -> todo, en cualquier sede
--
-- Anular un pago sigue siendo exclusivo del Admin (fn_eliminar_pago_cuenta):
-- registrar y anular no son simétricos, anular deshace un movimiento contable.
--
-- El control vive aquí y no en la pantalla: un vendedor que llame la RPC a mano
-- con tipo 'pago' es rechazado por la función.

CREATE OR REPLACE FUNCTION public.fn_registrar_pago_cuenta(p_payload jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_sede text;
  v_tipo text;
  v_venta record; v_compra record;
  v_monto numeric;
  v_metodo text;
  v_cuenta text;
  v_abonos_cotiz numeric := 0;
  v_pagos numeric := 0;
  v_saldo numeric;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  v_rol  := (select get_my_rol());
  v_sede := (select get_my_sede_id());
  v_tipo := p_payload->>'tipo';

  -- Matriz de rol y tipo. La sede se comprueba más abajo, cuando ya se sabe a
  -- qué sede pertenece la venta o la compra.
  if v_rol not in ('Admin','Vendedor','Bodeguero') then
    raise exception 'No tienes permiso para registrar cobros o pagos';
  end if;
  if v_tipo = 'cobro' and v_rol = 'Bodeguero' then
    raise exception 'Bodega registra pagos a proveedores, no cobros a clientes';
  end if;
  if v_tipo = 'pago' and v_rol = 'Vendedor' then
    raise exception 'Los pagos a proveedores los registra bodega o el administrador';
  end if;

  v_monto  := coalesce(nullif(p_payload->>'monto','')::numeric, 0);
  v_metodo := nullif(trim(p_payload->>'metodo_pago'),'');
  v_cuenta := nullif(trim(p_payload->>'cuenta_bancaria'),'');

  if v_monto <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;
  if v_metodo is null then raise exception 'Falta el método de pago'; end if;
  if v_metodo in ('Transferencia','Tarjeta') and v_cuenta is null then
    raise exception 'Indica la cuenta bancaria para pagos electrónicos';
  end if;

  if v_tipo = 'cobro' then
    select * into v_venta from ventas where id = (p_payload->>'venta_id')::uuid for update;
    if not found then raise exception 'Venta no encontrada'; end if;

    if v_rol <> 'Admin' and v_venta.sede_id is distinct from v_sede then
      raise exception 'Solo puedes registrar cobros de ventas de tu propia sede';
    end if;

    if coalesce(v_venta.anulada, false) then raise exception 'La venta está anulada'; end if;

    select coalesce(sum(a.monto),0) into v_abonos_cotiz
      from abonos_cotizacion a join cotizaciones c on c.id = a.cotizacion_id
      where c.venta_id = v_venta.id;

    if v_venta.metodo_pago is distinct from 'Crédito' and v_abonos_cotiz <= 0 then
      raise exception 'La venta no admite cobros (no es a crédito ni tiene abonos de cotización)';
    end if;

    select coalesce(sum(p.monto),0) into v_pagos
      from pagos_cuenta p
     where p.venta_id = v_venta.id and p.tipo = 'cobro' and coalesce(p.anulado,false) = false;
    v_saldo := coalesce(v_venta.total,0) - v_abonos_cotiz - v_pagos;
    if v_monto > v_saldo + 0.01 then
      raise exception 'El monto (%) supera el saldo pendiente (%)', v_monto, v_saldo;
    end if;
    insert into pagos_cuenta (tipo, venta_id, monto, metodo_pago, cuenta_bancaria, observaciones, registrado_por)
    values ('cobro', v_venta.id, v_monto, v_metodo, v_cuenta, nullif(trim(p_payload->>'observaciones'),''), v_uid);
    return v_saldo - v_monto;

  elsif v_tipo = 'pago' then
    select * into v_compra from compras where id = (p_payload->>'compra_id')::uuid for update;
    if not found then raise exception 'Compra no encontrada'; end if;

    if v_rol <> 'Admin' and v_compra.sede_destino_id is distinct from v_sede then
      raise exception 'Solo puedes registrar pagos de compras de tu propia sede';
    end if;

    if v_compra.estado = 'cancelada' then raise exception 'La compra está cancelada'; end if;
    if v_compra.metodo_pago is distinct from 'Crédito' then
      raise exception 'La compra no es a crédito';
    end if;
    select coalesce(sum(p.monto),0) into v_pagos
      from pagos_cuenta p
     where p.compra_id = v_compra.id and p.tipo = 'pago' and coalesce(p.anulado,false) = false;
    v_saldo := coalesce(v_compra.total,0) - v_pagos;
    if v_monto > v_saldo + 0.01 then
      raise exception 'El monto (%) supera el saldo pendiente (%)', v_monto, v_saldo;
    end if;
    insert into pagos_cuenta (tipo, compra_id, monto, metodo_pago, cuenta_bancaria, observaciones, registrado_por)
    values ('pago', v_compra.id, v_monto, v_metodo, v_cuenta, nullif(trim(p_payload->>'observaciones'),''), v_uid);
    return v_saldo - v_monto;
  else
    raise exception 'tipo inválido (cobro|pago)';
  end if;
end $function$;
```

- [ ] **Step 3: Aplicar**

Con `apply_migration` sobre `kbgwygnmhjeyiyyxosmb`, nombre `pago_cuenta_roles`.

- [ ] **Step 4: Verificar que las defensas siguen ahí**

```sql
with f as (select pg_get_functiondef(p.oid) def from pg_proc p
           join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='fn_registrar_pago_cuenta')
select
  def ilike '%supera el saldo pendiente%'            conserva_tope_de_saldo,
  def ilike '%Falta el método de pago%'              conserva_metodo,
  def ilike '%cuenta bancaria para pagos electr%'    conserva_cuenta,
  def ilike '%La venta está anulada%'                conserva_anulada,
  def ilike '%La compra está cancelada%'             conserva_cancelada,
  def ilike '%tu propia sede%'                       tiene_control_de_sede,
  def ilike '%Bodega registra pagos a proveedores%'  tiene_matriz_de_rol
from f;
```

Esperado: **las siete en `true`**. Si alguna de las cinco primeras da `false`, se
perdió una defensa al copiar y hay que revertir.

- [ ] **Step 5: Confirmar que anular sigue cerrado**

```sql
select pg_get_functiondef(p.oid) ilike '%Solo el administrador puede anular pagos%' sigue_admin_only
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='fn_eliminar_pago_cuenta';
```

Esperado: `true`. Esa función **no se toca**.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260820000002_pago_cuenta_roles.sql
git commit -m "feat(cuentas): cada rol registra lo suyo y solo en su sede"
```

---

## Task 2: Mover la página a Operaciones con pestañas por rol

**Files:**

- Create: `src/pages/ops/Cuentas.jsx` (movido)
- Delete: `src/pages/admin/Cuentas.jsx`

- [ ] **Step 1: Mover el archivo**

```bash
git mv src/pages/admin/Cuentas.jsx src/pages/ops/Cuentas.jsx
```

El componente **no importa nada exclusivo del panel admin** —solo `cuentas-ui`,
`useFiltros` y `BarraFiltros`, todos compartidos—, así que se renderiza igual en los
dos shells. Las rutas relativas `../../lib/...` y `../../components/...` siguen siendo
válidas porque `pages/ops/` está a la misma profundidad que `pages/admin/`.

- [ ] **Step 2: Derivar las pestañas del rol**

El componente ya tiene `const [tab, setTab] = useState("cobrar")` y pinta las dos
pestañas desde un array literal.

Añadir arriba, junto a los demás hooks:

```jsx
const perfil = useAuthStore((s) => s.perfil);
const esAdmin = perfil?.rol === "Admin";
const esVendedor = perfil?.rol === "Vendedor";
/** Qué pestañas puede ver cada rol. No es cosmético: el servidor rechaza a un
 *  vendedor que intente registrar un pago a proveedor, así que enseñarle la
 *  pestaña sería ofrecerle algo que no puede hacer. */
const tabsPermitidos = esAdmin
  ? ["cobrar", "pagar"]
  : esVendedor
    ? ["cobrar"]
    : ["pagar"];
```

Añadir el import de `useAuthStore` si no está:

```jsx
import { useAuthStore } from "../../stores/authStore";
```

- [ ] **Step 3: Que el estado inicial respete el rol**

`useState("cobrar")` dejaría a un bodeguero en una pestaña que no le corresponde.
Cambiarlo por:

```jsx
const [tab, setTab] = useState(tabsPermitidos[0]);
```

`tabsPermitidos` se calcula antes, así que está disponible.

- [ ] **Step 4: Filtrar la barra de pestañas**

Localizar el array literal que define las pestañas (contiene
`{ id: "cobrar", label: "Por cobrar", icon: HandCoins }`) y filtrarlo:

```jsx
        {[
          { id: "cobrar", label: "Por cobrar", icon: HandCoins },
          { id: "pagar", label: "Por pagar", icon: Receipt },
        ]
          .filter((t) => tabsPermitidos.includes(t.id))
          .map((t) => {
```

Y envolver toda la barra para que no se dibuje cuando solo hay una pestaña — una sola
pestaña es ruido, no información:

```jsx
        {tabsPermitidos.length > 1 && ( ... la barra ... )}
```

- [ ] **Step 5: Verificar**

Run: `npx eslint src/pages/ops/Cuentas.jsx`
Expected: 0 problemas.

- [ ] **Step 6: Commit**

```bash
git add -A src/pages/
git commit -m "feat(cuentas): la pagina vive en ops con pestanas segun el rol"
```

---

## Task 3: Menú y rutas

**Files:**

- Modify: `src/lib/constants.js`
- Modify: `src/components/layout/AppShell.jsx:68-84`
- Modify: `src/App.jsx`

- [ ] **Step 1: Añadir el módulo a los dos roles**

En `ROLE_MODULES`, añadir `"Cuentas"` al array de `Vendedor` y al de `Bodeguero`.
**No** añadirlo a `Tecnico`. El Admin ya lo tiene por su panel.

- [ ] **Step 2: Icono y ruta**

En `MODULE_ICONS`, junto a los demás:

```js
  Cuentas: "💵",
```

En `MODULE_ROUTES`:

```js
  Cuentas: "/ops/cuentas",
```

- [ ] **Step 3: Sección del menú**

En `AppShell.jsx`, dentro de `MODULE_SECTION` (línea 68):

```js
  Cuentas: "Operación comercial",
```

Va en la misma sección para los dos roles porque un módulo solo puede estar en una.
Para la vendedora encaja de forma natural; para bodega es el sitio menos malo, y
buscarlo ahí no cuesta.

- [ ] **Step 4: Ruta en el router**

En `src/App.jsx`, cambiar el import existente:

```jsx
import Cuentas from "./pages/admin/Cuentas";
```

por:

```jsx
import Cuentas from "./pages/ops/Cuentas";
```

La ruta de admin (`<Route path="cuentas" element={<Cuentas />} />` dentro del bloque
`/admin`) **no cambia**: sigue apuntando al mismo componente, ahora desde su nueva
ubicación.

Y añadir la ruta de ops, dentro del bloque de rutas de `/ops`, siguiendo el patrón de
las demás rutas protegidas del archivo:

```jsx
<Route
  path="cuentas"
  element={
    <RoleGuard roles={["Admin", "Vendedor", "Bodeguero"]}>
      <Cuentas />
    </RoleGuard>
  }
/>
```

Copiar la forma exacta del `RoleGuard` de una ruta vecina de `/ops` — si el archivo usa
otra sintaxis, seguir esa.

- [ ] **Step 5: Verificar**

Run: `npx eslint src/App.jsx src/lib/constants.js src/components/layout/AppShell.jsx && npm run build`
Expected: 0 problemas y build exitoso.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/lib/constants.js src/components/layout/AppShell.jsx
git commit -m "feat(cuentas): entrada de menu y ruta en operaciones"
```

---

## Task 4: El botón de anular, solo para Admin

Este es el botón que va a fallar si no se toca. `PagoCuentaModal` recibe
`{ cuenta, onClose, onChanged }` y **no sabe qué rol tiene quien lo abre**; el botón de
la papelera se dibuja siempre. Hoy no importa porque solo entra el Admin.

**Files:**

- Modify: `src/components/cuentas/PagoCuentaModal.jsx`

- [ ] **Step 1: Saber el rol dentro del modal**

Junto a los primeros hooks del componente:

```jsx
const perfil = useAuthStore((s) => s.perfil);
const esAdmin = perfil?.rol === "Admin";
```

Con su import:

```jsx
import { useAuthStore } from "../../stores/authStore";
```

Se lee del store en vez de recibirlo por props para no tener que tocar los dos sitios
que abren el modal.

- [ ] **Step 2: Acotar el botón**

Localizar el bloque `{anularId !== p.id && (` que dibuja el botón con
`aria-label="Anular movimiento"`. Cambiarlo por:

```jsx
                        {/* fn_eliminar_pago_cuenta es solo del Admin: anular
                            deshace un movimiento contable. Sin esta condición,
                            una vendedora vería la papelera y recibiría un
                            error del servidor al pulsarla. */}
                        {esAdmin && anularId !== p.id && (
```

- [ ] **Step 3: Verificar**

Run: `grep -n "esAdmin && anularId" src/components/cuentas/PagoCuentaModal.jsx`
Expected: una línea.

Run: `npx eslint src/components/cuentas/PagoCuentaModal.jsx && npm run build`
Expected: 0 problemas y build exitoso.

- [ ] **Step 4: Commit**

```bash
git add src/components/cuentas/PagoCuentaModal.jsx
git commit -m "fix(cuentas): anular un pago solo lo ve el Admin"
```

---

## Task 5: Verificación final

- [ ] **Step 1: Ningún botón sin acotar**

Run: `grep -rn "fn_eliminar_pago_cuenta\|fn_registrar_pago_cuenta" src/`

Expected: solo `PagoCuentaModal.jsx`. Comprobar a ojo que cada llamada está detrás de
una condición de rol coherente con lo que permite el servidor.

- [ ] **Step 2: Lint y build**

Run: `npx eslint src/pages/ops/Cuentas.jsx src/components/cuentas/ src/App.jsx src/lib/constants.js src/components/layout/AppShell.jsx && npm run build`
Expected: 0 problemas y build exitoso.

- [ ] **Step 3: Confirmar que no quedó nada apuntando al sitio viejo**

Run: `grep -rn "admin/Cuentas" src/`
Expected: sin resultados.

- [ ] **Step 4: La prueba que corre el dueño**

Con sesión de **vendedora** (por ejemplo Deyanira, CV):

1. Aparece "Cuentas" en el menú, en Operación comercial.
2. Entra y ve **solo** "Por cobrar", sin barra de pestañas, y **solo ventas de CV**.
3. Registra un cobro de una venta a crédito de su sede. Funciona.
4. **No ve el botón de papelera** para anular pagos.

Con sesión de **bodeguero**:

5. Ve "Cuentas" y entra a **"Por pagar"**, con las compras que llegan a BODEGA.
6. Registra un pago de una compra a crédito. Funciona.
7. Tampoco ve la papelera.

Con sesión de **Admin** (Maritza):

8. En el panel admin, `/admin/cuentas` sigue funcionando igual que siempre, con las
   dos pestañas y con la papelera.

Con sesión de **técnico**:

9. No ve "Cuentas" en el menú, y entrar a `/ops/cuentas` a mano lo devuelve a `/ops`.

- [ ] **Step 5: Commit final si hubo ajustes**

```bash
git add -A
git commit -m "chore(cuentas): ajustes de verificacion final"
```

---

## Alcance

No se toca `fn_eliminar_pago_cuenta`: anular sigue siendo solo del Admin. No se cambian
las vistas ni la RLS de `ventas` y `compras`. No se toca el módulo de Cierre. El
técnico no gana acceso a nada.
