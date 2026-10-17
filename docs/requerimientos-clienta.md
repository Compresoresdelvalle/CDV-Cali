# Requerimientos de la clienta

Bitácora de lo que la clienta pide o reporta por WhatsApp. **Aquí solo se apunta.**
Que esté anotado no quiere decir que tenga razón ni que se vaya a hacer: cada punto
se evalúa después.

**Estados:** `por evaluar` · `aceptado` · `descartado` · `hecho`

---

# Mapa general

Todo lo que hay en este documento, agrupado por tema. **R** = pedidos por WhatsApp
(Parte 1), **W** = documento Word (Parte 2), **H** = hallazgos que nadie pidió pero
aparecieron al revisar. El detalle y las cifras de cada uno están más abajo.

## Por tema

| Tema                                     | Qué incluye    | Qué está pasando                                                                                                                                                                                                                                                          |
| ---------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Trazabilidad de insumos**           | R1, W1, W6     | Ninguna de las 1.981 conversiones a insumo guarda para qué fue. La campanita y la Auditoría no dicen el destino, y la Auditoría muestra códigos internos en vez de "OT #285". Tampoco muestra valores en pesos. Es el pedido que más se repite.                           |
| **2. Pagos a proveedores y gastos**      | R4, R6, H1     | Se están pagando facturas viejas y anticipos por caja menor. El camino correcto (compra a crédito sin recibir + abono) existe, pero el pago no acepta la fecha real, Cuentas por Pagar no dice si la mercancía llegó, y no hay forma de registrar un **gasto a crédito**. |
| **3. Retenciones visibles**              | W8             | El cálculo está bien, pero el detalle de la venta, el historial y los cierres nunca la muestran, y no hay informe del mes.                                                                                                                                                |
| **4. Impresiones**                       | R5, W3         | La caja menor imprime la app entera. La cotización no imprime las notas adicionales.                                                                                                                                                                                      |
| **5. Celular y comodidad**               | R3, H2, H3, H4 | En la ficha del producto el botón de mínimo/máximo queda escondido. Varios botones y campos miden menos de 48 px. El modal de pago se desborda. El monto de caja menor no tiene separador de miles.                                                                       |
| **6. Órdenes de trabajo**                | R2, W5, H5     | 102 OT abiertas, 36 con más de 60 días. No se puede ver qué OT se pagaron en un día. Dos alertas de OT están muertas.                                                                                                                                                     |
| **7. Cierres**                           | W2             | Las vendedoras no pueden escoger un día.                                                                                                                                                                                                                                  |
| **8. Ya existe: solo hay que enseñarlo** | W4, W7, R3, R6 | Anular un cambio (desde la venta), descuento antes del IVA (ya está bien), mínimo 0 por sede (desde Inventario → Mínimos), abono a proveedor (compra a crédito sin recibir).                                                                                              |

## Lo que salió de paso (H)

| #   | Hallazgo                                                                                                                                                  | Dónde está el detalle            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| H1  | Abonos a proveedores pagados por caja menor; dos chicos (RUBIELA $ 291.400 y CRISTIAN $ 100.000) quedaron como _Otros gastos_ e inflan el Panel           | "Lo que salió de paso" (Parte 1) |
| H2  | Botones y campos de caja menor de 38 a 40 px; "Configurar" en la ficha de 16 px                                                                           | R3, R4                           |
| H3  | El modal de Registrar pago se desborda en el celular                                                                                                      | R6                               |
| H4  | En Mínimos, en el celular, falta el texto "No alerta"                                                                                                     | R3                               |
| H5  | Las alertas "OT > 30 días sin recoger" y "OT esperando repuesto" buscan estados que nunca se usan y siempre marcan 0; hay 6 OT listas hace más de 30 días | "Lo que salió de paso" (Parte 1) |
| H6  | La caja menor de un flete muestra "Devolver por garantía" y "Mercancía recibida en bodega"                                                                | R5                               |
| H7  | En Auditoría, las conversiones y las salidas por garantía aparecen como "Módulo: Sistema"                                                                 | R1                               |
| H8  | La compra #1170 (360 llaves de bola) se dio por recibida sin conteo                                                                                       | R6                               |

## Preguntas para hacerle a ella

1. **¿Llegaron las 360 llaves de bola de Jorge Diaz el 5 de octubre?** Si no, están
   en el inventario sin estar en la bodega. (R6)
2. **Venta #1483 a FURGONES Y CARROCERIAS RED METAL:** le quedan $ 35.000 por cobrar.
   ¿Es un pago pendiente o una retención que no se registró? (W8)
3. **¿Su duda del descuento en compras vino de una factura con descuento por
   producto o en porcentaje?** La app solo acepta un descuento total en pesos. (W7)
4. **Las OT abiertas de junio, incluidas las de $ 1.000 de prueba:** ¿se cierran, se
   cancelan o se completan con su valor real? (R2)
5. **Los abonos de RUBIELA y CRISTIAN:** ¿son pagos a proveedor o gastos de verdad?
   (H1)
6. **¿Quiere distinguir "no se vende en esta sede" de "nunca se configuró"?** Hoy las
   dos cosas son mínimo 0. (R3)

---

# Parte 1. Pedidos por WhatsApp

## Resumen

| #   | Fecha           | Qué pide, en corto                                                   | ¿Tiene razón?                                                                                                    | Qué hacer                                         |
| --- | --------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| R1  | 1 oct           | Que la conversión a insumo diga para qué OT, ensamble o préstamo fue | **Sí.** 1.981 conversiones, ninguna dice a qué fue; el 95% se puede amarrar                                      | Arreglo en la app                                 |
| R2  | (David)         | Desaparecer 7 OT en $0 que sí se cobraron                            | **Sí**, y ya no pasa desde julio. Fueron 10, no 7                                                                | Decidir cómo limpiarlas; **no cancelarlas**       |
| R3  | 9 sep           | Desde el celular no salen mínimo, máximo ni stock                    | **En lo que vivió, sí.** La función existe, pero en el celular el botón "Configurar" de la ficha queda escondido | Arreglar la tabla "Stock por sede" en celular     |
| R4  | antes del 2 oct | Caja menor con Mixto y Crédito                                       | **Mixto no hace falta. Crédito sí**, pero el hueco es otro                                                       | "Gasto a crédito" en Cuentas por Pagar            |
| R5  | 2 oct           | Imprimir la caja menor en POS o media hoja                           | **Sí.** Hoy imprime la pantalla entera                                                                           | Copiar el formato de traslados                    |
| R6  | 3 oct           | Abonar a un proveedor antes de recibir la mercancía                  | **Necesidad real, pero la función ya existía.** Se resolvió el 5 oct con 2 días de desfase                       | Enseñarle el camino; preguntar por las 360 llaves |

## Lo que salió de paso al revisar

Cosas que no pidió, pero que aparecieron mirando los datos.

