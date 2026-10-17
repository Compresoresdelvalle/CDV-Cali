# Mejoras pedidas por la clienta: hoja de ruta

**Fecha:** 2026-10-17. Se actualizó ese mismo día con las respuestas de la clienta y
de las empleadas.
**Fuente:** `docs/requerimientos-clienta.md`. Reúne 6 pedidos por WhatsApp, 8 del Word
y 8 hallazgos, todos verificados contra el código, la base de producción y la pantalla
en tamaño celular. Las respuestas de ellas están en la Parte 3.
**Qué es este documento:** el plan de cómo se va a abordar todo. Divide el trabajo en
bloques independientes. Antes de tocar código, cada bloque tiene su propio spec y su
propio plan, y se le muestra a David.

---

## 1. Cómo está repartido el trabajo

Un tercio de lo que pidió la clienta **ya existe**: lo que falta es que lo sepa usar.
Eso se resuelve con una guía y sin código, así que va primero. Hay además una
**limpieza de datos** que ya está aprobada y no espera a nadie. El resto son arreglos
reales, agrupados por tema para no tocar la misma pantalla dos veces.

| Bloque                               | Qué resuelve                                                            | Pedidos                 | Tamaño              | ¿Falta algo para arrancar?                      |
| ------------------------------------ | ----------------------------------------------------------------------- | ----------------------- | ------------------- | ----------------------------------------------- |
| **0. Guía "Lo que ya puedes hacer"** | Enseñar lo que ya existe                                                | R3, R4, R6, W4, W7, W8  | Mediano, sin código | No                                              |
| **D. Limpieza de datos**             | Cerrar o cancelar OT viejas y de prueba                                 | R2                      | Chico               | No para lo aprobado; el resto espera respuestas |
| **1. Arreglos rápidos**              | Errores chicos, comodidad en el celular, comprar para otra sede         | W3, R3, H2–H7, N2       | Mediano             | No                                              |
| **2. Trazabilidad de insumos**       | Saber para qué se usó cada insumo y cuánto valió                        | R1, W1, W6              | Grande              | No (ella ya decidió)                            |
| **3. Plata que sale a proveedores**  | Pagar la compra en partes o por adelantado, gasto a crédito, fecha real | R4, R6, pedido de mixto | Grande              | Una decisión de David (3.0)                     |
| **4. Retenciones a la vista**        | Que se vean en cierres, detalle de venta e informe                      | W8                      | Mediano             | No                                              |
| **5. Órdenes de trabajo y cierres**  | OT pagadas por día, cierre por día, equipos que nadie recoge            | W5, W2, R2, H5          | Mediano             | Una decisión de David (5.0)                     |
| **6. Impresiones**                   | Comprobante de caja menor en media hoja                                 | R5                      | Chico               | No                                              |
| **7. Guía de novedades**             | Contarle a todos lo que cambió                                          | Todo                    | Mediano             | No                                              |

**Orden propuesto:** 0 y D → 1 → 2 → 3 → 5 → 4 → 6 → 7.

- La **guía** y la **limpieza** salen ya, en paralelo.
- El **1** es rápido y alivia el día a día.
- El **2** es lo que más pidió, y ya tiene la decisión de ella.
- El **3** va antes que el 5 porque sus pedidos (mixto en compras, anticipos) son los
  que ella tropieza cada semana.
- El **5** sube antes que el 4 porque las respuestas mostraron que hay muchos equipos
  de clientes esperando en los almacenes sin que nada lo avise.
- El **4** solo muestra lo que ya está bien calculado.

---

## 2. Cómo se trabaja cada bloque

Es el mismo método de los bloques anteriores (retenciones, picking, panel):

1. **Spec** en `docs/superpowers/specs/`, con el diseño y las decisiones.
2. **Plan** en `docs/superpowers/plans/`, en tareas chicas con su prueba.
3. **Vista previa a David** antes de programar. Nada se implementa sin su visto bueno.
4. **Implementación por subagentes**: uno orquesta y revisa, otro ejecuta.
5. **Verificación en cuatro capas**, porque build y pruebas en verde no bastan (ya
   pasó que no atraparon 7 defectos reales):
   - pruebas automáticas, lint y build;
   - en la base de producción dentro de `BEGIN … ROLLBACK`, con los productos
     `INVENTARIO DE PRUEBA`;
   - **en pantalla, como Admin y como vendedora, en tamaño celular de 390 px**, que es
     como lo usan;
   - advisors de seguridad de Supabase.
6. **Commit por tarea**, y no se despliega nada hasta que David diga.

