# Ajustes de permisos, cuentas y cotizaciones — diseño

**Fecha:** 2026-08-20
**Estado:** pendiente de aprobación

Seis peticiones que llegaron juntas pero **no son un solo proyecto**. Se separan en
tres grupos por naturaleza del riesgo, y cada uno va en su propia rama y su propio
despliegue.

| Grupo                | Qué                                                   | Toca la base    | Riesgo   |
| -------------------- | ----------------------------------------------------- | --------------- | -------- |
| **A · Cotizaciones** | Quitar el texto de embalaje, usar el nombre comercial | No              | Ninguno  |
| **B · Trazabilidad** | Motivo en el cambio de producto                       | No              | Ninguno  |
| **C · Permisos**     | Cuentas por cobrar/pagar, herramientas                | Sí: RLS y roles | **Alto** |

Juntarlos en una sola entrega sería un error: si algo del grupo C sale mal y hay que
revertir, arrastraría cambios inofensivos que ya estaban funcionando.

El trabajo de chatarra tiene su propio diseño en
`2026-08-19-devueltos-reclamo-proveedor-design.md` y no se toca aquí.

---

# Grupo A — Cotizaciones

## A1. Quitar "Los precios incluyen embalaje estándar"

El texto está **copiado en tres archivos**:

- `src/lib/pdf/cotizacionPDF.js:303` — la nota al pie del PDF
- `src/pages/ops/CotizacionNueva.jsx:37` — constante `TEXTO_CONDICIONES`
- `src/pages/ops/CotizacionEditar.jsx:31` — la misma constante, duplicada

Esa duplicación es probablemente la razón de que siga ahí: quien lo quiso cambiar
alguna vez lo cambió en un sitio y no en los otros.

**El texto no se guarda en la base.** `cotizaciones` solo tiene `condiciones_pago`,
que es un campo distinto que escribe el vendedor. Así que al quitarlo se corrige
también en las 22 cotizaciones que ya existen, no solo en las nuevas.

**Diseño:** una sola constante `TEXTO_CONDICIONES_COTIZACION` en `pdfStyles.js`, que
ya es donde vive `TEXTO_ENTREGA_COTIZACION`. Los tres archivos la importan. Se elimina
la frase del embalaje y la de "Embalaje especial bajo cotización adicional", que sin
la primera queda huérfana.

## A2. Que la cotización salga a nombre de "Compresores CV"

La constante **ya existe**: `pdfStyles.js:28` tiene
`RECIBO_NOMBRE = "Compresores CV"`, con un comentario que dice _"nombre comercial
corto que va en los RECIBOS (no el nombre legal)"_. La usan los recibos POS; las
cotizaciones no.

En la cotización el nombre aparece en cuatro sitios, y **uno no se debe tocar**:

| Línea   | Qué es                                                   | Cambia |
| ------- | -------------------------------------------------------- | ------ |
| 78      | Encabezado grande, hoy `"COMPRESORES DEL VALLE"` a fuego | Sí     |
| 83      | Nombre bajo el logo, hoy `MARCA.nombre`                  | Sí     |
| 313     | Pie de página                                            | Sí     |
| **279** | _"A nombre de …"_ del **titular de la cuenta bancaria**  | **No** |

La línea 279 identifica a quién se le consigna. Ahí tiene que seguir el nombre legal:
si dijera "Compresores CV", el cliente estaría consignando a un titular que el banco no
reconoce.

**Diseño:** se renombra `RECIBO_NOMBRE` a `NOMBRE_COMERCIAL`, porque deja de ser
exclusivo de los recibos y el nombre viejo pasaría a mentir. Se actualizan sus dos
usos (`ventaPOS.js` y el nuevo en cotización). `MARCA.nombre` se queda intacto y sigue
siendo el nombre legal para la línea del banco.

Esa distinción —comercial contra legal— ya estaba pensada en el código. Se aprovecha
en vez de inventar otra.

---

# Grupo B — Motivo en el cambio de producto

Al revisar dónde falta el campo de observaciones resultó que **casi todos lo tienen**:

| Flujo                  | Campo           | Estado                   |
| ---------------------- | --------------- | ------------------------ |
| Garantía de venta      | `motivo`        | ✅ textarea en el modal  |
| Garantía de compra     | `motivo`        | ✅ textarea en el modal  |
| Devoluciones           | `motivo`        | ✅ lo pide el formulario |
| Traspasos              | `observaciones` | ✅                       |
| **Cambio de producto** | `p_motivo`      | ❌ **escrito a fuego**   |

En `ModalCambioProducto.jsx:246`:

```js
p_motivo: `Cambio desde venta #${venta.numero}`,
```

Siempre el mismo texto. Nadie puede explicar por qué se hizo el cambio, que es
justamente la operación donde más falta hace: un cambio mueve producto y a veces
dinero.

**Diseño:** un textarea de motivo en el modal, opcional, que se concatena con la
referencia automática en vez de reemplazarla — así no se pierde el vínculo con la
venta:

```js
p_motivo: motivo.trim()
  ? `Cambio desde venta #${venta.numero} — ${motivo.trim()}`
  : `Cambio desde venta #${venta.numero}`,