- **La caja menor se está usando para pagar facturas viejas de proveedores.** Solo
  en octubre: FULLER $14.715.622 por una factura de mayo, SURTIDOR FERR $6.000.000 de
  una de abril, y abonos más chicos. Las dos grandes están bien clasificadas como
  _Abono a proveedor_, que no cuenta como gasto en el Panel. Pero **RUBIELA RSTRPO
  "abono a factura" ($291.400) y CRISTIAN G "abono polisombra" ($100.000) quedaron en
  _Otros gastos_**, que sí cuenta, así que inflan los gastos del mes. Hay que
  revisarlos con ella.
- **La compra #1170 se dio por recibida sin conteo**, en el mismo segundo en que se
  creó. Ver R6.
- **Dos alertas de OT están muertas.** "OT > 30 días sin recoger" busca órdenes en
  estado _completada_, y "OT esperando repuesto" en estado _esperando_repuesto_.
  **Ninguna OT ha tenido nunca esos estados**: el flujo nuevo de OT usa _terminada_ y
  _pendiente_recogida_. Las dos alertas marcan 0 siempre, cuando hoy hay **6 OT listas
  para recoger hace más de 30 días** (dos de ellas, la 11 y la 14, desde junio).
- **Varias pantallas no cumplen los 48 px** en el celular: botones de pago de caja menor
  (40 px), campos de caja menor (38 px) y el enlace "Configurar" de la ficha del
  producto (16 px).
- **El modal de Registrar pago se desborda** en el celular (ver R6).
- **El pago con tarjeta nunca se ha usado en caja menor.**
- De paso se ve que **la retención en compras ya se está usando**: las compras a
  Fullerton SAS del 10 y 16 de octubre tienen saldo menor que el total.

---

## R1. La conversión a insumo no dice para qué fue

**Fecha:** el movimiento es del 1 de octubre; el mensaje llegó después.
**Origen:** pantallazo de Panel Admin → Auditoría, en celular.

**Lo que dijo:**

> "Buena tarde David, ¿esto podría ser más detallado, que dijera para qué orden,
> ensamble o préstamo va?"

**Lo que se ve en el pantallazo:** dos movimientos de tipo _conversion a insumo_ de
Sofía (Vendedor) en Almacén L3, el 1/10/26 a las 10:18 a. m.: _AUTOMATICO 1 VIA
BOTON_ (A1VB, stock 6 → 5) y _SOPORTE COMPACTO_ (SCCP, stock 1 → 0). En
observaciones solo dice _"Convertidas 1 uds de venta a insumo"_, y el origen dice
_conversion_.

**Lo que pide:** que el movimiento de conversión diga **a qué documento se destinó**
el insumo: la orden de trabajo, el ensamble o el préstamo de herramienta, con su
número.

**Cómo está hoy en la app** (revisado en el código, sin evaluar):

- La conversión se hace con `fn_convertir_a_insumo`, que solo recibe producto, sede
  y cantidad. **No tiene dónde guardar a qué documento va**, así que la observación
  siempre sale genérica.
- Se convierte desde cuatro pantallas: crear ensamble, detalle del ensamble, detalle
  de la OT y ficha del producto. En las tres primeras la app **sí sabe** para qué
  documento es en ese momento; en la ficha del producto no hay documento.
- Si no la hace el Admin, al Admin le llega un aviso agrupado por día y sede.

**Veredicto: tiene razón.** (verificado contra la base el 17 oct)

- De **1.981 conversiones a insumo** desde junio, **ninguna** guarda a qué documento
  fue. Todas dicen solo "Convertidas N uds de venta a insumo".
- En su caso concreto, las dos conversiones de Sofía (A1VB a las 10:18:43 y SCCP a
  las 10:18:46) fueron seguidas **en el mismo segundo** por un consumo de una orden
  de trabajo. La app sabía para qué era y no lo guardó.
- Mirando qué pasó justo después de cada conversión: unas **1.081 terminaron en una
  OT**, unas **762 en un ensamble**, **19 en un préstamo de herramienta** y solo
  **82 no llevaron a nada** (conversiones hechas por adelantado). O sea que el 95% se
  puede amarrar a su documento.
- Lo que pide es razonable y tiene arreglo: que la pantalla que convierte mande el
  número del documento, y que la Auditoría lo muestre. Para lo histórico, se podría
  inferir por el movimiento del mismo segundo.

**Verificado en pantalla (17 oct, celular de 390 px).** El problema es más grande
que la conversión:

- En la bitácora de Auditoría, la conversión sale con **"Módulo: Sistema"**: los tipos
  _conversión a insumo_, _conversión a venta_ y _garantía salida_ no están en la lista
  de módulos, así que caen en "Sistema".
- **Incluso los movimientos que sí guardan su documento son ilegibles.** Un consumo de
  OT muestra _"Origen: orden_servicio · a4c38452"_: los primeros 8 caracteres de un
  código interno, no _"OT #285"_, y no se puede tocar para ir a la orden.

**Pensando en ella:** no basta con guardar la referencia en la conversión. La
bitácora tiene que decir _"OT #285 · Cliente X"_ o _"Ensamble #40"_ en palabras, y
dejar tocarlo para abrir el documento. Si no, aunque se arregle por dentro, en
pantalla va a seguir viendo un código.

**Estado:** evaluado: tiene razón.

---

## R2. Siete OT en $0 que sí se cobraron

**Origen:** un mensaje de David (no de la clienta) con esta tabla:

| OT  | Sede | Cliente            | Registrado | Cobrado   |
| --- | ---- | ------------------ | ---------- | --------- |
| 38  | CV   | SERVIAUTOMATICOS   | $ 0        | $ 800.000 |
| 43  | L3   | DANILO SANTARRIAGA | $ 2.000    | $ 400.000 |
| 82  | CV   | HUGO RODRIGUEZ     | $ 0        | $ 380.800 |
| 23  | CV   | CONSUMIDOR FINAL   | $ 0        | $ 297.500 |
| 34  | CV   | CONSUMIDOR FINAL   | $ 200      | $ 297.500 |
| 39  | L3   | JORGE E. GALEANO   | $ 0        | $ 288.000 |
| 32  | CV   | JORGE E. PACHONGO  | $ 0        | $ 100.000 |

El mensaje explica: _"le cobraron al cliente pero nunca registraron cuánto valía el
trabajo. La orden quedó en $0 y la caja sí recibió el pago. La caja está bien: ese
dinero entró como abono y el cierre lo cuenta como servicios. El problema es que no
hay venta que lo respalde, así que no se sabe qué se ganó en cada trabajo."_

**Lo que pide David:** que este mensaje anule esas OT y que **desaparezcan para que
no hagan ruido.**

**Antes de tocarlas hay que tener en cuenta** (anotado para la evaluación, no
hecho):

- El cierre solo cuenta los abonos de OT que **no están canceladas**. Si se
  cancelan, sus $ 2.563.800 de abonos dejarían de aparecer en los cierres de esos
  días, y los cierres ya guardados quedarían distintos a lo que se recalcule.
- La app hoy no deja cancelar una OT que tiene abonos (`fn_cancelar_orden` lo
  bloquea), así que "desaparecerlas" no sale de un botón.
- Hay que decidir si "desaparecer" es cancelarlas, ocultarlas de los reportes de
  margen, o completarles el valor real del trabajo.

