# Panel de decisiones — rediseño del Dashboard

**Fecha:** 2026-09-06
**Origen:** "hoy en día solo es bonito más que funcional real" — se pide un panel
que permita tomar decisiones, con rangos de fecha reales y desagregación
**Estado:** diseño aprobado. Plan de implementación en
`docs/superpowers/plans/2026-09-06-panel-decisiones.md`.

---

## Qué pasa hoy

El botón de refrescar **sí llama a las consultas**. Lo que no hace es avisar: el
panel ya se auto-refresca cada 60 segundos, así que al pulsarlo los números son
los mismos y parece que no hizo nada.

El problema de fondo es otro. El selector "Hoy / Semana / Mes" **solo cambia una
tarjeta** (`periodoVentas` mapea el control a tres campos ya calculados). Todo lo
demás —desglose por sede, top de productos, tendencia de 7 días, ventas por
sede— está clavado por dentro a "este mes" o "últimos 7 días", porque
`fn_dashboard_kpis` y `fn_dashboard_admin` **no reciben ni un parámetro**.

No es que el filtro esté mal hecho: no existe. Y sin parámetros no hay forma de
pedir un año ni un rango libre.

Falta además la cifra que importa. El panel muestra **ventas** —cuánto se
facturó— y nunca **cuánto se ganó**.

## Lo que los datos sí permiten

Medido sobre los últimos 90 días, para no diseñar sobre supuestos:

|                                  |                                                       |
| -------------------------------- | ----------------------------------------------------- |
| Facturado                        | $436.525.608                                          |
| Costo de lo vendido              | $116.922.406                                          |
| Líneas con costo                 | 90,5% (las sin costo son servicios, que no lo tienen) |
| **Vendido por debajo del costo** | **$6.535.825 en 103 líneas y 51 productos**           |
| Descuentos otorgados             | $1.522.551                                            |
| Garantías reembolsadas           | $271.000                                              |
| Salidas de "caja menor"          | $111.085.943 en 465 movimientos                       |
| OT diagnosticadas sin autorizar  | 54                                                    |

Los $6,5M vendidos bajo costo son el mejor ejemplo de lo que se pide: es plata
que se está perdiendo, está en la base desde hace meses, y **el panel de hoy no
puede mostrarla de ninguna forma**.

## El hallazgo que cambia el diseño

**`es_caja_menor` no marca caja menor.** Es el cajón donde cae toda la plata que
sale y no es mercancía. De los 465 movimientos, **ninguno tiene ítems**: son
egresos puros. Y los conceptos son texto libre, revueltos:

```
NOMIN · NOMINAS · NOMINA · NOMINA M · NOM E · NOM M ABONO MOTO DT
Proveedor TC · PROV TC · power proveedor abono
BANCOS · Creditos · PIDIO PLATA
```

Ahí hay tres cosas distintas mezcladas:

1. **Gastos de verdad** — nómina, arriendo, servicios. Restan del resultado.
2. **Abonos a proveedores** — no son gasto: pagan mercancía que ya está contada
   dentro del costo de lo vendido. Restarlos sería contarlos dos veces.
3. **Traslados** — "BANCOS", mover plata de un lado a otro. No son ni gasto ni
   ingreso.

Por eso **`ventas − costo − caja_menor` daría un resultado falso**: restaría los
abonos a proveedores, que ya están contados dentro del costo de lo vendido.
Además, con el concepto en texto libre no hay forma de agrupar: "NOMIN" y
"NOMINA" no se juntan solos.

El Resultado sí se muestra desde el primer día —con lo que esté clasificado y
declarando lo que falta, como se detalla en la sección 2— pero su calidad
depende directamente de que esa clasificación avance.

**Consecuencia de diseño:** clasificar los egresos es parte de este trabajo, no
un extra. Sin eso, la mitad del panel no se puede construir con honestidad.

---

## La arquitectura

### Varias RPC pequeñas, no una grande

El cierre enseñó la lección: `_fn_cierre_totales` tiene 22.000 caracteres y doce
sumas de dinero, y tocarlo obliga a revisar las doce. No se repite ese patrón.

Cada pregunta tiene su función, con la misma firma de rango:

| Función                                               | Responde                              |
| ----------------------------------------------------- | ------------------------------------- |
| `fn_panel_resultado(desde, hasta, sede)`              | ¿Gané o perdí, y de qué se compone?   |
| `fn_panel_perdidas(desde, hasta, sede)`               | ¿En qué se está yendo la plata?       |
| `fn_panel_composicion(desde, hasta, sede, dimension)` | ¿De qué se compone la venta?          |
| `fn_panel_cartera(sede)`                              | ¿Quién me debe y desde cuándo?        |
| `fn_panel_inventario(sede)`                           | ¿Cuánta plata está dormida en bodega? |

Cada una se prueba sola, y el panel las carga en paralelo: si una falla, las
demás siguen mostrando. Hoy `fn_dashboard_admin` falla en silencio y se lleva
por delante todas las secciones avanzadas a la vez.

### Dónde vive

**Ruta nueva `/admin/panel`.** El Dashboard actual se queda con lo que sí sirve y
no es análisis: alertas de stock, OT que necesitan atención, cotizaciones por
vencer. La división queda limpia:

- **Dashboard** — qué necesita atención _hoy_.
- **Panel** — cómo va el negocio.

Se construye aparte en vez de reescribir los 1.743 líneas del actual: así el
panel viejo sigue funcionando mientras el nuevo se prueba, y no hay un día en
que Maritza se quede sin ninguno de los dos.

### Quién ve los costos

**El margen y los costos, solo Admin.** Es coherente con lo que la app ya hace:
al rol Vendedor se le ocultan los costos históricos en Compras. Las vendedoras
siguen viendo ventas y su propio desempeño.

Se hace en el servidor: las RPC de resultado y pérdidas devuelven error si quien
llama no es Admin. No se confía en esconder la tarjeta en el frontend.

---

## Las secciones

### 1 · El rango manda sobre todo

Atajos: **Hoy · Ayer · Esta semana · Este mes · Mes pasado · Este año · Últimos
30 · Últimos 90**, y **desde/hasta libre**.

Todo el panel obedece ese rango. Es la diferencia principal contra hoy.

**Comparación automática** contra el periodo anterior equivalente: mismo número
de días, inmediatamente antes. Cada cifra muestra su variación.

**Nota honesta:** solo hay datos desde el **1 de junio de 2026**. El filtro por
año va a funcionar, pero comparar contra el año anterior no va a mostrar nada
hasta 2027. Donde hay valor desde el primer día es en mes contra mes y en los
desgloses. La comparación se apaga sola —con su explicación— cuando el periodo
anterior cae fuera de los datos, en vez de pintar un −100% falso.

### 2 · La cascada del resultado

```
  Ventas netas          lo facturado, menos retenciones
− Costo de lo vendido   suma de cantidad × costo_unitario del detalle
= Margen bruto          y su % sobre ventas
− Gastos operativos     solo los egresos clasificados como gasto real
= Resultado
```

Cada renglón es clickeable y abre su composición.

**El margen bruto se puede calcular hoy mismo.** El Resultado necesita la
clasificación de gastos de la sección 6, y ahí hay una trampa: siempre va a
faltar algo por clasificar, así que un panel que espere a tenerlo todo no
mostraría nunca nada.

Se muestra el Resultado **calculado con lo que ya está clasificado**, y al lado
se declara lo que falta y hasta dónde podría moverse:

```
Resultado                                    $ 45.230.000
  Calculado sobre 427 de 465 egresos.
  Faltan 38 sin clasificar por $12.400.000:
  si todos fueran gasto, el resultado bajaría a $32.830.000.
  [ Clasificarlos ]
```

Así el número sirve desde el primer día, nadie lo confunde con una cifra
cerrada, y el aviso trae la acción que lo mejora. Cuando no falta nada, el aviso
desaparece solo.

Los servicios y la mano de obra de OT entran a ventas con costo cero. Eso infla
el margen porcentual y hay que decirlo en pantalla: se muestra el margen de
**productos** y el de **servicios** por separado, no uno solo revuelto.

### 3 · En qué se pierde

La sección que motivó el pedido. Cada renglón con su monto, su conteo y un
enlace al detalle hasta la venta individual:

- **Vendido bajo costo** — línea a línea, con el producto, quién lo vendió y
  cuánto se perdió. Es el que ya tiene $6,5M esperando.
- **Descuentos otorgados** — cuánto se regaló y quién lo autorizó.
- **Devoluciones y garantías con reembolso** — plata que salió de vuelta.
- **Retenciones** — lo que se fue a la DIAN y al municipio.
- **Faltantes de traspaso** — merma entre sedes.
- **OT diagnosticadas sin autorizar** — trabajo hecho que nadie compró.

### 4 · Cómo se compone la venta