```

Cambio **solo de frontend**: el RPC ya recibe `p_motivo` como texto libre.

---

# Grupo C — Permisos

Aquí está todo el riesgo. Dos cambios independientes que tocan RLS y comprobaciones de
rol en el servidor.

## C1. Cuentas por cobrar y por pagar

### Qué se pidió

Habilitar **cuentas por cobrar a las vendedoras**, y a **bodega el pago de facturas a
crédito** — que interpretado es cuentas por pagar, las compras a crédito.

### Lo que ya funciona sin tocar nada

Las dos vistas son `security_invoker = true`, así que aplican las políticas de las
tablas de abajo:

- `ventas_select`: Admin ve todo; los demás, solo su sede.
- `compras_select`: Admin ve todo; los demás, solo `sede_destino_id` = su sede.

O sea que **leer no necesita ningún cambio en la base**, y además queda bien acotado
solo: cada vendedora vería la cartera de su sede, y bodega las compras que le llegan.

### El muro

`fn_registrar_pago_cuenta` empieza así:

```sql
if v_rol <> 'Admin' then
  raise exception 'Solo el administrador puede registrar cobros/pagos';
end if;
```

Exponer la pantalla sin tocar esto daría una lista que se ve pero un botón que
revienta. Decisión tomada: **cada rol registra lo suyo.**

### Diseño del servidor

Se sustituye el portero único por una matriz de rol y tipo. El tipo se lee antes del
control, y la comprobación de sede va **después** de cargar la venta o la compra,
porque hasta ese momento no se sabe a qué sede pertenecen.

```sql
  v_tipo := p_payload->>'tipo';

  -- Antes: solo Admin. Ahora cada rol registra lo suyo — la vendedora cobra a
  -- clientes de su sede, bodega paga a proveedores de la suya.
  if v_rol not in ('Admin','Vendedor','Bodeguero') then
    raise exception 'No tienes permiso para registrar cobros o pagos';
  end if;
  if v_tipo = 'cobro' and v_rol = 'Bodeguero' then
    raise exception 'Bodega registra pagos a proveedores, no cobros a clientes';
  end if;
  if v_tipo = 'pago' and v_rol = 'Vendedor' then
    raise exception 'Los pagos a proveedores los registra bodega o el administrador';
  end if;
```

Y dentro de cada rama, tras el `select ... for update`:

```sql
    -- cobro
    if v_rol <> 'Admin' and v_venta.sede_id is distinct from (select get_my_sede_id()) then
      raise exception 'Solo puedes registrar cobros de ventas de tu propia sede';
    end if;
```

```sql
    -- pago
    if v_rol <> 'Admin' and v_compra.sede_destino_id is distinct from (select get_my_sede_id()) then
      raise exception 'Solo puedes registrar pagos de compras de tu propia sede';
    end if;