**Veredicto: el mensaje de David es correcto, y el problema ya no ocurre.**
(verificado contra la base el 17 oct)

- Las 7 OT existen tal cual: totales en $0 o casi ($2.000 y $200, que parecen valores
  de prueba) y **$2.563.800 en abonos**. Todas son del **10 al 25 de junio**, las
  primeras semanas de uso de la app.
- **Desde julio no ha vuelto a pasar.** De 347 OT entre julio y octubre, ninguna
  quedó con un total menor a lo cobrado. En junio fueron **10**, no 7: hay 3 más que
  no estaban en la lista.
- Estado de las 7: cuatro entregadas, y **tres siguen abiertas desde junio** (23
  abierta, 39 y 32 en proceso). Esas tres ensucian el tablero de OT.
- "La caja está bien" es cierto: los abonos entraron y el cierre los cuenta como
  servicios mientras las OT no estén canceladas.
- **Cancelarlas no es la forma de desaparecerlas.** Sacaría $2.563.800 de los
  cierres de junio, y la app no deja cancelar una OT con abonos. Lo que tiene sentido
  es cerrar las tres abiertas y, si se quiere el margen bien, registrarles el valor
  real del trabajo. Hay que decidirlo.

**Verificado en pantalla y en la base (17 oct).** El ruido es mucho más que esas 7:

- El tablero de OT tiene **102 órdenes abiertas, y 36 llevan más de 60 días**.
  Varias son del 1 de junio, con valores de $1.000, que parecen pruebas de la puesta
  en marcha (OT 1, 2, 3, 4, 5).
- En la vista de lista no se notan porque van de la más nueva a la más vieja; en la
  vista de columnas sí se acumulan en los estados activos.

**Pensando en ella:** una limpieza de una sola vez de las OT de prueba y de las
abandonadas de junio, revisándolas con ella, quita más ruido que tocar solo estas 7.

**Estado:** evaluado: correcto, es limpieza de junio.

---

## R3. Crear un producto desde el celular: no salen mínimo, máximo ni stock

**Fecha:** 9 de septiembre.
**Origen:** dos notas de voz.

**Lo que dijo:**

> "Acabé de crear un producto, lo creé desde aquí, desde mi celular, pero no me salió
> el stock mínimo ni el stock máximo. Me preocupa porque quedó creado pero quedó sin
> stock. ¿Ese stock solamente se le puede adicionar desde el computador o no?"

> "Ando en la calle y uno de los muchachos me pidió que le creara un ítem, entonces
> lo hice desde el celular, pero desde el celular no me aparece esa opción, no me
> aparece el mínimo. Cuando estoy creando el producto no me aparece ese tipo de
> información. Tendría que llegar a la casa, entrar al computador y mirar de qué
> manera me aparece ahí."

David le respondió _"Desde min y max"_ y que a él también le generaba duda.

**Lo que pide:**

1. Poder poner **stock mínimo y máximo** al crear un producto desde el celular.
2. Poder **darle stock inicial** a un producto recién creado desde el celular.
3. Saber si hay algo que solo se puede hacer desde el computador.

**Cómo está hoy en la app** (revisado en el código, sin evaluar):

- **No es un problema del celular.** El formulario de crear producto es el mismo en
  celular y computador, y en ninguno pide mínimo ni máximo. Se quitó a propósito:
  ahora el mínimo y el máximo son **por sede**, porque una sede puede no manejar algo
  que otra vende a diario. En su lugar el formulario dice _"Se configuran por sede, en
  la ficha del producto o en Mínimos."_
- El formulario **tampoco pide stock inicial**. Un producto nuevo nace con cero en
  todas las sedes; el stock entra por una compra, un traspaso o un ajuste de conteo.
- O sea que lo que vio es el comportamiento esperado, pero **el mensaje no se lo
  explicó**: ella entendió que en el celular faltaba algo.

**Primer veredicto, solo por código (CORREGIDO más abajo):** "en parte no; sí se
puede desde el celular". La revisión en pantalla mostró que en el celular el botón
"Configurar" de la ficha **queda escondido**. Lo de este párrafo sobre la ficha no
vale; ver _"Verificado en pantalla"_ y la _"Conclusión revisada"_.

- **No es cosa del celular.** El formulario de crear producto es el mismo en celular
  y en computador, y en ninguno pide mínimo ni máximo. Se quitaron de ahí a
  propósito, porque ahora son por sede.
- **El mínimo y el máximo sí se ponen desde el celular**: en la ficha del producto,
  en la tabla de existencias, cada sede tiene su botón. La pantalla de la ficha no
  esconde nada en celular. Además verifiqué que todo producto nuevo nace con su fila
  en las 4 sedes, así que el botón siempre aparece. También está la pantalla
  **Inventario → Mínimos**.
- **El stock no se escribe a mano, ni en el computador.** Un producto nuevo arranca
  en cero y el stock entra por una compra, un traslado o un ajuste de conteo. Eso es
  a propósito, para que todo movimiento tenga su respaldo. (Verificado: el conteo lo
  registra Admin o Bodega, pero **solo Admin lo aplica**; el traslado exige stock en
  la sede de origen.)
- Lo que sí es cierto: el formulario solo dice, en letra chica, _"Se configuran por
  sede, en la ficha del producto o en Mínimos"_, y ella no lo vio. Una mejora barata
  sería que al guardar un producto nuevo la app la lleve a la ficha y le muestre
  dónde poner el mínimo y cómo meterle stock.

**Aclaración (17 oct): para qué quería el mínimo.** Lo buscaba para que un
producto **no diera alarma de stock bajo en una sede donde no se vende.** Eso **sí
se puede hacer hoy**:

- Se pone **mínimo 0** para ese producto en esa sede. Con mínimo 0 el producto sale
  de la página de Alertas, del Dashboard, de las sugerencias de la campana de
  reposición, de Reorden y del filtro "En alerta" de Mínimos. Todas esas pantallas
  exigen mínimo mayor que 0.
- **Dónde:** _Inventario → Mínimos_ tiene buscador por referencia o nombre, selector
  de sede (el Admin elige; vendedoras y bodega ven solo la suya), filtros _Todos /
  Sin configurar / Configurados / En alerta_ y filtro por clase A, B o C. También se
  puede desde la ficha del producto, en la fila de cada sede.
- **Lo que sigue apareciendo aunque el mínimo sea 0:**
  - En _Inventario_, el producto dice **"Agotado"** si tiene 0. Eso es un dato, no
    una alarma; el estado se calcula así a propósito.
  - En la campana de reposición, la parte de **faltantes con demanda** no mira el
    mínimo: muestra productos en 0 que **se vendieron en esa sede en los últimos 90
    días**. Si de verdad no se vende ahí, no aparece; si se vendió aunque sea una vez,
    sí.
- **Una ambigüedad:** mínimo 0 quiere decir tanto "aquí no se vende" como "nunca se
  configuró". Hoy hay unas **4.100 filas con mínimo 0** (cerca del 70%), y el filtro
  "Sin configurar" las junta todas. No hay forma de distinguir las que ella decidió
  de las que nadie ha tocado.