**Lecciones que aplican a todo el trabajo** (salieron caras antes):

- Recrear una vista o una función **borra sus permisos y su `security_invoker`**, y el
  esquema le regala acceso a `anon`. Hay que reponerlos y verificarlos. (Lo hacen los
  bloques 1, 4 y 5.)
- Agregar parámetros a una función con `create or replace` **crea una sobrecarga**, no
  la reemplaza. Hay que bajar la firma vieja. (Bloques 2 y 3.)
- La tabla `movimientos` **no deja editar ni borrar**. Lo que se quiera agregar a un
  movimiento viejo va en una tabla aparte. (Bloque 2.)
- **Ningún cambio puede mover los totales de plata del cierre** sin que se haya
  decidido a propósito. Cada bloque compara el cierre antes y después.
- **Una OT cancelada saca sus abonos del cierre**: `_fn_cierre_totales` filtra
  `o.estado <> 'cancelada'` en todos los sitios. Los cierres que ya están guardados no
  cambian, pero el recálculo de ese día sí. (Bloques D y 5.)

---

## 3. Los bloques

### Bloque 0. Guía "Lo que ya puedes hacer"

**Por qué primero:** no requiere código, resuelve dudas que ella ya tiene y le quita
la sensación de que "la app no hace" cosas que sí hace.

**Para quién:** la clienta y las vendedoras. Como las empleadas contestaron directamente
las preguntas, la guía tiene que servirles también a ellas.

**Formato:** el mismo de las guías anteriores. Primero un **artifact** con el estilo
exacto de _Novedades de agosto y septiembre_ (logo en la cabecera, tarjetas, fuente
monoespaciada en etiquetas, insignias azules numeradas), y de ahí el **PDF desde
Chrome**. Las fuentes HTML se guardan en `docs/` para poder corregirla después.

**Reglas de escritura**, las mismas que se pidieron para la guía de septiembre:

- Lenguaje para alguien que no sabe nada de sistemas: frases cortas, ejemplos con
  plata, sin palabras de contador.
- Una sección por tarea, en **pasos numerados con la maqueta de la pantalla al lado**
  (el bloque `.stepr` del estilo).
- Cada paso dice **dónde tocar**, con el nombre exacto del botón tal como sale en la
  app.
- Los mensajes de error que puede ver, en su recuadro, con **qué hacer** debajo.
- Tarjetas de "antes / ahora" o "lo que dice la factura / lo que entra" cuando hay
  plata de por medio.
- Cuando algo **solo lo puede hacer un rol**, se dice en el paso, con un aviso de qué
  hacer si quien lee no tiene ese rol.
- **Probado contra la pantalla real en celular**: cada paso se recorre en la app antes
  de escribirlo.

**Contenido, en el orden en que más le sirve:**

1. **Que un producto no alarme en una sede (R3).**
   - Camino: Inventario → **Mínimos** → escoger la sede → buscar el producto → poner
     mínimo **0**.
   - Qué sigue apareciendo igual, y por qué es normal: "Agotado" en Inventario, y la
     pestaña "Se vende y no hay" si el producto se vendió ahí en los últimos 90 días.

2. **Darle stock a un producto nuevo (R3).**
   - El stock no se escribe a mano: entra por una compra, un traslado (solo si la sede
     de origen tiene) o un conteo.
   - Conteo: Admin → **Conteo** → **Nuevo conteo** → sede → buscar o escanear el
     producto → cantidad física. Sirve aunque el producto nunca haya tenido inventario
     en esa sede: cuenta desde 0.
   - Lo **registra** Admin o Bodega, pero solo **Admin lo aplica**. Hasta que se
     aplica, el stock no cambia.

3. **Pagarle por adelantado a un proveedor (R6).**
   - Nueva Compra a **Crédito**, **sin** marcar "recibida" → Cuentas por Pagar →
     **Registrar pago**.
   - El pago lo registra el **Admin**, o **Bodega si la compra es de BODEGA**
     (`fn_registrar_pago_cuenta` no deja a Bodega pagar compras de otra sede). Una
     vendedora no puede registrar pagos a proveedores, así que las compras de CV, CHV
     y L3 solo las puede pagar el Admin.
   - Cuando llega la mercancía: Admin y Bodega ven **Contar y recibir**, con "Recibir
     sin contar" como enlace; la vendedora ve **Confirmar recepción**.
   - Si alguien sale del conteo sin confirmar, la compra sigue pendiente y lo contado
     queda guardado en ese aparato.
   - Por qué **no** usar caja menor para esto.

