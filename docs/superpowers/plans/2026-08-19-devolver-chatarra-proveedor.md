# Devolver al proveedor una pieza en chatarra — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar un camino visible desde la garantía de venta para mandar al proveedor la pieza que quedó en chatarra, usando la capacidad que la app ya tiene pero que nadie encuentra.

**Architecture:** Casi todo es frontend. La devolución a proveedor de una chatarra ya funciona hoy (el buscador de Devoluciones no filtra `vendible` y el stock de chatarra vive en `inventario.cantidad`); lo que falta es el atajo. Se añade un bloque en el detalle de la garantía con botones contextuales según permisos y sede, y se enseña a Devoluciones y Traspasos a llegar con el producto preseleccionado por URL. El único cambio de servidor es el texto de un mensaje de error.

**Tech Stack:** React 19, Vite, Supabase (PostgreSQL + RLS), lucide-react, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-19-devueltos-reclamo-proveedor-design.md`

---

## Antes de empezar

**Verificación:** este repo tiene vitest, pero sus tests de integración usan fixtures
ficticios (usuarios `carlos`/`maria`, sedes `BOD-PRINCIPAL`/`ALM-01`) que no existen en
esta base, así que `integrationEnvNoDisponible()` los salta enteros. Escribir tests ahí
daría cobertura de mentira. La verificación real de cada tarea es `npx eslint` sobre lo
tocado, `npm run build`, y la prueba manual descrita paso a paso.

**Rama:** crear `feat/devolver-chatarra-proveedor` desde `main` antes de la Task 1.
No trabajar sobre `main`.

**Preview antes de cada tarea:** presentar el cambio al dueño y esperar su OK.

### Permisos reales, ya verificados contra el código

Esto manda sobre qué botón ve cada quien. No inventar nada distinto:

- **Devolución a proveedor** (`DevolucionNueva.jsx:68`): la ofrece la UI si el rol es
  `Admin` o `Bodeguero`.
- **Y el límite que de verdad manda** (`DevolucionNueva.jsx:255`): el formulario envía
  siempre `p_sede_id: perfil?.sede_id` y **no tiene selector de sede**. Da igual que la
  RPC le permita a un Admin operar en cualquier sede: la pantalla nunca se lo pide. Por
  tanto **nadie, ni el Admin, puede devolver al proveedor una pieza que no esté en su
  propia sede**.
- **Traspaso** (`fn_crear_traspaso`): _"Solo puedes crear traspasos desde tu propia
  sede"_ salvo Admin, y `TraspasoNuevo.jsx:39` sí le da al Admin un selector de origen.

Consecuencia práctica: **el traspaso a bodega es obligatorio**, no un adorno. Una
chatarra que quedó en CHV no la puede devolver nadie hasta que llegue a BODEGA. Quien
la envía es la vendedora de CHV (desde su sede) o un Admin (desde cualquiera).

Una versión anterior de este plan afirmaba que un Admin podía devolverla directamente
desde CHV. Era falso y se corrigió al revisar qué sede manda el formulario.

## Estructura de archivos

| Archivo                                                               | Responsabilidad                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/pages/ops/Garantias/GarantiaVentaDetalle.jsx`                    | Modificar: bloque "Piezas devueltas por el cliente" con botones contextuales |
| `src/pages/ops/DevolucionNueva.jsx`                                   | Modificar: aceptar `?tipo=` y `?producto=`                                   |
| `src/pages/ops/TraspasoNuevo.jsx`                                     | Modificar: aceptar `?producto=`, `?origen=`, `?destino=`                     |
| `supabase/migrations/20260819000001_msg_anular_garantia_chatarra.sql` | Crear: mejor mensaje del bloqueo de anulación                                |

---

## Task 1: Bloque "Piezas devueltas" en el detalle de la garantía

**Files:**

- Modify: `src/pages/ops/Garantias/GarantiaVentaDetalle.jsx`

- [ ] **Step 1: Cargar las chatarras de esta garantía**