**Verificado en pantalla (17 oct, como Admin, en tamaño celular de 390 px).** El
código decía que se podía; la pantalla muestra que en el celular **está escondido**:

| Dónde                                | En el celular                                                                                                                                                                                                                                                                                                          | Resultado                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Inventario                           | Botón **"Mínimos"** arriba, junto a "Nuevo producto"                                                                                                                                                                                                                                                                   | Bien                                                |
| Mínimos                              | Selector de sede, buscador, filtros, A/B/C, y un aviso: _"Mínimo 0 = esta sede no maneja el producto: no genera alerta ni aunque quede en cero"_. Cada producto es una tarjeta con sus casillas de mínimo y máximo                                                                                                     | Bien                                                |
| Mínimos, producto con mínimo 0       | Sale **"Agotado" en rojo**. En escritorio dice además _"No alerta"_; **en el celular ese texto no existe**, y el subtítulo sale cortado: _"0 uds · nunca ha…"_                                                                                                                                                         | Confunde                                            |
| **Ficha del producto**               | La tabla "Stock por sede" es más ancha que la pantalla. Al abrirla se ve la sede y el "Agotado" cortado, **pero no el botón "Configurar"**, que queda escondido a la derecha. Si se desliza para verlo, **desaparece el nombre de la sede**. Y "Configurar" es un texto de 16 px de alto (la regla de la app es 48 px) | **Falla**                                           |
| Crear producto                       | El aviso está: _"Se configuran por sede, en la ficha del producto o en Mínimos"_, en gris y letra de 12 px                                                                                                                                                                                                             | Discreto                                            |
| Después de crear                     | La app la lleva **directo a la ficha**, justo donde el botón queda escondido                                                                                                                                                                                                                                           | **Por eso no lo encontró**                          |
| Alertas                              | Contador de stock bajo/agotado: **823**, igual a la base con la regla del mínimo. Sin la regla serían **3.402**                                                                                                                                                                                                        | Bien: mínimo 0 sí apaga la alarma                   |
| Campana, pestaña "Reponer (824)"     | Respeta el mínimo 0                                                                                                                                                                                                                                                                                                    | Bien                                                |
| Campana, pestaña "Se vende y no hay" | **No mira el mínimo.** De 327 productos ahí, **100 tienen mínimo 0** en esa sede, y 90 de esos con **una sola venta** en 90 días                                                                                                                                                                                       | Sigue avisando aunque ella diga que ahí no se vende |

**Conclusión revisada para R3:** su queja **es válida en el celular**. No es que la
función no exista, es que en la pantalla adonde la app la manda después de crear el
producto, el botón no se ve.

**Estado:** evaluado: la función existe, pero en el celular el botón de la ficha está escondido. Tiene razón en lo que vivió.

---

## R4. Caja menor con pago Mixto y Crédito

**Fecha:** antes del 2 de octubre.
**Origen:** pantallazo del formulario de caja menor (monto $ 647.185, categoría
Nómina, pagado en Efectivo).

**Lo que dijo:**

> "En caja menor dejar el pago mixto y crédito."

**Lo que se ve:** en _¿Cómo se pagó?_ hoy solo están **Efectivo**, **Transferencia**
y **Tarjeta**.

**Lo que pide:** agregar **Mixto** (parte en una forma, parte en otra) y **Crédito**
(se queda debiendo) a la caja menor.

**Cómo está hoy en la app** (revisado en el código, sin evaluar):

- La pantalla de caja menor muestra Efectivo, Transferencia y Tarjeta.
- La base de datos también **rechaza** cualquier otro método en caja menor
  (`fn_registrar_caja_menor`: _"Método de pago inválido para caja menor"_). No es solo
  un botón que falte.
- La compra normal (no caja menor) sí acepta Crédito, y cuando es a crédito queda en
  Cuentas por Pagar.

**Veredicto: Mixto casi no hace falta; Crédito apunta a un hueco real, pero no
dentro de caja menor.** (verificado contra la base el 17 oct)

- Cómo se paga hoy la caja menor: **691 en efectivo** ($214,8 millones) y **37 por
  transferencia** ($62,9 millones). **Tarjeta nunca se ha usado.**
- **Mixto**: un gasto pagado parte en efectivo y parte por transferencia se puede
  registrar hoy como dos cajas menores. Es poco frecuente y no justifica cambiar el
  cierre.
- **Crédito**: caja menor por definición es plata que sale ya; un gasto a crédito es
  una deuda. Pero el hueco que hay detrás es real: **hoy no hay forma de registrar
  una deuda por un gasto que no es mercancía.** La compra a crédito exige al menos un
  producto. Ejemplo en los datos: la caja menor #1151, arreglo de la camioneta gris
  por $3.939.000, de una factura del 21 de septiembre que se pagó el 2 de octubre.
  Esa deuda no existió en la app durante esos 11 días.
- La salida correcta sería "gasto a crédito" en Cuentas por Pagar, no un botón más
  en caja menor.

**Verificado en pantalla (17 oct, celular de 390 px).**

- Los botones de pago miden **40 px** y los campos **38 px**. La regla de la app es
  48 px, porque se usa con los dedos.
- El monto se escribe **sin separador de miles**: en su pantallazo se ve _"647185"_.
  Es fácil meter un cero de más sin notarlo.
- Una de las categorías de caja menor es **"Abono a proveedor"**. Eso mismo empuja a
  pagar proveedores por caja menor en vez de por Cuentas por Pagar (ver R6).

**Pensando en ella:** mostrar el monto formateado (_$ 647.185_) mientras escribe, y
subir los botones a 48 px. Eso le sirve más en el día a día que agregar Mixto.

**Estado:** evaluado: Mixto no; Crédito sí, pero como gasto por pagar.

---

## R5. Imprimir la caja menor en formato POS o media hoja

**Fecha:** 2 de octubre, 4:13 p. m.
**Origen:** pantallazo del detalle de la caja menor **#1138, INTERRAPIDISIMO**,
flete, $ 18.500, sede CV, recibida el 2/10/26 por Deyanira.

**Lo que dijo:**

> "Configurar esta para que salga como POS o al menos la mitad de la hoja, así como
> quedó la de los traslados."

**Lo que pide:** que el botón **Imprimir orden** de una caja menor saque un
documento corto, en tirilla POS o en media carta, con el mismo estilo que ya tiene
la impresión de traslados.

**Cómo está hoy en la app** (revisado en el código, sin evaluar):

- **Imprimir orden** en el detalle de la compra llama a `window.print()`: imprime la
  pantalla tal como se ve, en hoja completa.
- Los traslados tienen su propio documento de impresión, el componente
  `RemisionTraslado`, que es el formato corto que a ella le gusta. Ese es el modelo
  que pide copiar.
- Ya existe un formato de tirilla POS para ventas (`src/lib/pdf/ventaPOS.js`).

**Veredicto: tiene razón.** (verificado en el código el 17 oct)

- "Imprimir orden" hace `window.print()`: imprime la pantalla entera en hoja
  completa, con botones y todo.