4. **Caja menor o compra a crédito: cuál usar (R4).**
   - Caja menor: gastos que se pagan ya y no son mercancía.
   - Compra: mercancía, aunque se pague después.
   - La categoría **"Abono a proveedor"**, y por qué no se usa "Otros gastos" para
     pagar facturas.

5. **Pagar algo en dos formas (pedido de ella, ya decidido; sección nueva).**
   - Lo que importa es **de dónde sale la plata**, por eso se registra un pago por cada
     forma de pago.
   - **Caja menor:** dos registros con el mismo concepto. Por ejemplo, la nómina: uno
     por Nequi y otro en efectivo. Caso real: la nómina del 5 de octubre se pagó
     por Bancolombia, por Occidente y "el resto en Nequi", y quedó como un solo pago.
     Debieron ser tres.
   - **Compra de mercancía:** la compra se registra a **Crédito** y en Cuentas por
     Pagar se hace un pago por cada forma.
   - Aviso: el segundo paso lo hace el Admin, o Bodega si la compra es de BODEGA. Si la
     compra la registra una vendedora, la deja a Crédito y el Admin registra los
     pagos. Esto se acorta cuando salga el 3.1.

6. **Deshacer un cambio de producto mal hecho (W4).**
   - Abrir la devolución → tocar el enlace a la venta → **Anular cambio** (solo Admin).
   - Deshace las dos partes en una sola operación y devuelve el stock.
   - Qué bloquea la anulación: que el producto ya se haya vendido.
   - Es la sección que más va a usar, porque 24 de las 25 devoluciones que hay son
     cambios.

7. **Anular una devolución normal (W4).**
   - Detalle de la devolución → **Anular devolución** (solo Admin).
   - Saca del inventario lo que la devolución había reingresado y revierte el
     reembolso.
   - Se bloquea si ese stock ya se vendió, con un mensaje que lo explica.
   - No sirve para un cambio: ese va por la sección 6.

8. **El descuento en compras (W7).**
   - Se resta **antes** del IVA, con el ejemplo real de la #1229: $ 287.500 − $ 28.750
     = $ 258.750 + IVA $ 49.163 = $ 307.913.
   - Si el proveedor da el descuento en porcentaje, se calcula y se escribe en pesos.
   - Si al recibir llega solo una parte, la app recalcula el IVA, pero el descuento se
     conserva **completo en pesos**: no se reparte según lo que llegó.

9. **Las retenciones, sin enredo (W8).**
   - Qué es y dónde se pone.
   - Por qué al banco entra menos.
   - Que no es plata perdida: se descuenta en la declaración.

10. **Corregir una venta registrada dos veces (sección nueva, condicionada).**
    - Venta → **Anular venta** (solo Admin): devuelve el producto al inventario y saca
      la plata del cierre.
    - Solo se incluye si Deyanira confirma que la #2284 fue un error. En ese caso, la
      clienta la anula ella misma con la guía en la mano.

**Por verificar antes de incluirlo:** una sección sobre **qué hacer con un equipo que el
cliente no recoge** (moverlo a bodega y dejar la nota). Las respuestas muestran que lo
hacen (OT 144 y 170 "se mandó para bodega"). La app guarda la custodia en
`ordenes_servicio.sede_equipo_id`, pero falta recorrer la pantalla a 390 px para ver
si se entiende. Si es enredado, no va en la guía y se resuelve en el 5.3.

**Verificado el 2026-10-17, antes de escribir la guía.** Cada sección se probó contra
producción con la función real, dentro de `BEGIN … ROLLBACK` y como el rol que la
usaría, y las pantallas se revisaron a 390 px:

| #   | Qué se probó                                                                                                                                                                                                     | Resultado                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | Mínimo 0 en una sede con un producto real (GUACAL): deja de alertar ahí y sigue alertando en las demás                                                                                                           | Funciona                           |
| 2   | Conteo de 0 a 5 con un movimiento `conteo_ajuste`; búsqueda de un producto sin inventario en la sede                                                                                                             | Funciona; aplicar es solo Admin    |
| 3   | Compra a crédito sin recibir → pago en CxP → saldo → recepción; salir del conteo sin confirmar                                                                                                                   | Funciona; pagos no para vendedoras |
| 4   | Categorías de caja menor, incluida "Abono a proveedor"                                                                                                                                                           | Existe                             |
| 5   | Compra a crédito de $ 119.000 + pago en efectivo de $ 60.000 + pago por transferencia de $ 59.000: saldo 0; el cierre suma $ 119.000 una sola vez, con $ 60.000 en el arqueo de efectivo y $ 59.000 en la cuenta | Funciona                           |
| 6   | Anular un cambio: ambas partes se deshacen y el stock vuelve                                                                                                                                                     | Funciona; solo Admin               |
| 7   | Devolución de cliente (stock 7 → 8) y su anulación (8 → 7, estado `anulada`)                                                                                                                                     | Funciona; solo Admin               |
| 8   | 15 de 15 compras con descuento lo restan antes del IVA; `fn_recibir_compra` mantiene la regla al recalcular                                                                                                      | Funciona                           |
| 9   | Retenciones de ventas, OT y compras (fase 2)                                                                                                                                                                     | Funciona                           |
| 10  | Anular venta (#2974, CHV, $ 8.000): stock 4 → 5 y los ingresos del día bajan de $ 158.000 a $ 150.000                                                                                                            | Funciona                           |

**Ojo con el orden respecto a los arreglos:** varias secciones enseñan el camino que
funciona **hoy**. Cuando salgan los bloques 1, 2 y 3, algunos pasos se acortan; por
ejemplo, el mínimo desde la ficha del producto, o el pago en partes desde la misma
compra. Esa actualización va en la guía de novedades del bloque 7, no reescribiendo
esta.

**Verificación:** cada paso recorrido en la app en 390 px; el PDF revisado página por
página (sin títulos huérfanos ni páginas casi vacías); el artifact publicado y el PDF
enviado.

---

### Bloque D. Limpieza de datos

**Por qué aparte:** no es código. Son operaciones sobre datos de producción que ya
tienen respuesta, y cuanto antes se hagan, antes dejan de ensuciar las listas de OT y
las alertas.

**Cómo se hace:** un solo script SQL, ensayado primero dentro de `BEGIN … ROLLBACK`.
El ensayo muestra para cada OT el estado antes y después, el stock que se devuelve y
el cierre de cada día afectado antes y después. Se le muestra a David y solo entonces
se ejecuta de verdad.

- Las OT **sin abonos** se cancelan con `fn_cancelar_orden`, con el JWT del Admin, para
  que pase por la misma lógica de la app, incluida la devolución de repuestos.
- Las que **tienen abonos** no pueden pasar por la función, porque esta las bloquea a
  propósito. Se cancelan dentro de un bloque con `cdv.anulando_venta=on`, como ya se
  hizo antes (ver la memoria `ot-anular-entregada-con-abonos`).

**Ya aprobado:**

| OT                 | Qué se hace                          | Efecto en plata y stock                                                                                                                                                                                |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1, 2, 3, 4, 5 y 97 | Cancelar (pruebas sin duda)          | Las 1, 3 y 97 tienen $ 4.380 de abonos de prueba que salen del recálculo del 1 y 23 de junio y del 2 de julio. La 97 consumió 1 PB (producto de prueba) y vuelve.                                      |
| 23                 | Cancelar (lo decidió David)          | **$ 297.500** salen del recálculo del 11 de junio. El cierre guardado #4 (servicios $ 615.000) queda como está, así que si alguien recalcula ese día verá $ 317.500. Se deja anotado en la OT por qué. |
| 31 (CHV)           | Cancelar: prueba de capacitación     | Ninguno                                                                                                                                                                                                |
| 50 (CV)            | Cancelar: "el jefe lo compró"        | Ninguno                                                                                                                                                                                                |
| 192 (CV)           | Cerrar como **entregada**, sin cobro | Ninguno. Hay que ensayar cómo pasarla a entregada sin que el trigger de totales ni el flujo de venta generen algo.                                                                                     |

**Esperando respuesta** (sección 4): las OT 10, 11, 14 y 15; la 32 (falta el valor
final, y si nadie lo sabe se cierra con el total igual al abono de $ 100.000); la 39
y las de L3 (78, 79, 83, 108, 181); y la 68 de BODEGA.

**Se dejan abiertas a propósito**, porque el equipo sigue en el almacén esperando al
cliente: 45, 51, 74, 104, 145, 164, 198, 163, 171, 172 y 185. Las 144 y 170
(abandonadas, para chatarra) **no se tocan aquí**: esperan el estado nuevo del 5.3,
para no cerrarlas con un estado que después haya que corregir.

**Aparte, y no es de la app:** la OT 104 la puede pasar a "autorizada" la misma
vendedora desde la OT. Y la OT 145 dice que partes del equipo del cliente se vendieron
de segunda. Eso es un tema de la operación, no del programa, pero conviene que la
clienta lo sepa.

---

### Bloque 1. Arreglos rápidos

**Por qué:** son errores chicos, de pocas líneas cada uno, pero ella los tropieza todos
los días. Ninguno toca plata.

| #    | Arreglo                                            | Qué se cambia                                                                                                                                                                                                                                                             | Pedido |
| ---- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1.1  | **Notas adicionales en la cotización impresa**     | `cotizacionPDF.js` imprime las notas (y el contacto y el cargo, que también se pierden) en un bloque visible                                                                                                                                                              | W3     |
| 1.2  | **Botón de mínimo y máximo visible en el celular** | La tabla "Stock por sede" de la ficha pasa a tarjetas en celular, con la sede, el estado y un botón **Configurar** de 48 px a la vista                                                                                                                                    | R3     |
| 1.3  | **"No alerta" en Mínimos, en el celular**          | La tarjeta de un producto con mínimo 0 dice "No alerta en esta sede", igual que en escritorio, y el subtítulo no se corta                                                                                                                                                 | R3, H4 |
| 1.4  | **Alertas de OT que siempre dan 0**                | `v_ot_alertas_30_dias` mira los estados que sí se usan (`terminada`, `pendiente_recogida`, y las no autorizadas con el equipo en el almacén) y usa el parámetro `dias_alerta_ot_abandonada`, que ya existe. "OT esperando repuesto" se quita o se le da sentido en el 5.3 | H5     |
| 1.5  | **Caja menor que parece mercancía**                | En una caja menor: esconder "Devolver por garantía", cambiar "Recibida" y "Mercancía recibida en bodega" por un texto de gasto, y el botón "Imprimir orden" pasa a "Imprimir comprobante"                                                                                 | H6     |
| 1.6  | **"Módulo: Sistema" en Auditoría**                 | Agregar conversión a insumo, conversión a venta y salida por garantía al mapa de módulos                                                                                                                                                                                  | H7     |
| 1.7  | **48 px en el celular**                            | Botones de pago y campos de caja menor, y los que salgan al revisar las demás pantallas que se tocan en este bloque                                                                                                                                                       | H2     |
| 1.8  | **Monto con separador de miles**                   | El monto de caja menor muestra _$ 647.185_ mientras se escribe                                                                                                                                                                                                            | H2     |
| 1.9  | **Modal de pago desbordado**                       | Registrar pago cabe en 390 px; los métodos de pago bajan de renglón                                                                                                                                                                                                       | H3     |
| 1.10 | **Comprar para cualquier sede (Admin)**            | Nueva Compra, tanto compra como caja menor, tiene un selector de sede para el Admin, igual al de Nueva Venta. Al cambiar de sede con productos ya agregados, avisa antes de vaciar la lista                                                                               | N2     |

**Sobre el 1.10:** el servidor ya lo permite (`fn_registrar_compra` solo bloquea otra
sede a quien no es Admin), así que es solo de pantalla. Falta revisar en el spec que
la RPC de caja menor haga lo mismo. Hay que probar que la compra recibida sume el stock
en la sede elegida y no en BODEGA, y que el cierre la cuente en esa sede.

**Riesgo:** bajo. El 1.4 recrea una vista, así que hay que reponer permisos y
`security_invoker`.

---

### Bloque 2. Trazabilidad de insumos

**Por qué:** es lo que más pidió, de tres formas (R1 en WhatsApp; W1 y W6 en el Word):
_"¿para qué se usó este insumo?"_, _"¿cuánto valió?"_ y _"¿que la campanita lo diga?"_.

**El problema de fondo:** de 1.981 conversiones a insumo, ninguna guarda su destino. Y
aunque un movimiento sí lo tenga, la Auditoría lo muestra como un código interno.

**Decisión de ella (17 oct):** _"Opcional para mí, obligatorio para ellos, en órdenes,
ensambles y préstamo de herramientas, para bodega"_. Eso quiere decir:

- **Admin:** el destino es opcional.
- **Vendedor y Bodeguero:** el destino es obligatorio. Se escoge entre OT, ensamble o
  préstamo de herramienta, o "Otro" con una nota obligatoria para los casos raros.
- La regla se valida **en el servidor**, dentro de `fn_convertir_a_insumo`, no solo en
  pantalla.

**Diseño propuesto** (a afinar en el spec):

1. **Tabla nueva de destinos** (`conversion_destino`): amarra cada conversión a su OT,
   ensamble o préstamo. Va aparte porque `movimientos` no deja editar, y así tampoco se
   toca el libro de movimientos.
2. **La conversión pide el destino.** `fn_convertir_a_insumo` recibe a qué documento va.
   Casi todas las pantallas ya lo saben:
   - desde la **OT**: el número de la orden, sin que la persona tenga que escoger nada;
   - desde el **detalle del ensamble**: el ensamble;
   - desde **Nuevo ensamble**: el ensamble todavía no existe cuando se convierte, así
     que se amarra en el mismo momento en que se crea;
   - desde **préstamo de herramientas**: el préstamo;
   - desde la **ficha del producto**: no hay documento. El Admin puede dejarlo sin
     destino. La vendedora y Bodega escogen de una lista de las OT, ensambles y
     préstamos **abiertos de su sede**, o "Otro + nota".
3. **Lo histórico se completa por inferencia.** El 95% de las conversiones tiene un
   consumo del mismo producto en los segundos siguientes (1.081 de OT, 762 de
   ensamble, 19 de préstamo). Se amarran con una marca de **"inferido"**, para no
   presentarlas como un dato registrado. Las 82 sin pareja quedan como "sin destino".
4. **La campanita da el detalle:** _"Deyanira convirtió 2 MOTOR 1 HP para la OT #285
   (cliente X)"_, y se puede tocar para abrir la orden. Sigue agrupada por día y sede,
   para no volver a llenar la campana.
5. **La Auditoría en palabras y con plata:**
   - el origen dice _"OT #285 · cliente X"_, _"Venta #2724"_, _"Ensamble #40 ·
     compresor 5 HP"_, y se puede tocar para abrir el documento;
   - cada movimiento muestra su valor, _"2 uds × $ 45.000 = $ 90.000"_, tomado del
     documento (precio de venta, costo de compra o costo del insumo).

**Riesgo:** medio. Cambia una función que usan cinco pantallas (sobrecarga y
permisos). Lo histórico inferido se prueba primero en lectura y se le muestra a David
antes de guardarlo. Ojo: en el último mes Deyanira hizo 373 conversiones. Si escoger
el destino le cuesta más de un toque, se va a notar, así que desde la OT y desde el
ensamble el destino tiene que ir **ya puesto**.

---

### Bloque 3. Plata que sale a proveedores

**Por qué:** hoy se pagan facturas viejas y anticipos por caja menor, porque el camino
correcto existe pero es incómodo. Además ella pidió poder pagar una compra en dos
formas.

**Dato que cambia el diseño:** en los últimos 60 días las **vendedoras registraron 78
de las 167 compras** (Bodega 52, Admin 37), y una vendedora **no puede registrar pagos
en Cuentas por Pagar**. Bodega tampoco puede pagar compras de otra sede
(`fn_registrar_pago_cuenta`), así que las compras de CV, CHV y L3 **solo las puede
pagar el Admin**. Por eso, lo de "compra a crédito y después un pago por cada forma"
de la guía funciona, pero todo termina en manos de ella.

**3.0. Decisión de David antes del spec.** Hay dos formas de resolverlo:

- **A. Pagos dentro de la compra (recomendada).** En Nueva Compra, además de Efectivo,
  Transferencia, Tarjeta y Crédito, hay **"Pagar en partes"**: una lista de pagos, cada
  uno con su forma, su cuenta y su monto.
  - Si suman el total, la compra queda pagada. Eso es el mixto.
  - Si suman menos, el resto queda en Cuentas por Pagar. Eso es el anticipo de R6 y
    el "abono al crear".
  - Todo se guarda en un solo paso dentro de `fn_registrar_compra`, así que sirve para
    quien registre la compra, vendedoras incluidas, sin abrirles Cuentas por Pagar.
- **B. Abrirles Cuentas por Pagar a las vendedoras**, para las compras de su sede.
  - Es más simple de programar.
  - Pero les da una pantalla de plata que hoy no ven, y no resuelve el mixto en el
    momento de la compra.

| #   | Cambio                        | Detalle                                                                                                                                                                                                                                                        | Pedido    |
| --- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 3.1 | **Pagar la compra en partes** | La opción A de arriba. Reemplaza al viejo "abono al crear la compra". Cada pago entra en `pagos_cuenta` con su fecha y su método, que es justo lo que el cierre ya sabe contar (los 6 sitios de compras). No se agrega ningún camino nuevo de plata al cierre. | Mixto, R6 |
| 3.2 | **Gasto a crédito**           | La caja menor acepta **Crédito**. Un gasto que se debe, como el arreglo de la camioneta de $ 3.939.000, queda en Cuentas por Pagar y no toca el cierre hasta el día en que se paga. **Mixto en caja menor: no.** Ella aceptó dos registros.                    | R4        |
| 3.3 | **Pago con la fecha real**    | Registrar pago acepta la fecha en que salió la plata, hasta **30 días** atrás (decisión de David). Si ese día ya tiene cierre guardado, la app avisa y usa el **cierre complementario** que ya existe. Lo mismo para los cobros.                               | R6        |
| 3.4 | **"Mercancía pendiente"**     | Cuentas por Pagar marca las compras que no se han recibido, con un botón para recibirlas o contarlas.                                                                                                                                                          | R6        |

**Riesgo:** alto, porque toca la plata. El 3.1 y el 3.3 cambian lo que cuenta el
cierre en un día. Se verifica con el patrón de siempre: cierre del día antes y
después, dentro de `BEGIN … ROLLBACK`, y que el mismo peso no se cuente dos veces. En
el 3.1 hay que probar sobre todo que la compra en partes, con retenciones, cuadre:
pagos ≤ total − retenciones, igual que el saldo de CxP.

---

### Bloque 4. Retenciones a la vista

**Por qué:** el cálculo ya está bien, pero las pantallas donde ella revisa la plata no
muestran la retención, y por eso siente que no hay claridad.

| #   | Cambio                             | Detalle                                                                                                                                             |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | **Detalle de la venta**            | El mismo desglose que ya tiene el recibo impreso: cada retención con su porcentaje y el neto.                                                       |
| 4.2 | **Cierres** (Admin y vendedoras)   | Una línea: _"Vendido $ X − retenciones $ Y = entró $ Z"_, y lo mismo para compras. **Solo se muestra**: los totales de plata del cierre no cambian. |
| 4.3 | **Informe de retenciones del mes** | Separado en _"nos retuvieron"_ (ventas y OT) y _"retuvimos"_ (compras), por tipo de retención y por tercero, exportable a Excel para el contador.   |

**Riesgo:** bajo para la plata, porque no cambia ningún cálculo. Se verifica que el
cierre dé exactamente lo mismo antes y después.

---

### Bloque 5. Órdenes de trabajo y cierres

**Lo que mostraron las respuestas:** de las 21 OT viejas sin plata, **11 tienen el
equipo del cliente en el almacén esperando**. Por ejemplo, la OT 74 (Don Nelson, no
tiene plata), la 171 y la 172 (dos compactos quemados que el cliente no recoge) o la
185 (el cliente está incapacitado). Otras dos ya se mandaron a bodega para chatarra.
Nada de esto se ve en ninguna pantalla, y la alerta que debería avisarlo está muerta
(se arregla en el 1.4).

**5.0. Decisión de David antes del spec: cómo se cierra un equipo abandonado.**

- **A. Estado nuevo `abandonada` (recomendada).**
  - Es un estado final que no es "cancelada", así que **los abonos siguen contando en
    el cierre**. Si el cliente pagó la revisión, esa plata entró de verdad.
  - Solo lo pone el Admin, con motivo, y queda la sede donde se dejó el equipo.
  - La alerta del 1.4 ofrece el botón directamente.
- **B. Cancelar con el motivo "abandonado".**
  - No necesita estado nuevo.
  - Pero una OT con abonos no se puede cancelar sin sacar la plata del cierre, y la
    revisión cobrada desaparecería.

| #   | Cambio                               | Detalle                                                                                                                                                                                                                                                                                                                                                                    | Pedido |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 5.1 | **OT pagadas en un día**             | Filtro _"Pagadas el día…"_ en el historial de OT, que busca por la fecha del abono y no por la de la orden. En el cierre, la lista de abonos del día con número de OT y cliente.                                                                                                                                                                                           | W5     |
| 5.2 | **Cierre de las vendedoras por día** | Un selector de día además de los botones que ya tienen.                                                                                                                                                                                                                                                                                                                    | W2     |
| 5.3 | **Equipos esperando al cliente**     | Una lista de "equipos en el almacén" por sede, con días de espera y el último contacto, y la acción **Marcar abandonado** según la decisión 5.0. Cuando quede, se cierran ahí la 144 y la 170. "OT esperando repuesto" se resuelve aquí: la OT 198 es exactamente ese caso (autorizada, sin repuestos), así que el estado tiene sentido y se le da uso en vez de quitarlo. | R2, H5 |

**Riesgo:** bajo en 5.1 y 5.2. El 5.3 agrega un valor al enum `estado_orden` y toca el
flujo de OT (`ot-flujo.js`, `OrdenDetalle.jsx`, `StatusBadge`). Hay que revisar cada
`switch` y cada filtro por estado para que el valor nuevo no caiga en "abiertas" ni
desaparezca de los cierres.

---

### Bloque 6. Impresiones

**Comprobante de egreso de caja menor**, en media carta: fecha, concepto, categoría,
monto en número y en letras, quién lo pagó, y una línea para la firma de quien recibe
la plata. Se hace con el mismo mecanismo que ya usa la remisión de traslados (un
documento que solo aparece al imprimir), que es el formato que a ella le gusta. (R5)

**Riesgo:** bajo.

---

### Bloque 7. Guía de novedades

Al terminar los bloques 1 a 6, una guía de novedades con el mismo formato (artifact
primero, luego PDF) que cuenta lo que cambió y **actualiza los pasos del bloque 0** que
se volvieron más cortos: el mínimo desde la ficha, pagar en partes desde la compra,
comprar para otra sede y equipos abandonados.

---

## 4. Estado de las preguntas (17 oct)

**Contestadas:**

| #   | Pregunta                    | Respuesta                                                                                             | Dónde se usa |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------- | ------------ |
| 4   | ¿El destino es obligatorio? | Opcional para el Admin; obligatorio para vendedoras y Bodega, en OT, ensambles y préstamos            | Bloque 2     |
| 7   | Mixto en caja menor         | Dos registros, uno por forma de pago. En compras, igual                                               | Bloque 0 y 3 |
| 3   | OT sin plata                | Contestaron CV y CHV, OT por OT (detalle en `requerimientos-clienta.md`, Parte 3)                     | Bloque D y 5 |
| 2   | OT 23, 32, 185              | 23: cancelar (decisión de David). 32: hecha a mano, falta el valor. 185: el equipo está en el almacén | Bloque D     |

**Sin respuesta todavía:**

1. **Deyanira:** ¿la venta #2284 (aceite AM501/4, $ 35.000, 15 sep) fue un segundo
   aceite o el mismo pago registrado dos veces? Respondieron que FURGONES "todavía
   debe $ 35.000", pero eso no aclara la #2284.
2. **Sofía (L3):** OT 39 (abono de $ 288.000), 78, 79, 83, 108 y 181.
3. **BODEGA:** OT 68.
4. **OT 32:** el valor final del trabajo.
5. **OT 10, 11, 14 y 15** del 3 de junio: ¿fueron de práctica?
6. **Caja menor #1211** (RUBIELA, $ 291.400, "ABONO A FACTURA"): ¿también es la
   polisombra?

**Decisiones de David, no de ella:**

- **3.0:** cómo resolver que las vendedoras paguen compras en partes. Recomendada la A.
- **5.0:** cómo se cierra un equipo abandonado. Recomendada la A.
- **30 días** hacia atrás para registrar pagos: ya decidido.

**Resueltas con datos, no se le preguntaron:**

- **Llaves de bola #1170:** sí llegaron. Bodega mandó 52 entre el 6 y el 16 de octubre
  y las sedes las recibieron. Conviene contar las 308 que quedan en BODEGA. El abono
  no quedó contado dos veces: el 3 de octubre no tiene cierre y la caja menor #1153
  está cancelada.
- **RUBIELA y CRISTIAN (H1 descartado):** son pagos de la **polisombra de la bodega**
  (#1206, #1210, #1247 y, probablemente, #1211), no abonos de mercancía. Es un gasto
  de verdad.
- **Descuento en compras:** está bien calculado y se explica en la guía.

---

## 5. Qué queda fuera, a propósito

- **Botón Mixto en caja menor:** ella aceptó dos registros.
- **Que el usuario de Bodega de Faiber venda:** David le dijo que no.
- **Descuento por producto o en porcentaje en compras:** nadie lo ha pedido con un
  caso concreto.
- **Distinguir "no se vende aquí" de "sin configurar"** en el mínimo: útil, pero no
  urgente.

---

## 6. Siguiente paso

En paralelo:

1. **Spec del bloque 0** (la guía), después de probar las dos filas que faltan: dos
   pagos a la misma compra y anular venta.
2. **Ensayo del bloque D** en `ROLLBACK`, con la tabla de antes y después para que
   David la apruebe.
3. **Spec del bloque 1**, incluido el 1.10.

Las decisiones 3.0 y 5.0 se necesitan antes de los specs de esos bloques, no antes.