El componente ya carga en un `Promise.all` dentro de `useEffect` (a partir de la línea
70). Añadir una tercera consulta al array y su `useState`.

Junto a los `useState` existentes (línea ~60):

```jsx
const [devueltos, setDevueltos] = useState([]);
```

Dentro del `Promise.all`, como tercer elemento:

```jsx
            // Chatarras que produjo esta garantía. El filtro por tipo='chatarra'
            // es lo que separa el ingreso real de las reversas que deja una
            // anulación, que también son movimientos 'garantia_entrada'.
            supabase
              .from("movimientos")
              .select(
                `id, producto_id, sede_id, cantidad, fecha,
                 producto:producto_id!inner(nombre, referencia, tipo)`,
              )
              .eq("referencia_id", id)
              .eq("referencia_tipo", "garantia_venta")
              .eq("tipo", "garantia_entrada")
              .eq("producto.tipo", "chatarra"),
```

Ajustar la desestructuración para recibirlo:

```jsx
        const [
          { data: gar, error: garErr },
          { data: det, error: detErr },
          { data: chat, error: chatErr },
        ] = await Promise.all([
```

Y después de `setDetalles(det ?? [])`:

```jsx
if (chatErr) throw chatErr;
// Stock actual de cada chatarra: sin esto no se puede saber si el
// botón de devolver serviría o fallaría.
let filas = chat ?? [];
if (filas.length > 0) {
  const { data: inv } = await supabase
    .from("inventario")
    .select("producto_id, sede_id, cantidad")
    .in(
      "producto_id",
      filas.map((f) => f.producto_id),
    );
  const mapa = new Map(
    (inv ?? []).map((i) => [`${i.producto_id}|${i.sede_id}`, i.cantidad]),
  );
  filas = filas.map((f) => ({
    ...f,
    stock: mapa.get(`${f.producto_id}|${f.sede_id}`) ?? 0,
  }));
}
setDevueltos(filas);
```

- [ ] **Step 2: Calcular qué puede hacer el usuario con cada pieza**

Justo antes del `return` del render, después de los otros valores derivados:

```jsx
const esBodeguero = perfil?.rol === "Bodeguero";
const puedeGestionarChatarra = esAdmin || esBodeguero;

/** Qué acción ofrecer para una chatarra concreta, según permisos y sede.
 *  Nunca devuelve una acción que la RPC vaya a rechazar: ofrecer un botón
 *  que va a fallar es peor que no ofrecer nada. */
const accionDevuelto = (d) => {
  if ((d.stock ?? 0) <= 0) {
    return { tipo: "sin-stock" };
  }
  const enMiSede = d.sede_id === perfil?.sede_id;
  // OJO: el formulario de Devoluciones manda SIEMPRE `perfil.sede_id` y no
  // tiene selector de sede (DevolucionNueva.jsx:255). Así que devolver solo
  // es posible si la pieza está en la sede de quien la registra — Admin
  // incluido, aunque la RPC en teoría se lo permitiría desde cualquier sede.
  if (puedeGestionarChatarra && enMiSede) {
    return { tipo: "devolver" };
  }
  // Traspaso: fn_crear_traspaso exige sede propia salvo Admin, y el
  // formulario sí deja al Admin elegir el origen (TraspasoNuevo.jsx:39).
  // Una vendedora también puede enviar desde su sede, y debe poder: es
  // quien tiene la pieza en la mano.
  if (esAdmin || enMiSede) {
    return { tipo: "traspasar" };
  }
  return { tipo: "otra-sede" };
};
```

- [ ] **Step 3: Renderizar el bloque**

Insertar justo después del bloque `{/* Repuestos entregados (cambiar_pieza) */}` que
termina en `</div>)}` alrededor de la línea 475, antes del `</div>` que cierra la
columna. Usa las mismas clases (`iblock`, `ib-head`, `ib-ico`, `ib-title`, `ib-aux`)
que el bloque vecino, para que se vea igual:

```jsx
{
  /* Piezas que devolvió el cliente y quedaron en chatarra.
              El camino hacia el proveedor: la capacidad ya existía en
              Devoluciones, pero no había nada que llevara hasta ella. */
}
{
  devueltos.length > 0 && (
    <div className="iblock">
      <div className="ib-head">
        <div className="ib-ico">
          <PackageX className="h-3.5 w-3.5" />
        </div>
        <div className="ib-title">Piezas devueltas por el cliente</div>
        <div className="ib-aux">{devueltos.length} items</div>
      </div>
      <ul className="flex flex-col gap-1.5">
        {devueltos.map((d) => {
          const accion = accionDevuelto(d);
          return (
            <li
              key={d.id}
              className="flex flex-col gap-2 rounded-lg border px-3.5 py-2.5"
              style={{
                borderColor: "var(--n-100)",
                backgroundColor: "var(--n-0)",
              }}
            >
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p
                    className="text-[12.5px] font-medium leading-tight"
                    style={{ color: "var(--n-950)" }}
                  >
                    {d.producto?.nombre}
                  </p>
                  <p
                    className="font-mono text-[11px]"
                    style={{ color: "var(--n-500)" }}
                  >
                    {d.producto?.referencia} · {d.sede_id} · en stock:{" "}
                    {d.stock ?? 0}
                  </p>
                </div>
                <span
                  className="font-mono text-[13px] font-medium"
                  style={{ color: "var(--n-700)" }}
                >
                  × {d.cantidad}
                </span>
              </div>

              {accion.tipo === "devolver" && (
                <button
                  onClick={() =>
                    navigate(
                      `/ops/devoluciones/nueva?tipo=proveedor&producto=${d.producto_id}`,
                    )
                  }
                  className="focus-ring self-start rounded-md px-3 py-2 text-[12px] font-medium"
                  style={{
                    backgroundColor: "var(--p-700)",
                    color: "#fff",
                    minHeight: "40px",
                  }}
                >
                  Devolver al proveedor
                </button>
              )}

              {accion.tipo === "traspasar" && (
                <button
                  onClick={() =>
                    navigate(
                      `/ops/traspasos/nuevo?producto=${d.producto_id}&origen=${encodeURIComponent(d.sede_id)}&destino=BODEGA`,
                    )
                  }
                  className="focus-ring self-start rounded-md border px-3 py-2 text-[12px] font-medium"
                  style={{
                    borderColor: "var(--n-200)",
                    color: "var(--n-700)",
                    minHeight: "40px",
                  }}
                >
                  Traspasar a bodega para devolver
                </button>
              )}

              {accion.tipo === "otra-sede" && (
                <p className="text-[11.5px]" style={{ color: "var(--n-500)" }}>
                  Está en {d.sede_id}. Esa sede debe enviarla a bodega antes de
                  poder devolverla al proveedor.
                </p>
              )}

              {accion.tipo === "sin-stock" && (
                <p className="text-[11.5px]" style={{ color: "var(--n-500)" }}>
                  Ya no está en inventario: se devolvió al proveedor o se dio de
                  baja. Puedes ver su historial en Auditoría.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Importar el icono**

Añadir `PackageX` a la lista de imports de `lucide-react` de la cabecera del archivo
(que ya trae `Package`, `Wrench`, etc.).

- [ ] **Step 5: Verificar**

Run: `npx eslint src/pages/ops/Garantias/GarantiaVentaDetalle.jsx`
Expected: 0 problemas.

Run: `npm run build`
Expected: build exitoso (habrá un warning preexistente de "chunks larger than 500 kB",
es normal).

- [ ] **Step 6: Commit**

```bash
git add src/pages/ops/Garantias/GarantiaVentaDetalle.jsx
git commit -m "feat(garantias): bloque de piezas devueltas con camino al proveedor"
```

---

## Task 2: `DevolucionNueva` acepta preselección por URL

**Files:**

- Modify: `src/pages/ops/DevolucionNueva.jsx`

- [ ] **Step 1: Importar `useSearchParams`**

El archivo ya importa de `react-router-dom`. Añadir `useSearchParams` a esa
importación existente.

- [ ] **Step 2: Leer y aplicar los parámetros**

Añadir junto a los `useState` del componente (después de la línea ~68, donde se define
`esBodega`):

```jsx
const [searchParams] = useSearchParams();
const tipoParam = searchParams.get("tipo");
const productoParam = searchParams.get("producto");