- Los traslados tienen un documento propio de impresión (`RemisionTraslado`), que
  es lo que a ella le gusta, y ventas tiene tirilla POS. Hacer lo mismo para la caja
  menor es reutilizar algo que ya existe.

**Verificado en pantalla y en el código (17 oct).**

- La única pantalla preparada para imprimir es la remisión de traslados. La compra y
  la caja menor **imprimen la app entera**: menú lateral, botones y barra de abajo.
- El botón dice **"Imprimir orden"** también en una caja menor, que no es una orden.
- En la caja menor #1138 (un flete) la pantalla muestra **"Devolver por garantía"**,
  la marca **"Recibida"** y en la línea de tiempo **"Mercancía recibida en bodega"**.
  Para un pago de transporte nada de eso aplica.

**Pensando en ella:** para caja menor, lo útil es un **comprobante de egreso** corto
(fecha, concepto, monto en número y en letras, quién lo pagó y una línea para la
firma de quien recibe la plata), en media carta o tirilla. Es lo que se archiva en
físico. Y esconder garantía y "mercancía recibida" cuando es caja menor.

**Estado:** evaluado: tiene razón.

---

## R6. Anticipo o abono a un proveedor antes de recibir la mercancía

**Fecha:** 3 de octubre, 10:19 a 11:22 a. m.
**Origen:** conversación de texto y notas de voz, empezando con un pantallazo de
_Notas crédito de proveedores_ (vacía).

**Lo que dijo, en orden:**

> "¿Cómo genero un anticipo? No me parece la opción, ¿o desde dónde lo hago? Es un
> cliente al cual le pago un producto por adelantado pero no me ha generado factura."

Aclaró que no es un cliente sino **un proveedor**, y que sí, es un **abono**.

> "Nosotros hacemos el pago del anticipo, pero como el señor no nos emite la factura
> todavía, porque solamente le estamos haciendo un anticipo a la compra para
> despachar el producto, cuando el producto esté listo ellos elaboran la factura. El
> detalle es que nosotros no podemos generar la factura de una vez en el sistema,
> porque entonces los productos nos van a aparecer como disponibles y obviamente no
> están disponibles, porque no van a llegar hasta el momento en que hagamos la
> factura."

> "Yo compré diez acoples, pero para que me los puedan fabricar tengo que hacer un
> abono. Necesito meter ese abono porque esa plata salió hoy, y salió por
> transferencia, entonces tengo que cruzarla en los bancos."

**Lo que pide:** poder registrar **plata que ya le salió a un proveedor** por una
compra que todavía no existe en papel:

- Que el pago quede registrado el día en que salió, para que cuadre la caja y el
  banco.
- Que se pueda hacer **por transferencia**, para cruzarlo con el extracto.
- Que **no entre nada al inventario** hasta que llegue la mercancía.
- Que cuando llegue la factura, ese abono se descuente de lo que se le debe.

**Lo que se acordó mientras tanto (3 de octubre):**

- David le dijo que por ahora lo registre como **salida de caja menor**, para que no
  se le descuadre la caja, y que en la observación ponga todo con detalle: _"se abona
  a una compra de [qué cosa] con código [tal], por un valor de [tanto], cuando el
  valor total de la factura es [tanto], al proveedor [nombre] registrado en la app,
  pagado en efectivo o transferencia"_.
- David quedó en **agregar la función "mañana"** (4 de octubre), y en ese momento
  crear la compra y arreglar la caja.

**Lo que la clienta advirtió:**

> "En ese caso me tocaría anular la caja menor de allá, porque si no se nos
> registraría una doble salida, ¿no? Creería yo."

Tiene razón en el riesgo: cuando exista la forma correcta, esa caja menor provisional
**hay que anularla** al pasar el abono, o la plata sale dos veces en el cierre.

**Pendientes de este punto:**

- La función que David prometió.
- Ubicar la caja menor provisional que haya registrado con ese detalle, para
  migrarla y anularla.

**Cómo está hoy en la app** (revisado en el código, sin evaluar; **hipótesis
por probar**):

- Puede que **ya se pueda hacer** con lo que existe, sin función nueva:
  1. Registrar la compra en **Nueva Compra** con forma de pago **Crédito** y **sin
     marcarla como recibida**. Una compra sin recibir **no suma nada al
     inventario**; el stock entra solo al recibirla.
  2. La compra a crédito aparece en **Cuentas por Pagar**, aunque no esté recibida.
  3. Ahí se registra el **pago parcial** (el abono) el día que salió la plata, con
     su método y su cuenta bancaria. El cierre lo cuenta ese día como egreso.
  4. Cuando llegue la mercancía, se recibe la compra (con el conteo, si es Bodega o
     Admin) y se paga el resto.
- **Verificado el 2026-10-17:** el pago en el paso 3 solo lo pueden registrar
  **Admin o Bodega**. Una vendedora puede crear la compra a crédito y recibirla, pero
  no puede abonarle al proveedor. Si quien paga es una vendedora, el abono lo tiene que
  registrar Bodega o Admin, y ese límite es parte de por qué terminan usando la caja
  menor.
- Lo que hay que confirmar antes de decírselo: que el pago a una compra sin recibir
  no tenga ningún bloqueo, y que **el valor de la factura todavía no lo conoce**. Si
  no sabe el total, la compra a crédito no se puede montar con el valor correcto, y
  ahí sí haría falta un anticipo "suelto" (por ejemplo, una nota crédito al
  proveedor).
- Las notas crédito de proveedor existen pero hoy no tienen ninguna registrada.

**Veredicto: la necesidad es real, la función ya existía, y el caso ya se
resolvió, pero con un desfase de fechas y una duda sobre el stock.** (verificado
contra la base el 17 oct)

- **Ya se podía hacer el 3 de octubre** sin función nueva: compra a crédito sin
  recibir, y el abono en Cuentas por Pagar. Nadie lo sabía.
- **Así se resolvió:** la caja menor provisional **#1153** ("Abono a Jorge diaz",
  llaves de bola de 1/2, $1.260.000 por transferencia, "pendiente factura, aún la
  mercancía no llega") está **cancelada**. El 5 de octubre se creó la **compra #1170
  a crédito por $2.520.000** (360 llaves de bola) con un abono de **$1.260.000** por
  transferencia. No quedó doble salida.
