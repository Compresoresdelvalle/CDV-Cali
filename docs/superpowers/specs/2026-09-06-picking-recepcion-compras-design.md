# Picking de recepción de compras

**Fecha:** 2026-09-06
**Rama:** `feat/picking-compras`
**Estado:** diseño aprobado en lo grande, pendiente de revisión escrita

## El problema

Cuando llega mercancía de un proveedor, hoy el bodeguero pulsa un botón y la
compra entera se da por recibida. El inventario sube exactamente lo que decía la
factura, haya llegado o no. No hay dónde anotar que faltaron tres, que dos
llegaron partidas o que mandaron dos de más.

Las consecuencias no se ven ese día, se ven después: el conteo cíclico marca un
descuadre y nadie sabe si fue robo, error de digitación o mercancía que el
proveedor nunca despachó. Para entonces ya no hay a quién reclamarle.

La pantalla actual además finge: dibuja un checklist de items y una barra de
progreso que va de 0% a 100% de un salto, con los items no editables. El propio
código lo dice en un comentario en `CompraDetalle.jsx`.

## Lo que ya existe (y cambia el punto de partida)

Antes de diseñar nada revisé qué había. Media feature está construida y sin usar:

**`fn_recibir_compra(p_compra_id, p_recepciones)` ya acepta recepción parcial.**
Si le llega `[{detalle_id, cantidad_recibida}]`, ajusta cada línea a lo que
realmente llegó, recalcula subtotal/IVA/total de la compra y deja la nota en
observaciones. Si una línea llega en 0 la borra; si todas llegan en 0, rechaza y
manda a cancelar la compra. **La pantalla nunca le pasa ese parámetro**, y el
comentario que dice que "el backend NO soporta recepción parcial" está
desactualizado.

**Lo que sí falta:**

| Caso | Hoy |
| --- | --- |
| Llegó menos | El backend ya lo hace; la UI no lo usa |
| Llegó de más | Bloqueado: la RPC lanza excepción si recibido > pedido |
| Llegó dañado | El concepto no existe |
| Contar / escanear | No hay pantalla |
| Imprimir QR de lo que llegó | Existe `/ops/etiquetas`, suelta, sin conexión con la compra |

**Moldes que se reutilizan sin inventar nada:**

- `RecepcionTraspaso.jsx` — pedido vs recibido, +/−, alerta de diferencias,
  modal de confirmación. El idioma de **lista**.
- `PickingPage.jsx` (traspasos) — asistente de uno por uno, "Producto 8 de 15",
  barra de progreso, escáner que salta al item leído. El idioma de **enfoque**.
- `generarEtiquetasPDF` — el generador de etiquetas QR de `/ops/etiquetas`.
- `notificaciones` + `useNotificaciones` — tabla en producción con `dedupe_key`,
  hook con realtime ya montado en `AppShell` y `AdminShell`.
- `fn_abrir_garantia_compra` con `resolucion='pendiente'` deja la garantía
  `abierta` y saca el stock; `fn_definir_resolucion_garantia_compra` deja que
  Bodega o el Admin decidan nota crédito o reposición. Eso es exactamente el
  estado "pendiente por garantía".

## Alcance: dos bloques

El aviso al Admin no es parte del picking: sirve igual desde una OT, un traspaso
o un cierre descuadrado. Se construye aparte y el picking lo consume.

- **Bloque 0 — Aviso urgente al Admin.** Pequeño, reutilizable, va primero.
- **Bloque 1 — Picking de recepción.** La pantalla y su RPC.

---

# Bloque 0 · Aviso urgente al Admin

Cualquier operario puede escalarle algo al Admin desde donde esté trabajando. Al
Admin le sale un modal a pantalla completa que no se ignora.

## Datos

Reusa `notificaciones` tal cual. Ninguna tabla nueva.

```
tipo        = 'escalamiento'
para_rol    = 'Admin'
titulo      = 'Bodega necesita ayuda con la compra #412'
mensaje     = el motivo que escribió el operario
data        = { origen, origen_id, numero, sede_id, usuario_nombre,
                usuario_telefono, ruta }
dedupe_key  = 'escalamiento:compra:<compra_id>'
```

## RPC — `fn_escalar_a_admin(p_origen text, p_origen_id uuid, p_motivo text)`

