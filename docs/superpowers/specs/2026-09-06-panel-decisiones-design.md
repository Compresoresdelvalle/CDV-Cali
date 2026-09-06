# Panel de decisiones — rediseño del Dashboard

**Fecha:** 2026-09-06
**Origen:** "hoy en día solo es bonito más que funcional real" — se pide un panel
que permita tomar decisiones, con rangos de fecha reales y desagregación
**Estado:** diseño, pendiente de aprobación

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

Por eso **no se puede calcular un Resultado hoy**: `ventas − costo − caja_menor`
daría un número más bajo que la realidad, y un resultado falso es peor que no
tener resultado. Además, con el concepto en texto libre no hay forma de agrupar:
"NOMIN" y "NOMINA" no se juntan solos.

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
clasificación de gastos de la sección 6; hasta que esté, ese renglón se muestra
como "pendiente de clasificar" con el número de movimientos sin categoría, en
vez de dar una cifra que no es.

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
Mientras haya egresos sin clasificar, el renglón no muestra una cifra: muestra
cuántos faltan. Un número incompleto presentado como completo es peor que un
hueco visible.

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