Una sola tabla que cambia de dimensión con un selector, no seis widgets:

**por sede · por vendedora · por producto · por categoría · por tipo (mostrador
/ OT / cotización) · por método de pago · por cliente**

Cada fila muestra venta, costo, margen y % del total, ordenable por cualquiera.
Y **se ven los peores, no solo los mejores**: el top 10 al derecho y al revés.

Por cliente responde una pregunta que hoy nadie puede contestar: _¿cuánto de mi
negocio depende de un solo cliente?_

### 5 · Dónde está la plata parada

- **Cartera por antigüedad**: 0-30 / 31-60 / 61-90 / más de 90 días, con el
  detalle de quién y desde cuándo.
- **Cuentas por pagar** próximas.
- **Anticipos recibidos** sin facturar todavía.

### 6 · Categorías de gasto

Lo que hace posible el Resultado.

Una tabla `categorias_gasto` con un catálogo corto y editable —Nómina,
Arriendo, Servicios públicos, Transporte, Impuestos, Mantenimiento, Otros— y
dos categorías especiales que **no restan del resultado**:

- **Abono a proveedor** — paga mercancía ya contada en el costo.
- **Traslado** — mover plata entre cuentas.

`compras.categoria_gasto_id` guarda la clasificación, y la categoría lleva un
`afecta_resultado boolean` que decide si resta o no.

**Los 465 movimientos que ya existen** se clasifican desde una pantalla de
trabajo por lotes: se listan agrupados por concepto parecido, se marcan varios a
la vez y se les asigna categoría. No se adivina nada automáticamente: un
"PIDIO PLATA" solo lo puede clasificar quien sabe qué fue.

Al registrar un egreso nuevo, la categoría pasa a ser obligatoria.

### 7 · Inventario como capital

- Valor del inventario a costo, por sede.
- **Plata dormida**: cuánto vale lo que no se ha movido en 90 días.
- **Agotados de clase A**: lo que se está dejando de vender.

### 8 · Higiene

- **Refrescar de verdad**: spinner mientras carga y "actualizado hace X". Hoy no
  da ninguna señal y por eso parece roto.
- **Exportar a Excel** lo que se ve en pantalla, con el rango aplicado.
- **Recordar el rango** entre visitas.
- Cada sección carga sola: una que falle no tumba las demás.

---

# La parte visual

Un panel de decisiones falla de dos maneras. La primera es verse mal. La
segunda, mucho más común, es verse bien y obligar a adivinar: un número sin
contexto, un filtro que no se sabe si está aplicado, un gráfico que no dice
sobre qué periodo. El panel de hoy tiene el segundo problema.

## Las seis reglas

Estas mandan sobre cualquier decisión estética. Si una pantalla las cumple y se
ve sobria, está bien. Si se ve espectacular y rompe una, no.

**1 · Ningún número sin su procedencia.** Cada cifra dice de qué está hecha y de
qué periodo. No en un manual: en la pantalla, junto al número. "Ventas netas"
lleva debajo "1.204 facturas, sin retenciones ni anuladas". Si alguien tiene que
preguntar qué incluye una cifra, la cifra está mal presentada.

**2 · Nunca un hueco: el número con su nivel de confianza.** Cuando falta
información, se muestra lo que hay, se declara lo que falta y se ofrece la
acción para completarlo. Un guion vacío no informa; un número con su margen
declarado sí. Es la regla que salva el Resultado.

**3 · El rango siempre visible y en palabras.** La barra de rango es pegajosa y
dice en español qué está aplicado: "Del 1 al 30 de septiembre · comparando
contra agosto". Nunca hay que deducir el periodo del contexto.

**4 · Cargar por partes.** Cada sección carga y falla sola. Ver el resultado a
los 300 ms y la cartera a los 900 es mejor que ver todo en blanco 900 ms. Y una
sección caída no puede tumbar las demás.

**5 · Todo número grande es una puerta.** Si una cifra invita a preguntar "¿de
qué se compone?", se puede hacer clic y se responde. Sin excepciones: una cifra
que no se puede abrir es una cifra que genera desconfianza.

**6 · Sobrio antes que vistoso.** Color solo donde significa algo. Un gasto es
normal, no una alarma: va en gris. Lo rojo se reserva para lo que exige actuar.
Si todo grita, nada se oye.

## Con qué se construye