- **Primer problema:** la plata salió el **3 de octubre**, pero el abono quedó
  registrado el **5**, porque la compra se creó ese día. El extracto del banco dice
  3 y la app dice 5. Es exactamente lo que ella quería evitar ("esa plata salió hoy,
  tengo que cruzarla en los bancos"). Hoy un pago a proveedor no se puede registrar
  con fecha anterior.
- **Segundo problema:** la compra #1170 se registró y se dio por **recibida en el
  mismo segundo**, sin conteo. Si las 360 llaves no habían llegado el 5 de octubre,
  aparecieron como disponibles sin estar. Es justo lo que ella temía. **Hay que
  preguntarle si llegaron ese día.**
- **Lo que de verdad le falta** es saber que el camino existe ("compra a crédito, sin
  recibir, y abonar en Cuentas por Pagar"), y quizás poder poner la fecha real del
  pago.

**Verificado en pantalla (17 oct, celular de 390 px).**

- La compra #1170 y su abono los registró **Bodega**, no David. Bodega sí conocía el
  camino correcto, pero **marcó la compra como recibida en el momento**. La caja menor
  provisional #1153 la había registrado la clienta.
- En Nueva Compra, la casilla **"Marcar como recibida ahora"** viene desmarcada, así
  que dejarla pendiente es lo normal.
- En Cuentas por Pagar la tarjeta de la #1170 dice _"Parcial · Total $2.520.000 ·
  saldo $1.260.000"_, pero **no dice si la mercancía ya llegó**.
- El modal **Registrar pago no tiene fecha**: el pago queda siempre con la de hoy. Y en
  el celular **es más ancho que la pantalla**: "Tarjeta" sale cortado y aparece una
  barra para deslizar de lado.

**Pensando en ella:** el camino existe, pero son dos pantallas distintas y nadie se
lo explicó. Lo más cómodo sería que **Nueva Compra, cuando es a crédito, pregunte
"¿Le abonaste algo hoy?"** y registre el abono ahí mismo; que el pago acepte **la
fecha real**; y que Cuentas por Pagar muestre **"Mercancía pendiente"** cuando la
compra no se ha recibido.

**Estado:** evaluado: necesidad real; la función existía; falta enseñarla.

---

# Parte 2. Solicitudes del documento Word

**Origen:** `solicitud_mejoras_programa_gestion.docx`, en la raíz del repositorio,
entregado el 17 de octubre. Título: _"Solicitud de Mejoras - Programa de Gestión"_.
Trae 8 puntos, sin imágenes. Todos se verificaron el 17 de octubre contra el código,
la base de producción y, cuando aplicaba, la pantalla en tamaño celular como Admin.

## Resumen del Word

| #   | Tema               | Qué pide, en corto                                                    | ¿Tiene razón?                                                          | Qué hacer                                            |
| --- | ------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| W1  | Auditoría          | Ver los valores en pesos de cada movimiento, no solo el tipo          | **Sí.** La bitácora solo muestra unidades                              | Mostrar el valor del documento de origen             |
| W2  | Cierres            | Filtro por fecha en el cierre de las vendedoras                       | **Sí.** Solo hay 4 botones fijos, no se puede escoger un día           | Agregar selector de día                              |
| W3  | Cotizaciones       | Que las notas adicionales salgan en la cotización impresa             | **Sí.** El PDF solo imprime la dirección                               | Imprimir las notas                                   |
| W4  | Devoluciones       | Poder anular devoluciones mal hechas                                  | **Ya existe**, pero 24 de 25 son cambios y se anulan desde la venta    | Enseñarle el camino; poner el botón en la devolución |
| W5  | Órdenes de trabajo | Ver qué OT pagaron en una fecha, aunque la OT sea de otro día         | **Sí.** En su ejemplo del 31 de agosto, la mitad no aparece            | Filtro por fecha de pago                             |
| W6  | Insumos            | Que la campanita diga para qué OT o ensamble es el insumo             | **Sí.** Es el mismo pedido que R1                                      | Ver R1                                               |
| W7  | Compras            | Que el descuento se aplique antes del IVA                             | **Ya está bien.** Las 15 compras con descuento lo tienen antes del IVA | Nada que arreglar; explicárselo                      |
| W8  | Retenciones        | Claridad sobre cómo sale la retención y por qué queda saldo pendiente | **En parte.** El cálculo cuadra, pero casi ninguna pantalla la muestra | Mostrarla en cierres, detalle de venta y un informe  |

---

## W1. Auditoría: discriminar los valores

**Lo que pide:**

> "Implementar en el módulo de auditoría que no solamente se muestre si el movimiento
> corresponde a una venta, compra o servicio, sino que también se puedan discriminar
> los valores correspondientes."

**Verificado:**

- La bitácora lee de la tabla `movimientos`, que guarda **unidades** (cantidad, stock
  antes y después), no plata. La pantalla muestra tipo, producto, unidades, usuario,
  sede y fecha.
- Además, como se vio en R1, el "Origen" sale como un código interno cortado
  (_"orden_servicio · a4c38452"_) y no se puede tocar para abrir el documento.

**Veredicto:** tiene razón. Hoy no hay forma de ver en Auditoría cuánta plata movió
cada movimiento.

**Pensando en ella:** el valor sí existe, pero en el documento de origen (la venta, la
compra, la OT). Lo más útil es que cada movimiento muestre el valor de esa línea
(_"2 uds × $ 45.000 = $ 90.000"_) y el documento en palabras (_"Venta #2724"_), y
que se pueda tocar para ir a él. Se puede hacer junto con R1.

**Estado:** evaluado: tiene razón.

---

## W2. Cierres: filtro por fecha en el de las vendedoras

**Lo que pide:**

> "En la parte de los cierres de las muchachas, agregar el filtro de búsqueda por
> fecha, ya que actualmente ese filtro no está implementado."

**Verificado:**

- La ruta del cierre muestra una pantalla distinta según el rol. A las vendedoras les
  sale una vista propia, solo de su sede y solo de lectura.
- Esa vista tiene **cuatro botones fijos: Hoy, Esta semana, Este mes y Mes pasado.**
  No tiene ningún campo para escoger un día concreto.
- La pantalla de cierres del Admin sí tiene "desde" y "hasta".
- No se pudo abrir en pantalla la vista de las vendedoras, porque como Admin la app
  muestra la otra. Quedó verificado en el código.

**Veredicto:** tiene razón. Si una vendedora quiere revisar el cierre del martes de la
semana pasada, no puede.

**Pensando en ellas:** un selector de un solo día (lo que más van a usar), además de
los botones que ya existen, con botones de 48 px para usarlo en el celular.

**Estado:** evaluado: tiene razón.

---

## W3. Cotizaciones: las observaciones no salen impresas

**Lo que pide:**

> "Que lo que se registra en el sistema como observaciones adicionales también aparezca
> al imprimir la cotización, para poder entregársela al cliente. Esto es muy importante
> y debe quedar reflejado allí."

**Verificado:**

- En la app, las observaciones de una cotización se guardan en un solo campo que
  después se separa en partes: contacto, cargo, dirección y **"Notas adicionales"**.
- El PDF de la cotización (`src/lib/pdf/cotizacionPDF.js`) **solo imprime la
  dirección**. Las notas adicionales, el contacto y el cargo se guardan pero no salen
  en el papel.
- En la base: de **52 cotizaciones, 5 tienen notas adicionales** que no salieron
  impresas.

**Veredicto:** tiene razón. Lo que ella escribe para el cliente no le llega al cliente.

**Pensando en ella:** imprimir las notas en un bloque visible, cerca de los términos, y
mostrar en la pantalla de la cotización una vista previa de lo que va a salir.

**Estado:** evaluado: tiene razón. Es el arreglo más pequeño de todo el documento.

---

## W4. Devoluciones: poder anular las que están mal hechas

**Lo que pide:**

> "Implementar la opción de anular las devoluciones que estén mal hechas, para los
> casos en que se cometa un error al registrarlas."

**Verificado:**

- **La función ya existe** (`fn_anular_devolucion`) y está en la pantalla de la
  devolución, solo para el Admin. Revierte el stock y tiene bloqueos que explican qué
  hacer: si el producto ya se vendió, lo dice.
- Pero **de las 25 devoluciones procesadas, 24 son cambios de producto** y solo una es
  una devolución normal. Un cambio no se anula desde la devolución: se anula desde la
  **venta**, con el botón **"Anular cambio"**, porque se revierten las dos partes
  juntas.
- En pantalla, en el celular: la devolución de un cambio explica esto con un texto
  claro y un enlace a la venta. En la venta, el botón **"Anular cambio"** se ve, mide
  48 px y explica qué va a pasar.
- Solo hay una devolución anulada en toda la historia (31 de agosto), y desde que
  existe "Anular cambio" (5 de septiembre) no se ha usado nunca.

**Veredicto:** no hace falta una función nueva. La herramienta existe y funciona, pero
**ella no sabe que existe**, o no sabe que para un cambio está en la venta.

**Pensando en ella:** poner el botón **"Anular cambio" directamente en la pantalla de
la devolución**, en vez de mandarla a otra pantalla. Así lo encuentra donde lo busca.

**Estado:** evaluado: ya existe; falta enseñarlo y acercar el botón.

---

## W5. Órdenes de trabajo: ver qué se pagó en una fecha

**Lo que pide:**

> "Al consultar las órdenes de trabajo, poder identificar la fecha en que efectivamente
> ingresó el pago de cada orden, independientemente de la fecha en que se generó la
> orden. Al filtrar por fecha de pago (por ejemplo, 31 de agosto) el sistema solo
> muestra las órdenes creadas ese día, pero no las órdenes de otras fechas cuyo pago
> ingresó ese mismo 31 de agosto."

**Verificado:**

- El historial de OT filtra por la **fecha de creación de la orden**, no por la de sus
  pagos.
- **Su ejemplo, revisado en la base:** el 31 de agosto entraron **6 abonos de OT por
  $ 1.285.900**. **Tres de ellos ($ 844.900) son de órdenes creadas otro día**, así
  que filtrando por el 31 solo se ve la mitad.
- El cierre sí cuenta esa plata en el día correcto, porque suma los abonos por su
  fecha. Pero no muestra la lista de qué órdenes la pagaron.

**Veredicto:** tiene razón. La plata cuadra, pero no hay dónde ver de qué órdenes vino.

**Pensando en ella:** un filtro **"Pagadas el día…"** en el historial de OT, o una
lista de "abonos del día" dentro del cierre, con número de OT y cliente.

**Estado:** evaluado: tiene razón.

---

## W6. Trazabilidad de insumos: para qué se usó

**Lo que pide:**

> "¿Cómo validar que lo que las vendedoras están descontando como insumo corresponde
> efectivamente a una orden o a un ensamble? Al revisar la notificación (la campanita)
> el sistema muestra que se está usando un insumo, pero no especifica el destino del
> mismo. Se requiere que indique si es para una orden (con su número) o para un
> ensamble (indicando de qué ensamble se trata, por ejemplo el ensamble de un caballo
> o de cinco caballos)."

**Verificado:**

- **Es el mismo pedido que R1**, ahora con la campanita.
- La notificación real dice, por ejemplo: _"Hoy en Almacén CV: 8 conversiones a
  insumo (128 ud)."_ No dice qué productos, ni para qué orden o ensamble.
- Como se vio en R1: **de 1.981 conversiones, ninguna guarda su destino**, aunque el
  95% se puede amarrar a una OT, un ensamble o un préstamo por el movimiento que pasa
  en el mismo segundo.

**Veredicto:** tiene razón. Hoy no tiene forma de comprobar lo que pregunta.

**Pensando en ella:** que la campanita diga _"Deyanira convirtió 2 motores de 1 HP
para la OT #285 (cliente X)"_ o _"…para el ensamble #40, compresor de 5 HP"_, y que se
pueda tocar para abrir el documento. Se resuelve junto con R1 y W1.

**Estado:** evaluado: tiene razón. Se agrupa con R1.

---

## W7. Descuentos en compras: antes del IVA

**Lo que pide:**

> "Validar que los descuentos aplicados en las compras se calculen y apliquen antes
> del IVA, y no sobre el valor total ya con IVA incluido."

**Verificado:**

- La base calcula el IVA sobre _subtotal menos descuento_ (`fn_registrar_compra`).
- La pantalla de Nueva Compra hace la misma cuenta y lo dice debajo del campo:
  _"Se resta del subtotal antes del IVA."_
- **En los datos: las 15 compras con descuento lo tienen aplicado antes del IVA.
  Ninguna después.**

**Veredicto:** ya funciona como pide.

**Pensando en ella:** lo que sí puede pasar es que el proveedor dé un descuento **por
producto** o en **porcentaje**, y la app solo acepta un descuento total en pesos. Vale
la pena preguntarle si su duda vino de una factura con descuento por línea.

**Estado:** evaluado: ya está bien. Solo explicárselo.

---

## W8. Retenciones: claridad sobre cómo sale la plata

**Lo que pide:**

> "Validar más a fondo el tema de las retenciones: cómo se descuenta ese dinero y tener
> claridad sobre la salida del mismo en cada compra o en cada venta, ya que en
> ocasiones ese valor queda pendiente por pagar o pendiente por cobrar sin la claridad
> necesaria."

**Verificado:**

- **Ya se están usando:** 26 ventas ($ 1.983.811 retenidos), 18 OT ($ 1.701.933) y 22
  compras ($ 2.271.237).
- **El cálculo cuadra.** Las cuentas por cobrar y por pagar ya restan la retención del
  saldo. Buscando cuentas que quedaron con un saldito del tamaño de una retención sin
  registrarla, solo apareció **un caso**: la venta #1483 a FURGONES Y CARROCERIAS RED
  METAL, que pagó $ 633.290 de $ 668.290 y le quedan $ 35.000 (5,24%). Por ser un
  número redondo parece un pago parcial, no una retención. Hay que preguntarle.
- **Lo que de verdad falta es que se vea.** La retención aparece al crear la venta, en
  el recibo impreso, en la OT, en la compra y en el modal de pago. Pero **el detalle de
  la venta, el historial de ventas y los dos cierres (Admin y vendedoras) no la
  mencionan ni una vez.** El cierre cuenta el neto sin explicar por qué es menor que lo
  vendido.
- **Tampoco hay un informe de retenciones del mes.** La plata retenida no se pierde: es
  un anticipo de impuestos que el contador cruza con los certificados. Pero la app no
  tiene dónde ver "cuánto nos retuvieron y cuánto retuvimos este mes".

**Veredicto:** en el cálculo no hay error. La falta de claridad que ella siente es
real, porque las pantallas donde ella revisa la plata no muestran la retención.

**Pensando en ella:**

- En el cierre, una línea: _"Vendido $ X − retenciones $ Y = entró $ Z"_.
- En el detalle de la venta, el mismo desglose que ya tiene el recibo.
- Un informe simple de **retenciones del mes**, separado en "nos retuvieron" (ventas y
  OT) y "retuvimos" (compras), para entregarle al contador.
- Y una explicación corta: la retención no es plata perdida, se descuenta en la
  declaración.

**Estado:** evaluado: el cálculo está bien; falta mostrarlo.

---

# Parte 3. Respuestas de la clienta y las empleadas (17 oct)

Se le mandaron 7 preguntas por WhatsApp. Contestaron ella (en audios y mensajes) y
las empleadas de CV y CHV (por texto). Lo que sigue es lo que dijeron, junto con lo
que hay que hacer o lo que todavía falta confirmar.

## Lo que quedó decidido

**4. Para qué se convierte a insumo.** Ella respondió: _"Opcional para mí,
obligatorio para ellos, en órdenes, ensambles y préstamo de herramientas, para
bodega usuario de Faiber"_.
→ Bloque 2: el destino es **opcional para el Admin** y **obligatorio para las
vendedoras y para Bodega**. Las opciones son OT, ensamble o préstamo de herramienta,
y "Otro + nota" para los casos raros.

**7. Pago mixto.** Al principio no lo entendió. Después explicó en un audio que la
nómina la paga a veces por Nequi y a veces en efectivo, y que lo importante es **de
dónde sale la plata**. David le propuso registrar varios pagos y quedó así.
→ **No se hace un botón Mixto.** Se registra un pago por cada forma de pago y se
enseña en la guía. En compras también pidió _"pago mixto también"_, con una captura
de Nueva Compra. Ahí el mismo resultado se logra con una compra a **Crédito** y, en
Cuentas por Pagar, un pago por cada forma de pago. Ojo: hoy esos pagos los registra el Admin, o Bodega solo
para compras de BODEGA. Las compras de las vendedoras solo las paga el Admin.

## Pedidos nuevos que salieron en la conversación

**N1. Que el usuario de Bodega de Faiber pueda vender.** Hoy el rol Bodeguero no
tiene acceso a Ventas. Hay dos usuarios Bodeguero, _Bodega_ y _Bodega2_, y **falta
saber cuál es el de Faiber**. Es un cambio de permisos del rol (RoleGuard, RLS y las
RPC de venta) que además afecta el cierre de la sede BODEGA. Hay que diseñarlo; no
basta con activar un permiso.

**N2. Compras desde cualquier sede (Admin).** En el audio de las 11:14 dijo: _"así
como usted me pone con ventas que yo puedo vender por cualquier bodega, me puedes
poner las compras por cualquier bodega… en algún momento necesito comprar por alguna
bodega y las muchachas están cerradas"_.
→ **Verificado: tiene razón.** En Nueva Venta el Admin escoge la sede; en Nueva
Compra no, porque la compra siempre va a la sede del usuario (`CompraNueva.jsx` manda
`p_sede_id: perfil?.sede_id`, y el Admin está en BODEGA). **El servidor ya lo
permite**: `fn_registrar_compra` solo bloquea otra sede a quien no es Admin. Así que
el arreglo es solo de pantalla: un selector de sede para el Admin en Nueva Compra
(compra y caja menor), igual al de Nueva Venta. Es pequeño y va en el Bloque 1.

## Respuestas sobre datos

**1. FURGONES (venta #1483):** respondieron _"todavía debe $ 35.000"_. Sigue sin
aclararse la venta **#2284**, del 15 de septiembre: un aceite AM501/4 de $ 35.000
pagado por transferencia. No se sabe si fue un segundo aceite o el mismo pago
registrado dos veces. Si fue lo segundo, el cierre de ese día tiene $ 35.000 de más y
el aceite se descontó dos veces del inventario. **Falta preguntarle a Deyanira.**

**2. OT con abono**

- **OT 23.** Respuesta: _"Es una prueba, ya que se hizo a consumidor final"_.
  **David decidió cancelarla (17 oct)**, aunque no cuadra: Tiene un abono de **$ 297.500 por
  transferencia**, registrado por Edna el 11 de junio, que está en el cierre de ese
  día. Una prueba no suele tener una transferencia de ese tamaño. Hay que preguntarle
  a Edna si esa plata entró de verdad y a qué corresponde.
- **OT 32.** No se cerró porque en ese momento el programa no funcionaba, y el
  trabajo se hizo a mano, como antes. El abono de $ 100.000 sí está en la app. Se
  cierra como entregada. **Falta saber el valor final**; si nadie lo sabe, el total
  se deja igual al abono.
- **OT 39** (L3, Sofía): sin respuesta.
- **OT 185.** El cliente está incapacitado y no ha podido recogerlo; el compresor
  está en el almacén. La OT sigue abierta.

**3. OT sin plata**

Se cancelan:

- **OT 31** (CHV): fue una prueba hecha cuando se explicaba el programa.
- **OT 50** (CV): _"El jefe lo compró, ya no existe"_.

Se cierra como entregada:

- **OT 192** (CV): el cabezote se entregó y el cliente compró uno nuevo.

Equipo abandonado, va para chatarra:

- **OT 144** (CV): se mandó a bodega, el cliente no contesta y se va a chatarrizar.
- **OT 170** (CV): el cliente no lo recogió, se mandó a bodega y posiblemente va
  para chatarra.

Siguen abiertas, con el equipo esperando al cliente:

- **OT 45** (CV): está en bodega. El cliente compró un compresor nuevo, el motor está
  quemado y la reparación sale cara. Posible chatarra.
- **OT 51** (CV): está en el almacén; el cliente dice que viene a abonar.
- **OT 74** (CV): Don Nelson "pica pica". Ella autorizó un descuento y él aceptó,
  pero no ha venido porque no tiene plata.
- **OT 104** (CV): está en el almacén. El cliente habló con el jefe Edier y autoriza
  la reparación, pero despacio porque todavía no tiene para abonar. Su estado
  debería pasar a "autorizada".
- **OT 145** (CV): no autorizaron. No se ha entregado porque partes del equipo se
  vendieron de segunda y hay que reponerlas.
- **OT 164** (CV): el cliente iba a volver a negociar uno nuevo y no volvió.
- **OT 198** (CV): está autorizada y en reparación; no se ha cotizado porque no hay
  repuestos.
- **OT 163** (CHV): se le cotizó, se le escribe y no responde.
- **OT 171 y 172** (CHV): dos compactos quemados que el cliente no autorizó. Dice que
  pasa a recogerlos y no lo hace.

Sin respuesta todavía:

- **OT 78, 79, 83, 108 y 181** (L3, Sofía).
- **OT 68** (BODEGA).

La mayoría **no son OT olvidadas**: son equipos que siguen en el almacén esperando al
cliente. Eso confirma que sí hacen falta las alertas de "OT con más de 30 días sin
recoger" (H5), y una forma clara de marcar un equipo como **abandonado / chatarra**.

**5. OT 10, 11, 14 y 15 del 3 de junio:** sin respuesta.

**6. Caja menor #1211 (RUBIELA, $ 291.400):** sin respuesta.