```

El resto de la función —validación de monto contra saldo, método de pago, cuenta
bancaria obligatoria en transferencias, bloqueo de ventas anuladas y compras
canceladas— **no se toca**. Todas esas defensas siguen igual.

**`fn_eliminar_pago_cuenta` se queda solo para Admin.** Anular un pago mueve plata
hacia atrás y borra un registro contable; no es simétrico con registrarlo.

### Diseño del frontend

`Cuentas.jsx` vive hoy en `pages/admin/`, pero **no importa nada exclusivo del panel
admin** — solo `cuentas-ui`, `useFiltros` y `BarraFiltros`, todos compartidos. Así que
se puede renderizar en el shell de Operaciones sin retocar estilos.

- Se mueve a `src/pages/ops/Cuentas.jsx`. La ruta de admin lo importa desde ahí. Un
  solo archivo, dos rutas: nada de duplicar la pantalla.
- Se añade `"Cuentas"` a `ROLE_MODULES` para `Vendedor` y `Bodeguero`.
- **Las pestañas se derivan del rol**, no se ocultan con CSS:

  | Rol       | Pestañas               |
  | --------- | ---------------------- |
  | Admin     | Por cobrar · Por pagar |
  | Vendedor  | Por cobrar             |
  | Bodeguero | Por pagar              |

  Si el rol solo tiene una pestaña, la barra no se dibuja: una sola pestaña es ruido.

- El botón de anular pago solo se muestra al Admin, porque solo él puede.

Lo importante de este reparto: la interfaz esconde lo que no corresponde, pero **el
servidor es quien manda**. Un vendedor que llame el RPC a mano con `tipo: 'pago'` es
rechazado por la función, no por la pantalla.

## C2. Herramientas

### Qué se pidió

Que los préstamos se vean **de todas las sedes, en solo lectura**. Nada más.

Inicialmente se pidió además centralizar el préstamo en el Admin, pero al advertir que
eso le quitaba a los bodegueros algo que usan a diario, **el dueño lo revirtió**: quien
presta y quien devuelve se queda exactamente como hoy. Solo cambia la visibilidad.

Es la decisión correcta y además la más barata: una sola política de lectura, sin tocar
ninguna función que mueva inventario.

### Ver todas las sedes no es cosa del frontend

`Herramientas.jsx:112` filtra por sede en el cliente, pero quitarlo no basta: **la RLS
lo bloquea igual.**

```
hp_select:  rol = 'Admin' OR sede_id = get_my_sede_id()
hh_select:  igual, sobre el historial
```

Hay que cambiar las dos políticas para que el `SELECT` sea abierto a cualquier
autenticado. Las de escritura no se tocan.

Es una apertura deliberada de visibilidad: pasa de "cada uno ve lo suyo" a "todos ven
dónde está cada herramienta". Se justifica porque las herramientas viajan entre sedes y
hoy nadie puede saber dónde quedó una sin llamar por teléfono. No expone dinero ni
datos de clientes: son nombres de herramientas y su estado.

### Prestar y devolver: sin cambios

`fn_prestar_herramientas_lote`, `fn_devolver_herramienta` y sus versiones por lote se
quedan **exactamente como están**: Admin sobre cualquier sede, los demás sobre la suya.
Ninguna función de herramientas se toca.

Tampoco se tocan `fn_crear_herramienta_desde_insumo`,
`fn_enviar_herramienta_mantenimiento`, `fn_marcar_herramienta_extraviada` ni
`fn_recuperar_herramienta`. El grupo C2 pasa a ser **una migración de una sola política
de lectura, más frontend**.

### La consecuencia que hay que resolver bien

Este es el punto delicado del cambio, y no es la RLS.

Hoy la lista solo muestra herramientas de tu sede, así que cualquier acción que
aparezca es una acción que puedes hacer. **Al abrir la vista a todas las sedes, eso deja
de ser cierto**: un bodeguero de BODEGA verá herramientas de CHV, y si los botones se
dibujan igual, al pulsarlos recibirá *"No tienes permiso sobre herramientas de esta
sede"*.

Sería exactamente el error que ya cometimos con las campanas y con el botón de la
chatarra: ofrecer algo que va a fallar.

**Diseño:** las acciones se deciden **por fila**, no por rol global.

```jsx
// Antes bastaba con el rol, porque la lista ya venía filtrada por sede.
// Ahora que se ven todas las sedes, el permiso depende de CADA herramienta:
// el servidor solo deja actuar sobre la sede propia salvo al Admin.
const puedeOperar = (h) => isAdmin || h.sede_id === perfil?.sede_id;
```

Las filas de otras sedes se muestran **en modo consulta**: se ve la herramienta, su
estado, quién la tiene y desde cuándo, sin ningún botón. Que es justo lo que se pidió,
"que lo tengan solo readonly".

### Frontend

- Quitar el filtro por sede de `Herramientas.jsx:112-113`.
- **Añadir una columna de sede.** Si se ven herramientas de cuatro sedes y no se
  distingue cuál es cuál, la pantalla empeora en vez de mejorar.
- Aplicar `puedeOperar(h)` a los botones de cada fila, en vez de los actuales
  `isAdmin` / `esBodega` globales. Hay que repasarlos uno por uno: hoy gobiernan
  acciones que se quedan igual, así que no se pueden borrar a ciegas.
- La lista de usuarios a quien prestar (líneas 142-143) **sigue filtrada por sede**: se
  presta a gente de la sede de la herramienta, y ese filtro no estorba a nadie.

---

# Orden de ejecución

1. **Grupo A** — sin riesgo, se puede desplegar el mismo día.
2. **Grupo B** — sin riesgo, frontend puro.
3. **Grupo C2** — herramientas. Al revertirse la centralización del préstamo, pasó de
   ser el más delicado al más simple: una política de lectura y trabajo de pantalla.
   Nadie pierde ninguna capacidad, así que no hace falta avisar a nadie antes.
4. **Grupo C1** — cuentas. Queda de último porque es el único que abre una función que
   mueve dinero. Necesita prueba con una vendedora y con bodega antes de darlo por
   bueno.

Cada grupo en su rama, su verificación y su despliegue.

# Riesgos

- **C1 abre a dos roles más una función que mueve dinero.** Es el único riesgo real que
  queda. Mitigado en tres capas: el control vive en el servidor y no en la pantalla,
  está acotado por sede y por tipo de operación, y anular un pago sigue siendo
  exclusivo del Admin.
- **Abrir el `SELECT` de herramientas es permanente en la práctica.** Una vez que la
  gente se acostumbra a ver dónde está cada herramienta, quitarlo se sentiría como una
  pérdida. No expone dinero ni datos de clientes, así que se asume.
- **El riesgo que se evitó:** centralizar el préstamo de herramientas en el Admin
  habría dejado a la operación sin poder prestar ni recibir nada cuando él no
  estuviera. Se descartó al ver que les quitaba algo que usan a diario. Queda anotado
  porque es el tipo de cambio que parece un endurecimiento sensato sobre el papel y
  rompe la operación en la práctica.