Ya está todo instalado, pero **sin usarse**: las primitivas de `components/ui/`
(sheet, skeleton, calendar, popover, tabs, table) tienen **cero uso real** en la
app — son andamiaje del port de Lovable. La app entera está hecha a mano con
tokens en línea.

La regla, entonces:

| Para                 | Qué se usa                                          | Por qué                                                                 |
| -------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| Gráficos             | **recharts** (ya en `package.json`)                 | Dibujar a mano una cascada con ejes y tooltips es trabajo desperdiciado |
| Calendario del rango | **react-day-picker** + **date-fns** (ya instalados) | Un selector de fechas correcto es más difícil de lo que parece          |
| Todo lo demás        | A mano con tokens, como el resto de la app          | Consistencia con las otras 40 pantallas pesa más que ahorrarse código   |

No se adoptan las primitivas shadcn para el resto: serían el primer uso en toda
la app y dejarían el panel visualmente aparte de todo lo demás.

### El bundle: hay que arreglarlo antes

El build hoy es **un solo archivo de 2.439 KB y no hay ningún `React.lazy`**.
Meter recharts ahí se lo cobra a todos: la vendedora que solo entra a facturar
descargaría los gráficos que nunca va a abrir.

Por eso **la ruta del panel se carga con `React.lazy`**, y recharts y
react-day-picker entran solo en ese trozo. Es un cambio pequeño que además abre
la puerta a hacerlo con las demás rutas pesadas después.

## La estructura de la pantalla

```
┌──────────────────────────────────────────────────────────────┐
│  Panel                                    ⟳ hace 2 min       │  ← encabezado
├──────────────────────────────────────────────────────────────┤
│  [Hoy][Ayer][Semana][Mes]•[Mes pasado][Año][30d][90d][📅]    │  ← pegajosa
│  Del 1 al 30 de septiembre · comparando contra agosto        │
│  Sede: [Todas ▾]                                             │
├──────────────────────────────────────────────────────────────┤
│  RESULTADO DEL PERIODO                                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Ventas netas          $ 145.000.000    ▲ 12% vs agosto │  │
│  │ − Costo de lo vendido  $  38.000.000                   │  │
│  │ ═ Margen bruto        $ 107.000.000    73,8%           │  │
│  │ − Gastos operativos   $  61.770.000                    │  │
│  │ ═ RESULTADO           $  45.230.000    ▲  8%           │  │
│  │   ⚠ 38 egresos sin clasificar por $12.400.000.         │  │
│  │     Si todos fueran gasto, bajaría a $32.830.000.      │  │
│  │     [ Clasificarlos ]                                  │  │
│  └────────────────────────────────────────────────────────┘  │
│         [ gráfico de cascada, mismas cifras ]                │
├──────────────────────────────────────────────────────────────┤
│  EN QUÉ SE PIERDE                              $ 8.329.376   │
│  ● Vendido bajo costo      $ 6.535.825   103 líneas      ›   │
│  ● Descuentos otorgados    $ 1.522.551    47 ventas      ›   │
│  ● Garantías reembolsadas  $   271.000     3 casos       ›   │
├──────────────────────────────────────────────────────────────┤
│  CÓMO SE COMPONE LA VENTA                                    │
│  [Sede][Vendedora][Producto][Categoría][Tipo][Pago][Cliente] │
│  ┌─ tabla ordenable: venta · costo · margen · % ──────────┐  │
├──────────────────────────────────────────────────────────────┤
│  CARTERA        │  INVENTARIO                                │
└──────────────────────────────────────────────────────────────┘
```

## Los componentes, uno por uno

### La barra de rango

Lo más importante de la pantalla, porque gobierna todo lo demás.

- Chips de atajo, el activo con fondo primario. Alto **48 px**: se usa con
  guantes y en tablet.
- El chip **📅 Personalizado** abre un calendario de dos meses donde se pincha
  inicio y fin. Al elegir, el chip pasa a mostrar el rango.
- **Debajo, siempre, la frase en español**: "Del 1 al 30 de septiembre ·
  comparando contra agosto". Es la que elimina el adivinar.
- Cuando el periodo de comparación cae fuera de los datos (antes del 1 de junio
  de 2026), la frase lo dice —"sin datos para comparar: la app arrancó en
  junio"— y las flechas de variación no se pintan.
- **Se pega arriba al bajar** (`position: sticky`), porque al mirar la cartera
  uno ya no recuerda qué rango puso.
- El rango elegido se guarda en `localStorage` y vuelve en la siguiente visita.
- En móvil los chips hacen scroll horizontal; no se apilan en tres filas.