// Preselección al llegar desde una garantía. Reacciona al cambio de
// parámetros y no solo al montaje: si el usuario ya está en esta página y
// entra otra vez desde otra garantía, React Router no remonta el componente
// y la segunda preselección se perdería en silencio.
useEffect(() => {
  // Lista blanca: un ?tipo= arbitrario no debe llegar crudo al estado.
  // El guard de la línea 81 fuerza 'cliente' a quien no es bodega, así que
  // aquí solo se propone; si no tiene permiso, ese efecto lo corrige.
  if (tipoParam === "proveedor" || tipoParam === "cliente") {
    setTipo(tipoParam);
  }
  if (!productoParam) return;
  let vivo = true;
  (async () => {
    const { data, error: e } = await supabase
      .from("productos")
      .select("id, nombre, referencia, unidad_medida")
      .eq("id", productoParam)
      .eq("activo", true)
      .maybeSingle();
    // Si no existe o está inactivo no se preselecciona nada y la página
    // queda utilizable a mano, en vez de romperse.
    if (vivo && !e && data) setProductoSeleccionado(data);
  })();
  return () => {
    vivo = false;
  };
}, [tipoParam, productoParam]);
```

- [ ] **Step 3: Verificar a mano**

Run: `npm run dev`

Con sesión de Admin, abrir:
`http://localhost:5173/ops/devoluciones/nueva?tipo=proveedor&producto=<id-de-una-chatarra>`

Expected: la página abre con el tipo en "A proveedor" y el producto ya seleccionado,
listo para poner cantidad y motivo. Abrir `/ops/devoluciones/nueva` sin parámetros debe
comportarse exactamente como antes.

- [ ] **Step 4: Verificar el caso sin permiso**

Con sesión de una vendedora, abrir la misma URL con `tipo=proveedor`.

Expected: el tipo cae a "cliente" (lo fuerza el efecto que ya existe en la línea 81),
no aparece la opción de proveedor, y la página no se rompe.

- [ ] **Step 5: Verificar**

Run: `npx eslint src/pages/ops/DevolucionNueva.jsx`
Expected: 0 problemas.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ops/DevolucionNueva.jsx
git commit -m "feat(devoluciones): preseleccionar tipo y producto desde la URL"
```

---

## Task 3: `TraspasoNuevo` acepta preselección por URL

Aquí no hay que escribir lógica nueva de carga: `handleQRFound(productoId)` (línea
~191) ya hace exactamente lo necesario — busca el producto, valida que exista y esté
activo, comprueba que tenga stock en la sede origen, y lo añade con `agregarItem`.
Se reutiliza.

**Files:**

- Modify: `src/pages/ops/TraspasoNuevo.jsx`

- [ ] **Step 1: Importar `useSearchParams`**

Añadirlo a la importación existente de `react-router-dom`.

- [ ] **Step 2: Aplicar los parámetros**

Añadir después de la declaración de `handleQRFound` (para que la referencia exista) y
junto a los demás efectos:

```jsx
const [searchParams] = useSearchParams();
const productoParam = searchParams.get("producto");
const origenParam = searchParams.get("origen");
const destinoParam = searchParams.get("destino");