El tope de dos avisos **vive en el servidor**. En la pantalla no sirve: con
recargar se reinicia y el spam vuelve. Se cuenta contra `dedupe_key`.

Al agotarse no falla en seco, dice qué hacer:

> Ya le avisaste 2 veces a Maritza por esta compra (la última hace 12 minutos).
> Si es urgente, llámala al 3XX XXX XXXX.

Devuelve `{ avisos_enviados, restantes, admin_nombre, admin_telefono,
ultimo_aviso }` para que el botón pueda decir **"Ya se le avisó a Admin Maritza ·
queda 1 aviso"**.

`SECURITY DEFINER`, `search_path` fijo, `EXECUTE` solo para `authenticated`.

## Pantalla

**`AvisoUrgenteModal`**, montado en los dos shells. Si hay alguna notificación
sin leer de `tipo='escalamiento'`, pinta un modal a pantalla completa por encima
de todo. Solo al Admin y solo para escalamientos: las notificaciones normales
siguen en la campana.

Como `useNotificaciones` ya carga las no leídas al montar, esto cumple gratis el
requisito de que **si el Admin no estaba conectado, sea lo primero que vea al
abrir la app**. No hay que programar nada extra para eso.

Contenido: quién avisó, desde dónde, hace cuánto, el motivo. Dos botones: **"Ir a
la compra #412"** (navega y marca leída) y **"Entendido"** (solo marca leída).
Si hay varios sin leer salen en cola, uno por uno.

**`BotonAvisarAdmin`** — componente reutilizable. Pide el motivo en un campo
corto, llama la RPC, y queda en estado informativo con los avisos restantes.
Deshabilitado cuando se agotan, con el teléfono a la vista.

---

# Bloque 1 · Picking de recepción

**Ruta:** `/ops/compras/:id/picking`, espejo de `/ops/traspasos/:id/picking`.
**Roles:** Admin, Bodeguero y Vendedor — los mismos tres que ya acepta
`fn_recibir_compra`, con la misma regla de sede.

## Cómo se entra

En el detalle de una compra sin recibir, el botón principal pasa a ser **"Contar
y recibir"**. Debajo, en texto pequeño y gris, **"Recibir sin contar"**. No es
una puerta escondida, pero no compite.

## Qué pide cada línea

Dos números. El resto lo deriva el sistema.

| Campo | Quién |
| --- | --- |
| Pedido | el sistema |
| **Llegaron** | el operario |
| **De esas, dañadas** | el operario, solo si llegaron > 0 |

Derivados, mostrados en lenguaje llano:

```
buenas  = llegaron − dañadas
faltan  = max(0, pedido − llegaron)
sobran  = max(0, llegaron − pedido)
```

**"Llegaron" arranca en el pedido, no en cero.** En la vida real casi todo llega
completo; arrancar en cero obliga a teclear cuarenta veces lo que ya se sabe.
Es además lo que ya hace `RecepcionTraspaso`.

El riesgo obvio de ese default es que pasen de largo sin mirar. Contra eso, cada
línea guarda si el operario **la tocó** (botón, teclado o escáner), y el resumen
final lo dice sin regañar: **"contadas 8 · asumidas completas 7"**. Honesto, sin
convertirse en obstáculo.

## Las preguntas, solo cuando hacen falta

- **Faltan** → *¿el proveedor lo facturó?*
  - **No lo despacharon ni lo cobran** → se ajusta la factura hacia abajo
    (`p_recepciones`, que ya existe).
  - **Sí, hay que reclamarlo** → la factura no se toca, se recibe completo y esas
    unidades se reclaman.
- **Dañadas** → siempre reclamo, sin preguntar. Llegó, pero no sirve.
- **Sobran** → *¿entra y ya, o entra y hay que reportarlo?* En los dos casos entra
  al inventario, porque físicamente está en la bodega. Si no entra, el conteo
  cíclico lo va a marcar como descuadre semanas después.

**Costo del sobrante:** las unidades de más entran al inventario y su movimiento
se registra **al costo unitario de la línea** de esa compra, que es el costo real
de ese producto. Pero **`productos.costo_promedio` no se recalcula**: el ponderado
ya lo movió la recepción de lo facturado, y volver a moverlo con unidades que
nadie facturó lo distorsiona. Dicho de otro modo: sube la cantidad y queda el
costo anotado para auditoría, no se toca el promedio.