### El botón de refrescar

El de hoy parece roto porque no dice nada. El nuevo:

- Muestra **"hace 2 min"** al lado, calculado del último cargue.
- Al pulsarlo, el ícono gira mientras carga.
- Al terminar, el texto vuelve a "hace unos segundos". El cambio visible es lo
  que confirma que sirvió.
- Se deshabilita mientras carga, para que no se acumulen peticiones.
- El auto-refresco de 60 s se elimina: en un panel de análisis con rango
  histórico no tiene sentido, y es lo que hacía que el botón pareciera inútil.

### La cascada del resultado

Dos representaciones de las mismas cifras, no dos datos distintos:

**La lista**, que es la que manda. Cada renglón con su etiqueta en palabras, el
monto alineado a la derecha en tabular, y debajo en letra pequeña de qué está
hecho. Los renglones de resultado (Margen, Resultado) van en negrita con una
regla arriba, como un recibo.

**El gráfico de cascada** (recharts, `BarChart` con barras flotantes) debajo: se
ve de un vistazo qué se comió el margen. En móvil se oculta y queda solo la
lista, que es la que se lee bien en pantalla angosta.

El color: ingresos en `--success`, restas en `--muted-foreground`, el resultado
en `--foreground` si es positivo y `--destructive` si es negativo. Los gastos
**no van en rojo**: son normales.

El aviso de egresos sin clasificar va en `--warning`, con el botón que lleva
directo a la pantalla de clasificar filtrada por el mismo rango.

### La sección de pérdidas

Una lista, no tarjetas: se comparan mejor magnitudes en una columna.

Cada renglón: punto de color, nombre en palabras, monto, conteo, y un chevron
que dice que se abre. Ordenados de mayor a menor, porque lo que más duele va
primero.

Al hacer clic se abre el **panel lateral de detalle**.

### El panel lateral de detalle

El corazón de "poder desagregar". Se abre desde cualquier cifra.

- **En desktop**: se desliza desde la derecha, ocupa 480 px y deja ver el panel
  detrás. No es un modal que tape todo: mantener el contexto es la mitad del
  valor.
- **En móvil**: hoja de abajo hacia arriba, a pantalla casi completa.
- Encabezado con el título, el rango aplicado y el total.
- Tabla con las filas reales. **Cada fila lleva a su documento**: la venta, la
  OT, la garantía.
- Botón de exportar lo que se ve.
- Se cierra con la X, con Escape y tocando fuera.

### La tabla de composición

Un solo componente con un selector de dimensión arriba, no siete widgets.

- Columnas: la dimensión, venta, costo, margen, % de margen, participación.
- **Ordenable por cualquier columna**, con la flecha visible en la activa.
- Una **barra de participación** dentro de la celda del porcentaje: se compara
  visualmente sin leer los números.
- El pie fija el total, para poder verificar que las partes suman.
- **Un interruptor "ver los peores"** que invierte el orden. Los diez que menos
  margen dejan suelen ser más accionables que los diez que más venden.
- En móvil se vuelve lista de tarjetas, como manda el sistema de diseño.
- Las columnas de costo y margen **no existen** si quien mira no es Admin: no se
  ocultan con CSS, no se piden al servidor.

## Los cuatro estados de cada sección

Aquí es donde un panel se siente terminado o a medio hacer. Los cuatro se
diseñan; ninguno es un descuido.

**Cargando** — esqueleto con la forma del contenido que viene (barras grises del
alto de las filas), no un spinner centrado. El salto de layout es lo que hace
sentir lenta una pantalla que no lo es.

**Vacío** — nunca una tarjeta en blanco. Dice qué pasó y qué hacer: "No hubo
ventas entre el 1 y el 5 de septiembre. Prueba un rango más amplio." Si el vacío
es una buena noticia, se dice así: "Ningún producto se vendió bajo costo en este
periodo." — eso es una respuesta, no un hueco.

**Error** — dentro de la sección, no en toda la página. Dice qué falló y ofrece
reintentar solo esa parte. El resto del panel sigue en pie.

**Sin permiso** — a un Vendedor las secciones de costo no le salen vacías ni le
dan error: no se pintan, y una nota discreta explica que el margen es
información de administración. Un error de permisos parece una falla; una
explicación no.

## Detalles que se notan

**Cifras** — `tabular-nums` en todo lo numérico para que las columnas alineen.
Formato COP sin decimales, como el resto de la app. En pantallas angostas los
montos grandes se abrevian a `$145,0 M` con el valor exacto en el tooltip.