// Llegada desde una garantía: traer la chatarra a bodega para devolverla.
// Reacciona a los parámetros, no solo al montaje, por la misma razón que en
// Devoluciones: React Router no remonta si solo cambia la query string.
useEffect(() => {
  // Las sedes se validan contra las reales: un ?origen= inventado no debe
  // llegar crudo al estado ni a la RPC.
  const sedeValida = (s) => SEDES.some((x) => x.id === s);
  if (origenParam && sedeValida(origenParam) && esAdmin) {
    setSedeOrigen(origenParam);
  }
  if (destinoParam && sedeValida(destinoParam)) {
    setSedeDestino(destinoParam);
  }
}, [origenParam, destinoParam, SEDES, esAdmin]);

// El producto se añade aparte y después: handleQRFound necesita que
// sedeOrigen ya esté puesta para poder comprobar el stock.
useEffect(() => {
  if (!productoParam || !sedeOrigen) return;
  handleQRFound(productoParam);
  // Solo al llegar con el parámetro y con sede ya resuelta; agregarItem es
  // idempotente por producto, así que un re-disparo no duplica la línea.
}, [productoParam, sedeOrigen, handleQRFound]);
```

`setSedeOrigen` solo se aplica si `esAdmin`, porque para el resto la sede origen es la
suya y la RPC lo rechazaría igual (_"Solo puedes crear traspasos desde tu propia
sede"_). Para ellos el parámetro se ignora y el traspaso sale de su sede, que es la
correcta.

- [ ] **Step 3: No añadir guarda de duplicados — ya existe**

Verificado: `agregarItem` (línea 114) hace el chequeo **dentro del setter funcional**,
comparando contra `prev`:

```jsx
    setItems((prev) => {
      if (prev.find((i) => i.producto_id === prod.id)) {
        yaEstaba = true;
        return prev;
      }
```

El comentario del propio archivo explica por qué está ahí y no fuera: así ve el estado
más reciente y aguanta la carrera del escáner en modo continuo. Por eso el efecto del
Step 2 puede volver a dispararse sin duplicar la línea, y **no hay que añadir ninguna
guarda**. No la añadas: duplicaría una comprobación que ya está resuelta en el sitio
correcto.

- [ ] **Step 4: Verificar a mano**

Run: `npm run dev`

Con sesión de Admin, abrir:
`http://localhost:5173/ops/traspasos/nuevo?producto=<id-chatarra>&origen=CHV&destino=BODEGA`

Expected: origen en CHV, destino en BODEGA y la chatarra ya añadida como línea. Abrir
`/ops/traspasos/nuevo` sin parámetros debe comportarse como antes.

- [ ] **Step 5: Verificar**

Run: `npx eslint src/pages/ops/TraspasoNuevo.jsx`
Expected: 0 problemas.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ops/TraspasoNuevo.jsx
git commit -m "feat(traspasos): preseleccionar producto y sedes desde la URL"
```

---

## Task 4: Mejorar el mensaje del bloqueo de anulación

Único cambio de base de datos. Solo cambia el texto de un `raise exception`: ninguna
lógica de inventario se toca.

**Files:**

- Create: `supabase/migrations/20260819000001_msg_anular_garantia_chatarra.sql`

- [ ] **Step 1: Traer la definición vigente de producción**

Antes de escribir nada, obtener la función tal como está hoy y guardarla en el reporte,
como red de seguridad para revertir:

```sql
select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'fn_anular_garantia_venta';
```

La versión de referencia está en
`supabase/migrations/20260610000037_fn_anular_garantia_venta.sql`. **Si la de
producción difiere, manda la de producción**: copiarla entera y cambiarle solo el
bloque del `raise`.

- [ ] **Step 2: Escribir la migración**

Copiar la definición vigente completa y sustituir únicamente este bloque:

```sql
      if v_stock_ant < v_mov.cantidad then
        raise exception 'No se puede anular: la chatarra ingresada (% uds en %) ya no está disponible (stock %).',
          v_mov.cantidad, v_mov.sede_id, v_stock_ant;
      end if;
```

por:

```sql
      if v_stock_ant < v_mov.cantidad then
        -- El mensaje anterior decía la causa pero no el producto ni la salida,
        -- así que obligaba a ir a buscar de qué pieza hablaba.
        select nombre into v_prod_nombre from productos where id = v_mov.producto_id;
        raise exception 'No se puede anular: la chatarra de "%" (% ud en %) ya no está en inventario (quedan %). Seguramente ya se devolvió al proveedor o se dio de baja: revisa su historial en Auditoría. Si de verdad hay que anular esta garantía, primero haz un ajuste de entrada de esa pieza.',
          coalesce(v_prod_nombre, v_mov.producto_id::text), v_mov.cantidad, v_mov.sede_id, v_stock_ant;
      end if;
```

Y declarar la variable nueva en el `declare` de la función, junto a las demás:

```sql
  v_prod_nombre text;
```

- [ ] **Step 3: Aplicar**

Aplicar con el MCP de Supabase (`apply_migration`), nombre
`msg_anular_garantia_chatarra`.

Si el MCP de Supabase no está conectado en la sesión, **parar y avisar** en vez de
intentar otra vía.

- [ ] **Step 4: Verificar que la función quedó bien**

```sql
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='fn_anular_garantia_venta') existe,
  (select pg_get_functiondef(p.oid) like '%revisa su historial en Auditoría%'
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='fn_anular_garantia_venta') tiene_mensaje_nuevo,
  (select pg_get_functiondef(p.oid) like '%fn_cancelar_orden%'
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='fn_anular_garantia_venta') conserva_cancelar_ot;
```

Esperado: `existe=1`, `tiene_mensaje_nuevo=true`, `conserva_cancelar_ot=true`.

Ese tercer valor importa: confirma que se copió la función entera y no se perdió el
bloque que cancela la OT de reparación.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260819000001_msg_anular_garantia_chatarra.sql
git commit -m "fix(garantias): el bloqueo de anulacion dice el producto y la salida"
```

---

## Task 5: Verificación final

- [ ] **Step 1: Lint y build**

Run: `npx eslint src/pages/ops/Garantias/GarantiaVentaDetalle.jsx src/pages/ops/DevolucionNueva.jsx src/pages/ops/TraspasoNuevo.jsx && npm run build`
Expected: 0 problemas de lint y build exitoso.

- [ ] **Step 2: Recorrido completo, el que corre el dueño**

Con sesión de **Admin**:

1. Abrir una garantía de venta que haya generado chatarra. Aparece el bloque "Piezas
   devueltas por el cliente" con el producto, la sede y el stock.
2. Si la chatarra está fuera de bodega, el botón dice "Traspasar a bodega para
   devolver" y lleva al traspaso ya armado. Como Admin también puede devolver directo.
3. Pulsar "Devolver al proveedor": lleva a Devoluciones con tipo "A proveedor" y el
   producto puesto. Completar y guardar.
4. Volver a la garantía: el stock ahora es 0 y en vez de botón aparece la nota de que
   ya salió.
5. Intentar anular esa garantía: debe bloquear con el mensaje nuevo, que nombra el
   producto y dice qué hacer.

Con sesión de **Bodeguero**:

6. Una chatarra que esté en BODEGA muestra "Devolver al proveedor".
7. Una chatarra que esté en CHV muestra la nota de que esa sede debe enviarla, sin
   botón. Ese caso es el importante: antes se ofrecía una acción que iba a fallar.

Con sesión de **vendedora**:

8. Ve el bloque informativo con sus piezas, sin botones de gestión.

- [ ] **Step 3: Commit final si hubo ajustes**

```bash
git add -A
git commit -m "chore(garantias): ajustes de verificacion final"
```

---

## Alcance

No se toca `fn_abrir_garantia_venta` ni `fn_abrir_garantia_compra`. No se toca
`fn_registrar_devolucion`: ya funciona con chatarras. No hay tabla ni columna nueva.
No se cambian permisos ni roles. Las devoluciones de cliente se quedan como están, con
su selector de destino que ya funciona.