## UI/UX

Esto se usa de pie, en un pasillo, con guantes, a veces con una mano. Tres
tamaños de pantalla, dos formas de trabajar.

### Modo enfoque — por defecto en celular

Es el idioma de `PickingPage`. Un producto llena la pantalla.

```
┌───────────────────────────────┐
│ ←  Compra #412 · FVR          │  sticky
│ ▓▓▓▓▓▓▓▓▓░░░░░░   8 de 15     │
├───────────────────────────────┤
│                               │
│   MANGUERA TUBIN 6MM AZU      │  hasta 2 líneas
│   MAT6 · entra para venta     │
│                               │
│         PEDIDO  24            │  el ancla
│                               │
│   ┌────┐   ┌───────┐   ┌────┐ │
│   │ −  │   │  24   │   │ +  │ │  56px; el número enorme
│   └────┘   └───────┘   └────┘ │
│           LLEGARON            │
│                               │
│   › marcar dañadas            │  colapsado
│                               │
│   ✓  Completo                 │  color + texto
│                               │
├───────────────────────────────┤
│  ◀ Anterior       Siguiente ▶ │  sticky, 48px
└───────────────────────────────┘
                        (◎ escáner)
```

- Tocar el número abre el `NumericKeypad` del proyecto, no el teclado del
  sistema.
- "Marcar dañadas" va colapsado: es el caso raro y no debe robar espacio.
- El estado se recalcula en vivo mientras teclea.

### Modo lista — por defecto en tablet y escritorio

El idioma de `RecepcionTraspaso`. En tablet, cards de una columna con controles
grandes. En escritorio (`lg`), tabla más densa con un panel lateral fijo que
lleva el resumen.

Un conmutador **Enfoque | Lista** en la barra permite cambiar en cualquier
momento; la preferencia se recuerda en `localStorage`. El default sale del ancho,
no de una decisión del usuario que tenga que tomar cada vez.

### Semáforo por línea

Con `StatusBadge` y los tokens del sistema, **siempre color + texto**: con
guantes, polvo y contraluz, el color solo no alcanza.

| Situación | Token |
| --- | --- |
| Completo | `--success` |
| Faltan | `--warning` |
| Dañadas | `--destructive` |
| Sobran | `--info` |

### Escáner

Botón flotante siempre visible, como manda la convención del proyecto. Al leer
una referencia: salta a esa línea, le suma uno, vibra corto y avisa. Si la
referencia no pertenece a la compra, lo dice con nombre propio — *"MAT6 no está
en la compra #412"* — y ofrece ver qué sí está, en vez de un error mudo.

### Barra de resumen

Fija abajo: **"12 de 15 líneas · 3 a reclamar · 2 de más"** y el botón de
confirmar. En celular va **por encima del bottom-nav**: ya hubo antes un botón de
recepción que quedaba tapado por la navegación, y no se puede repetir.

### Imprimir etiquetas QR

Abre un panel con las líneas y cuántas etiquetas por producto, con el default en
las unidades **buenas** (no las pedidas: se etiqueta lo que de verdad entró).
Reusa `generarEtiquetasPDF` y respeta su `MAX_COPIAS_POR_PRODUCTO`.

### El conteo no se pierde

El progreso se guarda en `localStorage` por compra en cada cambio. Si se apaga el
celular a la línea 38 de 40, al volver ofrece: *"Tienes un conteo sin terminar de
hace 12 minutos, ¿lo retomo?"*. Se borra al confirmar.

### Estados que hay que cubrir

- Compra ya recibida, o cancelada → no deja entrar, explica y lleva al detalle.
- Compra sin líneas → mensaje claro, no una pantalla vacía.
- Sin permiso o de otra sede → lo dice con la sede, no un "no autorizado" pelado.

## El modal de confirmación

Aquí se juega la claridad. No un "¿está seguro?", sino la consecuencia escrita:

> Vas a recibir la compra **#412**.
>
> - El inventario sube **47 unidades**.
> - La factura baja de $1.240.000 a **$1.180.000**: 3 unidades no las despacharon.
> - Quedan **2 unidades para reclamarle a FVR**. Se abre la garantía y Maritza
>   decide si pide nota crédito o reposición.
> - **2 unidades llegaron de más** y entran al inventario al costo de la compra.
>   Queda reportado.
>
> Esto no se puede deshacer.

## Backend

### RPC — `fn_procesar_picking_compra(p_compra_id, p_lineas, p_omitido)`

Una sola transacción. Hoy serían tres operaciones sueltas y quedar a mitad
dejaría el inventario mintiendo.

`p_lineas`:

```json
[{ "detalle_id": "…", "llegaron": 8, "danadas": 2,
   "faltante_accion": "ajustar" | "reclamar",
   "sobrante_accion": "entra" | "entra_y_reporta",
   "tocada": true }]
```

Pasos:

1. Valida rol, sede, que no esté recibida ni cancelada. Advisory lock sobre
   `picking:<compra_id>`.
2. Guarda el conteo en `compra_picking` y `compra_picking_detalle`.
3. Llama `fn_recibir_compra` con `p_recepciones` armado **solo con las líneas
   cuyo faltante se ajusta**. El trigger existente suma el stock.
4. Si hay unidades a reclamar (faltante-reclamar + dañadas), llama
   `fn_abrir_garantia_compra` con `resolucion='pendiente'`. Eso saca esas
   unidades del stock, deja la compra en `devolucion_garantia` y la garantía
   esperando la decisión del Admin.
5. Si hay sobrante, movimiento de ajuste de entrada al costo de la línea, con la
   observación apuntando a la compra.
6. Devuelve el resumen para pintarlo en pantalla.

**Orden de operaciones:** el reclamo va después de recibir porque
`fn_abrir_garantia_compra` exige la compra recibida. Las líneas que se ajustan y
las que se reclaman son disjuntas por construcción, así que el tope de "no
reclamar más de lo comprado" no puede chocar con el ajuste. El caso mixto —una
línea con faltante reclamado y además dañadas— suma ambos contra la cantidad
comprada original, que sigue intacta porque esa línea no se ajustó.

### Tablas nuevas

```
compra_picking
  id, compra_id (unique), usuario_id, fecha,
  omitido boolean, lineas_tocadas int, lineas_total int, notas

compra_picking_detalle
  id, picking_id, detalle_compra_id, producto_id,
  pedido, llegaron, danadas,
  faltante_accion, sobrante_accion, tocada
```

No es burocracia. Cuando dentro de un mes pregunten *"¿por qué esta compra bajó
$60.000?"*, la respuesta tiene que tener nombre y fecha.

RLS: lectura para Admin y para quien sea de la sede de la compra; escritura solo
por la RPC.

### Recibir sin contar

La misma RPC con `p_omitido = true` y sin líneas: hace lo de hoy, pero deja la
fila en `compra_picking` con `omitido = true`. Así se puede sacar después cuántas
compras entraron a ciegas y quién las recibió.

La advertencia dice el daño concreto, no un genérico:

> Si recibes sin contar, el inventario va a decir que llegaron 47 unidades aunque
> hayan llegado 40. Cualquier faltante que aparezca después va a quedar como
> pérdida de bodega, no como algo que el proveedor debía.

## Pruebas

- **Vitest, lógica pura:** la derivación de buenas/faltan/sobran y qué se reclama,
  incluido el caso mixto (faltante reclamado + dañadas en la misma línea), y el
  armado de `p_recepciones` (que solo lleve las líneas de faltante ajustado).
- **Contra producción, en transacciones revertidas:** recepción completa;
  faltante ajustado (baja la factura); faltante reclamado (abre garantía y saca
  stock); dañadas; sobrante (entra al costo de la línea); mixto; omitido; y las
  rechazadas — compra ya recibida, cancelada, otra sede, rol sin permiso.
- **Tope de avisos:** dos pasan, el tercero rebota con el mensaje que da salida.
- **Responsive:** revisar a 360px, 768px y 1280px que el resumen no tape el
  bottom-nav y que los controles no bajen de 48px.

## Fuera de alcance

No se toca: el flujo de garantías de compra más allá de abrirlas en `pendiente`,
el cierre de caja, las retenciones, ni `/ops/etiquetas` como pantalla propia.