**Variaciones** — flecha, porcentaje y contra qué: "▲ 12% vs agosto". Nunca un
porcentaje suelto. Verde si conviene, rojo si no — ojo con la dirección: **que
suban los gastos no es verde**.

**Tipografía** — IBM Plex Sans, la de la app. Los montos grandes a 22-28 px con
`tracking` ajustado; las etiquetas a 12 px en mayúsculas con
`--muted-foreground`. Jerarquía por tamaño y peso, no por color.

**Movimiento** — solo el que informa: las barras crecen al aparecer, el panel
lateral se desliza. Nada rebota ni parpadea. Y se respeta
`prefers-reduced-motion`.

**Accesibilidad** — 48 px de alto en todo lo que se toca, contraste AA con los
tokens, foco visible al tabular, y el panel lateral atrapa el foco y lo devuelve
al cerrarse. Las tablas con `<th scope>` de verdad.

**Modo oscuro** — sale gratis usando tokens, pero las series de recharts se
pasan por `hsl(var(--token))`, nunca hex. Es la Regla #1 del sistema de diseño y
es justo donde una librería de gráficos tienta a romperla.

**Impresión** — `@media print` que quita la barra pegajosa y despliega los
paneles laterales abiertos. Que Maritza pueda imprimir el panel de un mes es
gratis si se piensa ahora y caro si se piensa después.

## Cómo se verifica que la parte visual sirve

No con capturas bonitas: con las mismas pruebas de humo que ya se usan en el
proyecto, más una revisión de las que solo hace un humano.

- **Render** de cada pantalla nueva con `renderToStaticMarkup`, en los cuatro
  estados y con los dos roles. Ni el build ni eslint ejecutan un componente, y
  aquí ya se demostró dos veces que un error de render pasa ambos.
- **Sin colores fijos**: una prueba que recorra los archivos del panel buscando
  `#` en `style` y `className="bg-`, y falle si aparece alguno.
- **Anchos reales**: revisar a 360 px (celular), 768 px (tablet) y escritorio.
  Es lo que atrapó el desbordamiento de la tirilla POS.
- **Con datos de verdad**: abrir el panel con el rango de 90 días de producción,
  no con datos inventados. Los nombres largos y los montos de ocho cifras son
  los que rompen los diseños.

---

## Lo que queda fuera, a propósito

**Presupuestos y metas.** Comparar contra un objetivo exige capturar ese
objetivo, y es otra funcionalidad.

**Proyecciones.** Con 4 meses de datos, cualquier pronóstico sería inventado.

**Comisiones.** El panel muestra el desempeño por vendedora; calcular y liquidar
comisiones es otro tema, con reglas que nadie ha definido.

**Estado de resultados contable.** Esto es un panel de gestión, no contabilidad
formal: no maneja depreciación, causación ni cierres contables.

---

## Riesgos

**Que el Resultado mienta.** El riesgo principal, y el motivo de la sección 6.
Se atiende mostrando siempre el número **con su margen de error declarado**:
cuántos egresos faltan por clasificar, por cuánta plata, y a cuánto bajaría el
resultado si todos resultaran ser gasto. Lo que no se hace nunca es presentar
como cerrada una cifra que no lo está.

**Que el margen engañe por los servicios.** Con costo cero inflan el porcentaje.
Se separa productos de servicios en pantalla.

**Rendimiento.** Un rango de un año cruzando `detalle_venta` con `ventas` puede
pesar. Se mide con `EXPLAIN ANALYZE` sobre el rango más grande posible antes de
dar por buena cada RPC, y se indexa lo que haga falta.

**Que las cifras del panel no cuadren con el cierre.** Son preguntas distintas
—el cierre mide caja, el panel mide negocio— y eso hay que decirlo en la
pantalla, no dejar que alguien lo descubra restando. Cada cifra lleva de dónde
sale.

## Verificación

Cada RPC se prueba contra producción dentro de una transacción revertida, con el
JWT simulado y `set local role authenticated` para que la RLS esté activa.

El invariante que manda: **las cifras del panel para un día tienen que poder
reconciliarse con lo que ya muestra el cierre de ese día**, y donde no coincidan
tiene que haber una razón explicable y escrita.

Y prueba de humo de render para cada pantalla nueva: ni el build ni eslint
ejecutan un componente, y en este proyecto ya se demostró dos veces que un error
de render pasa las dos verificaciones.
