# Manual del Panel de Administrador — Compresores del Valle

_Guía completa, explicada paso a paso, de cada pantalla del Panel de Administrador. Está pensada para leerse con calma la primera vez, y usarse después como referencia rápida cuando tengas una duda puntual._

**Cómo usar este manual:** no necesitas leerlo de corrido. Cada sección es independiente. Si tienes una duda sobre "Reorden", ve directo a esa sección. Cada una tiene: qué es, qué ves al entrar, cómo se usa paso a paso, cuándo usarla, y las cosas importantes que debes tener presentes.

**Quién puede ver el Panel de Administrador:** solo el usuario con rol **Admin** (Carlos) tiene acceso a todas estas pantallas. Los demás roles (Bodeguero, Vendedor, Técnico) trabajan en la parte operativa de la app (ventas, inventario, órdenes, etc.) y no ven este panel — salvo dos excepciones puntuales que se explican en la sección de **Conteo cíclico**, donde el Bodeguero sí participa dentro de su propia sede.

---

## Índice

1. [Visión general](#1-visión-general)
   - [Dashboard](#dashboard)
   - [Alertas](#alertas)
2. [Análisis y reportes](#2-análisis-y-reportes)
   - Análisis ABC
   - Top 10
   - Reorden (y el asistente de mínimos/máximos)
   - Slotting
   - Auditoría
   - Cierres
3. [Operación administrativa](#3-operación-administrativa)
   - Conteo cíclico
   - Notas crédito
   - Cuentas por cobrar y pagar
   - Configuración
   - Usuarios

---

# 1. Visión general

## Dashboard

### Qué es y para qué sirve

El Dashboard es la primera pantalla que ves al entrar al Panel de Administrador. Es como el **tablero de mando de un carro**: de un vistazo te dice cómo va el negocio hoy, sin que tengas que ir módulo por módulo a buscar la información. Está pensado para revisarlo todos los días, incluso varias veces al día, porque se actualiza solo.

### Qué encuentra al entrar

**La fila de 4 números grandes (arriba del todo):**

1. **Ventas · [Hoy / Semana / Mes]** — el total en pesos de lo que se ha vendido, en el periodo que elijas con los botones de al lado (puedes cambiar entre "Hoy", "Semana" o "Mes"). Debajo del número aparece una flechita verde (▲) o roja (▼) comparando las ventas de **hoy contra las de ayer** — por ejemplo "▲ 12.3% vs ayer" significa que hoy vas 12.3% mejor que ayer a la misma hora. Si ayer no hubo ventas, en vez de la flecha dice "sin referencia" (no se puede calcular un porcentaje contra cero).

   > **Importante:** este número de "Ventas" cuenta solo las ventas hechas directamente en el mostrador (venta normal). **No incluye el dinero que entra por Órdenes de Trabajo (reparaciones/servicios)** — ese dinero aparece por separado, ver el punto 3 de esta lista. Esto es intencional: evita contar el mismo ingreso dos veces.

2. **Egresos del mes** — el total en pesos de las compras que has hecho a proveedores este mes (sin contar compras canceladas).

3. **Margen del mes** — una cuenta simple: (ventas directas del mes + ingresos por servicios/OT del mes) − egresos del mes. Si el número sale en rojo, significa que este mes has gastado más de lo que ha entrado — vale la pena revisar por qué.

4. **Valor inventario** — cuánto valen, en pesos, todos los productos que tienes hoy en existencia (se calcula con el costo promedio de cada producto). Debajo te dice cuántos productos activos tiene tu catálogo en total.

**Bloque "Atención requerida" (con el triángulo rojo):**

Es la lista de los 5 productos más urgentes que están en **stock bajo** o **agotados**, ordenados por gravedad (primero los agotados). Cada línea te dice el nombre del producto y en qué sede está bajo. Si no hay ninguno, verás un mensaje tranquilizador: "Sin alertas de stock activas ✓". Abajo tienes un enlace "Ver todas las alertas" que te lleva al módulo de Alertas si quieres ver la lista completa (no solo el top 5).

**Los tres bloques de "atención" (2x2, debajo de las alertas):**

- **Productos en alerta** — muestra hasta 3 productos con stock bajo/agotado (con su sede, categoría, cuánto tiene vs. cuánto debería tener mínimo). Tiene un enlace directo a "Reorden" para decidir qué comprar.
- **OTs en proceso** — muestra hasta 3 Órdenes de Trabajo (reparaciones) que están abiertas ahora mismo, con el técnico asignado y cuántos días lleva abierta esa orden (si lleva mucho tiempo, se resalta). Enlace directo a "Órdenes de Trabajo". _Ojo:_ el número grande del contador ("9", por ejemplo) cuenta **todas** las OT que no están entregadas ni canceladas (incluye recién recibidas y ya terminadas esperando que el cliente las recoja), mientras que las 3 filas de detalle solo muestran las que están literalmente "en proceso" o "esperando repuesto" — por eso el contador puede ser más alto que lo que ves listado ahí abajo. Para el detalle completo de las terminadas sin recoger, usa la pestaña correspondiente en **Alertas**.
- **Cotizaciones por vencer** — muestra hasta 3 cotizaciones que están por vencerse pronto (cada cotización tiene un número de días de vigencia). Enlace directo a "Cotizaciones".
- **Actividad reciente** — un mini-historial de los últimos movimientos de inventario de toda la empresa: ventas, compras, traspasos entre sedes, ajustes de conteo, ensambles, etc., con quién lo hizo y a qué hora. Es un adelanto de lo que verás con más detalle en "Auditoría".

**Las dos gráficas:**

- **Tendencia ventas — últimos 7 días** — una gráfica de línea que muestra cuánto vendiste cada uno de los últimos 7 días. Sirve para ver de un vistazo si las ventas están subiendo, bajando, o si hubo algún día raro (por ejemplo un domingo con ventas en cero).
- **Ventas por sede — mes actual** — una gráfica de barras horizontales comparando cuánto ha vendido cada sede (BODEGA, CV, CHV, L3) en lo que va del mes. Te ayuda a ver qué sede está jalando más o menos.

**Top 5 productos del mes:**

Una lista de los 5 productos que más unidades se han vendido este mes, con el total en pesos que representó cada uno. Útil para saber qué se está moviendo más ahora mismo.

### Cómo se usa paso a paso

1. Entra al Panel de Administrador — el Dashboard es la pantalla que se abre por defecto.
2. Mira primero la fila de 4 números para tener el panorama general del día/mes.
3. Si ves el número de "Margen del mes" en rojo, o alertas en el bloque rojo, haz clic en el módulo correspondiente para investigar (Reorden si es stock, Cierres si es dinero).
4. Usa los botones "Hoy / Semana / Mes" arriba a la derecha para cambiar el periodo que ves en el KPI de Ventas.
5. Usa el botón "Refrescar" si quieres forzar una actualización inmediata (aunque la pantalla ya se actualiza sola cada minuto mientras la tengas abierta).
6. Haz clic en cualquier producto/orden/cotización de los bloques de atención para ir directo a esa pantalla y resolverlo.

### Cuándo usarla

- **Cada mañana**, como primer vistazo antes de empezar el día, para saber si algo necesita atención urgente.
- **Antes de una reunión o de tomar una decisión de compra**, para tener los números frescos.
- **Cuando quieras saber "¿cómo vamos este mes?"** sin tener que ir a revisar Cierres o Reorden por separado.

### Cosas importantes a tener en cuenta

- El Dashboard se **actualiza solo cada 60 segundos** mientras la pestaña esté abierta y visible (si cambias de pestaña del navegador, deja de refrescar automáticamente hasta que vuelvas).
- La flecha de comparación (▲/▼) siempre compara **hoy contra ayer**, no importa qué periodo tengas seleccionado en el filtro de arriba.
- Recuerda: **"Ventas" no incluye las ventas de repuestos dentro de una Orden de Trabajo** — esas entran como "ingresos por servicios" en el cálculo del margen, para no duplicar el ingreso. Si un mes hiciste muchas reparaciones y pocas ventas de mostrador, es normal que el número de "Ventas" se vea bajo aunque el negocio haya ido bien — mira el "Margen del mes", que sí suma ambos.
- Si ves "Sin datos para mostrar" en una gráfica, simplemente significa que no hubo ventas en ese periodo — no es un error.

---

## Alertas

### Qué es y para qué sirve

Es el **centro de avisos** de todo el negocio: una sola pantalla donde ves, organizados por pestañas, todos los temas que requieren tu atención — stock bajo, herramientas que no han devuelto, órdenes esperando repuestos, órdenes terminadas que el cliente no ha recogido, productos que sobran o que casi no se venden. Piénsalo como tu lista de pendientes generada automáticamente por el sistema.

### Qué encuentra al entrar

Arriba, un contador grande de cuántas alertas están activas en total. Debajo, **7 pestañas**, cada una con su propio contador (en rojo si hay algo pendiente, en gris si está en cero):

1. **Stock bajo / agotado** — productos cuyo stock llegó al mínimo o se acabó. Muestra producto, sede, cuánto hay vs. cuánto debería haber de mínimo, y un botón para ir a "Reorden".
2. **Herramientas vencidas** — herramientas prestadas a algún trabajador que ya deberían haberse devuelto (según la fecha esperada) y no se han devuelto. Muestra a quién se le prestó, hace cuántos días venció, y un botón para ir al módulo de Herramientas.
3. **OT esperando repuesto** — Órdenes de Trabajo que están detenidas porque falta un repuesto para poder seguir reparando. Muestra el cliente, el equipo, el técnico asignado, y un botón para abrir la orden.
4. **OT > 30 días sin recoger** — órdenes ya **terminadas** hace más de 30 días que el cliente todavía no ha ido a recoger. Muestra el teléfono del cliente (para que lo puedas llamar), cuánto llevaba abonado (si abonó algo), y cuántos días lleva esperando.
5. **Sobre-stock** — productos que tienen existencias pero que **no se han vendido nada** en los últimos 30 días. Es dinero quieto en la bodega.
6. **Mayor rotación** — el top 10 de productos que más se han vendido en los últimos 30 días. No es exactamente una "alerta" de problema, sino información útil de qué se está moviendo mejor.
7. **Menor rotación** — productos que sí tienen ventas en los últimos 30 días pero muy pocas, comparado con el resto. Ayuda a detectar productos "flojos" para revisar precio o promoción.

**Filtros arriba de la lista:**

- **Filtro de sede** (solo aparece si hay más de una sede con datos en el conjunto de alertas cargado — no depende solo de la pestaña que tengas abierta en ese momento): te deja ver solo BODEGA, o solo CV, etc.
- **Filtro de prioridad**: Todas / Urgente / Alta / Media — para quedarte solo con lo más grave si la lista es larga.

A la derecha de los filtros hay un contador con el formato "**N resultados · M urgentes**" que te dice, sin tener que contar manualmente, cuántas filas cumplen el filtro actual y cuántas de esas son urgentes.

Cada fila trae un **punto de color y una etiqueta de prioridad** (Urgente = rojo, Alta = naranja, Media = azul claro) para que sepas de un vistazo qué atender primero.

### Cómo se usa paso a paso

1. Entra a Alertas desde el menú lateral ("Alertas", bajo "Visión general") o desde el enlace del Dashboard.
2. Haz clic en la pestaña del tema que te interesa revisar (por defecto abre en "Stock bajo/agotado").
3. Si quieres acotar la lista, usa los filtros de sede y/o prioridad arriba.
4. Haz clic en el botón de acción de cada fila (por ejemplo "Reorden", "Ver", "Abrir OT") para ir directamente a resolver ese pendiente en el módulo correspondiente — Alertas en sí mismo **no resuelve nada**, solo te avisa y te lleva al lugar correcto.
5. Usa el botón "Refrescar" arriba a la derecha si quieres forzar que vuelva a consultar todo.

### Cuándo usarla

- **Al iniciar el día**, como rutina de "barrido" de pendientes, antes o después de revisar el Dashboard.
- **Cuando alguien pregunta "¿tenemos ese producto disponible?"** y quieres confirmar rápido si está en alerta de stock bajo en alguna sede.
- **Una vez por semana**, revisa "OT > 30 días sin recoger" para llamar a esos clientes — es dinero (y espacio en el taller) esperando.
- **Cuando quieras liberar espacio o revisar precios**, mira "Sobre-stock" y "Menor rotación" para decidir promociones o dejar de reordenar esos productos.
- **Antes de prestar una herramienta nueva**, revisa "Herramientas vencidas" para saber si hay que presionar por la devolución de otras primero.

### Cosas importantes a tener en cuenta

- Alertas **no tiene botón para "marcar como resuelto" ni para ignorar** una alerta — desaparece sola de la lista en cuanto la causa raíz se soluciona (por ejemplo, en cuanto entra stock nuevo del producto, o en cuanto el cliente recoge la OT).
- Los umbrales de qué cuenta como "stock bajo" (el mínimo configurado por producto) se ajustan desde **Configuración → Parámetros** o directamente en la ficha de cada producto — no desde esta pantalla.
- La pestaña "OT > 30 días sin recoger" usa un número configurable (el parámetro "días para alerta de OT abandonada" en Configuración → Parámetros, 30 por defecto) — si alguien lo cambia, la pestaña sigue mostrando el texto fijo "OT > 30 días" aunque en realidad esté avisando con el nuevo número de días.
- En las pestañas "Mayor rotación", "Menor rotación" y "Sobre-stock" verás etiquetas descriptivas propias ("Alta", "Baja", "Revisar") en vez de "Urgente/Alta/Media" — describen la fila, no necesariamente coinciden con el nombre exacto del filtro de prioridad que las agrupa por dentro.
- "Sobre-stock" y "Menor/Mayor rotación" siempre miran los **últimos 30 días fijos** (no se puede cambiar el rango desde aquí).
- Si una pestaña muestra el ícono/mensaje de vacío (ej. "✅ No hay stock bajo ni agotado"), es una buena noticia, no un error de carga.

---

# 2. Análisis y reportes

## Análisis ABC

### Qué es y para qué sirve

Es una foto de qué tan importante es cada producto para las ventas de la empresa. Imagina que ordenas todos tus productos de mayor a menor según cuánta plata han generado, y luego los agrupas en tres grupos: los que representan la mayoría del dinero (A), los que aportan una porción media (B), y una "cola larga" de productos que casi no mueven plata pero son muchos (C). Esta pantalla te muestra ese ordenamiento para que sepas dónde poner más atención (contratos con proveedores, control de stock más estricto) y dónde puedes relajarte o incluso liquidar inventario que no se vende.

La clasificación A/B/C se recalcula sola una vez al mes (a las 00:00 hora Colombia del día 1, es decir la madrugada de ese día), usando las ventas de los últimos 90 días (ventas directas y también repuestos usados en Órdenes de Trabajo). También hay un botón para forzar el recálculo en cualquier momento.

### Qué encuentra al entrar

- Un selector de periodo arriba a la derecha ("Último mes", "Último trimestre", "Último año"): cambia qué ventana de ventas se usa para mostrar los montos e ingresos en la tabla (esto es solo para visualizar, no cambia la clasificación A/B/C en sí, que siempre usa 90 días).
- Botón "Recalcular ABC": vuelve a correr la clasificación de todos los productos ahora mismo, en vez de esperar al día 1 del mes. Pide confirmación antes de ejecutar (puede tardar varios segundos porque revisa miles de productos).
- Cuatro tarjetas de resumen (KPIs) arriba:
  - **Ingresos** del periodo seleccionado y cuántos productos (SKUs) están clasificados en total.
  - **Clase A · alto valor**: qué porcentaje de los ingresos totales representa la clase A, cuántos productos son, y su valor en pesos.
  - **Clase B · medio**: lo mismo para la clase intermedia.
  - **Clase C · cola larga**: lo mismo para la clase de bajo valor, candidatos a liquidar.
- Pestañas de filtro: "Todas", "Clase A", "Clase B", "Clase C" (cada una muestra cuántos productos tiene).
- La tabla con columnas:
  - **#** y la letra de clase (A/B/C) en un cuadrito de color (verde=A, naranja=B, rojo=C).
  - **Referencia**: el código del producto.
  - **Producto · categoría**: nombre y categoría.
  - **Ventas**: cuánto ha vendido ese producto en el periodo elegido, en pesos.
  - **Unidades**: cuántas unidades se han vendido.
  - **% acum.**: porcentaje acumulado de ventas hasta esa fila (así se entiende visualmente por qué un producto quedó en A, B o C — es la misma matemática de la regla 80/20).
  - **Sugerencia**: un texto fijo según la clase, por ejemplo para clase A dice "Alto valor · control estricto · revisar contrato proveedor"; para B "Valor medio · control moderado · mantener"; para C "Cola larga · control simple · candidato a liquidar". No es una recomendación calculada producto por producto, es una política general por clase.
- En celular se ve como tarjetas apiladas en vez de tabla, con la misma información resumida.

### Cómo se usa paso a paso

1. Entra a la pantalla; carga automáticamente todos los productos activos con su clasificación actual.
2. Si quieres ver un periodo distinto de ventas (mes, trimestre, año), usa el selector de arriba a la derecha.
3. Usa las pestañas para mirar solo la clase A, B o C si quieres enfocarte en un grupo.
4. Revisa la tabla ordenada de mayor a menor venta, con el porcentaje acumulado para entender el peso de cada producto.
5. Si quieres forzar que el sistema recalcule las clases ya (por ejemplo, después de una temporada fuerte de ventas), pulsa "Recalcular ABC", confirma en el cuadro de diálogo, y espera unos segundos.

### Cuándo usarla

- Al inicio de mes, para revisar cómo quedó la clasificación después del recálculo automático.
- Antes de negociar con un proveedor de un producto clase A (para saber que vale la pena cuidar ese contrato).
- Para identificar candidatos a liquidar o descontinuar (clase C que ocupa espacio en bodega pero no vende).
- Antes de decidir en qué productos invertir más plata de inventario.

### Cosas importantes a tener en cuenta

- La clasificación ABC (A/B/C) siempre se basa en 90 días de ventas, sin importar qué periodo elijas ver en pantalla — el selector de periodo solo cambia los montos que ves en la tabla, no la letra de clase asignada.
- El recálculo manual puede tardar y tiene un límite de 30 segundos; si se demora más, verás un mensaje de error pidiendo contactar soporte (no significa que algo se dañó, solo que hay que reintentar o revisar con más calma).
- No hay botones de "editar" en esta pantalla: es solo de consulta. Para cambiar el stock mínimo/máximo de un producto según su clase, hay que ir a la pantalla de "Reorden".
- Cualquier usuario Admin puede recalcular. No hay diferencia de permisos dentro de esta pantalla más allá de que solo el Admin tiene acceso a ella.

---

## Top 10

### Qué es y para qué sirve

Es un cuadro de honor: te muestra quiénes o qué son los "mejores" en cuatro categorías distintas — Productos, Clientes, Categorías y Proveedores — durante el periodo que elijas. Es útil para responder rápido preguntas como "¿cuál es mi producto estrella?", "¿quién es mi mejor cliente?" o "¿a qué proveedor le estoy comprando más?".

### Qué encuentra al entrar

- Selector de periodo arriba a la derecha: Último mes, Último trimestre, Último año.
- Cuatro pestañas con ícono: **Productos**, **Clientes**, **Categorías**, **Proveedores**. Cada una cambia todo el contenido de la pantalla.
- Cuatro tarjetas de resumen (KPIs) que cambian según la pestaña activa:
  - Total vendido (o comprado, si estás en la pestaña Proveedores) del Top 10 en el periodo.
  - Unidades totales sumadas del ranking.
  - Ticket promedio (ingreso o costo por unidad).
  - Número de transacciones (o de órdenes de compra, en Proveedores).
- La lista del Top 10, cada fila muestra:
  - Posición numerada (1 al 10), con medalla 🥇🥈🥉 para los primeros tres lugares.
  - Nombre del producto/cliente/categoría/proveedor, y un subtítulo con la referencia (solo en la pestaña Productos).
  - En pantallas grandes: monto vendido/comprado, unidades (si aplica) y "Var. vs ant." — la variación porcentual comparada con el periodo anterior equivalente (por ejemplo, si ves "Último mes", compara contra el mes anterior a ese). Si no hay datos del periodo anterior para comparar, se muestra un guion "—" en vez de inventar un número.
  - Una barra de progreso debajo de cada fila, que representa visualmente qué tan grande es ese valor comparado con el primer lugar del ranking.
- Una barra inferior que recuerda el periodo activo y cuántos elementos hay en el ranking (hasta 10).

### Cómo se usa paso a paso

1. Entra a la pantalla; por defecto ves el ranking de Productos del último mes.
2. Cambia de pestaña para ver Clientes, Categorías o Proveedores.
3. Cambia el periodo si quieres ver el trimestre o el año.
4. Revisa la variación (flecha/porcentaje) para saber si ese producto/cliente está creciendo o cayendo respecto al periodo anterior.
5. Es una pantalla de solo consulta — no hay botones de acción, solo información para tomar decisiones (por ejemplo, negociar con el cliente top, o revisar por qué cayó un producto).

### Cuándo usarla

- Reuniones mensuales de revisión de ventas, para presentar los productos y clientes más importantes.
- Cuando quieras saber si vale la pena dar un trato especial (descuento, prioridad de stock) a un cliente frecuente.
- Para evaluar proveedores: ver a cuáles les compras más y decidir si negociar mejores condiciones.
- Para detectar categorías de producto que están creciendo o cayendo mes a mes.

### Cosas importantes a tener en cuenta

- La pestaña **Proveedores** mide _compras_ (plata que la empresa gasta), no ventas — por eso los textos cambian ("Compras" en vez de "Ventas", "Órdenes de compra" en vez de "Transacciones"). Es fácil confundirse si no se lee el encabezado.
- La variación porcentual ("Var. vs ant.") puede aparecer como "—" cuando no hay suficiente historial en el periodo anterior para comparar; esto no es un error, es que el sistema prefiere no inventar un número sin base real.
- No hay forma de editar nada desde aquí ni de exportar; es un tablero de consulta.
- Los nombres de clientes vacíos se agrupan bajo "Consumidor final", y los proveedores sin nombre bajo "Sin proveedor" — si ves mucho volumen ahí, vale la pena revisar que se esté registrando bien el nombre del cliente/proveedor al hacer la venta o la compra.
- A diferencia del KPI "Ventas" del Dashboard (que excluye las ventas de Órdenes de Trabajo), **las cuatro pestañas de Top 10 sí incluyen las ventas hechas dentro de una OT** — no hay inconsistencia entre las cuatro, solo con el Dashboard.
- En periodos largos ("Último año") con mucho volumen de ventas, el cálculo trae un límite interno de filas para no sobrecargar la consulta; en un negocio con miles de transacciones al año esto en teoría podría dejar alguna fuera del ranking, aunque es poco probable que afecte el Top 10 real en la práctica.

---

## Reorden (y el asistente de mínimos/máximos)

### Qué es y para qué sirve

Esta es la pantalla que te dice "esto se está por acabar, hay que comprar más". Compara el stock actual de cada producto contra el mínimo que configuraste, y si está por debajo, aparece aquí con una cantidad sugerida de cuánto pedir. Además, incluye un asistente inteligente que calcula automáticamente cuál debería ser el mínimo y el máximo de stock de cada producto, basado en cuánto se ha vendido o consumido realmente en los últimos 90 días — así no tienes que adivinar esos números a ojo.

### Qué encuentra al entrar

- Título "Reorden" con un contador de cuántos SKUs (productos) están actualmente por debajo de su mínimo.
- Botón **"Sugerir min/max"** (solo visible para el Admin): abre el asistente para calcular y aplicar mínimos/máximos sugeridos (ver más abajo).
- Botón **"Nueva compra"**: te lleva directo al flujo normal de crear una orden de compra.
- Cuatro tarjetas de resumen (KPIs):
  - **SKUs en reorden**: cuántos productos están bajo su mínimo.
  - **Agotados**: cuántos de esos ya están en cero (en rojo si hay alguno) — reposición urgente.
  - **Clase A en alerta**: cuántos de los productos en reorden son clase A (alto valor) — prioridad alta porque son los que más venden.
  - **Valor total estimado**: cuánto costaría comprar todo lo sugerido en esta lista.
- Un aviso amarillo (si aplica) que dice cuántas referencias agotadas **no aparecen** en la lista porque no tienen mínimo configurado todavía — es un recordatorio de que hay que configurarles mínimo/máximo para que el sistema las empiece a vigilar.
- Filtro por sede (si hay más de una sede con sugerencias): para ver solo los faltantes de una bodega/almacén específico.
- Una barra de selección: muestra cuántos productos tienes marcados y su valor total, con el botón **"Generar OC"** (Orden de Compra) que te lleva al flujo de Nueva compra con esos productos ya preseleccionados.
- La tabla de sugerencias, con columnas:
  - Casilla de selección (para elegir cuáles vas a comprar).
  - Producto (nombre + referencia).
  - **ABC**: la letra de clase (A/B/C) con su color.
  - **Sede**: en qué bodega/almacén está el faltante.
  - **Estado**: una etiqueta de color — "Agotado" en rojo (cero unidades) o "Stock bajo" en naranja (por debajo del mínimo pero no en cero).
  - **Stock**: cantidad actual (en rojo si agotado, naranja si bajo).
  - **Mínimo**: el mínimo configurado para ese producto.
  - **Sugerido**: cuántas unidades sugiere comprar el sistema.
  - **Costo est.**: costo estimado de comprar esa cantidad sugerida.
  - Al final, un total del valor estimado de toda la compra sugerida.
- En celular, la misma información en tarjetas con casilla de selección grande.

### Cómo se usa paso a paso (pantalla principal)

1. Entra y revisa el listado de productos bajo su mínimo, ordenado con los datos más críticos primero (Agotado en rojo destaca).
2. Si quieres enfocarte en una sola sede, usa el filtro de sede.
3. Marca las casillas de los productos que quieres comprar ahora (o usa la casilla del encabezado para marcar todos los visibles).
4. Revisa el valor total de tu selección en la barra que aparece arriba de la tabla.
5. Pulsa **"Generar OC"**: te lleva a la pantalla de Nueva compra con esos productos ya cargados, listos para ajustar cantidades/proveedor y confirmar.

### Cómo se usa paso a paso (asistente "Sugerir min/max")

Este es un modal (ventana emergente) que solo puede abrir el Admin, pulsando el botón "Sugerir min/max":

1. Al abrirse, el sistema calcula automáticamente, para los productos que sí tuvieron demanda en los últimos 90 días (ventas + consumo en Órdenes de Trabajo + consumo en Ensambles), cuál debería ser su mínimo y máximo ideal. Un producto sin ningún movimiento en ese periodo no aparece en el asistente — si no hay ninguno con demanda, verás el aviso "Sin demanda registrada en el periodo".
2. Arriba del modal ves tres parámetros que puedes ajustar, con sus valores por defecto:
   - **Lead time (días)**: cuántos días tarda en llegar un pedido (por defecto 7). Si tus proveedores se demoran más, sube este número para tener más colchón de stock mínimo.
   - **Factor de seguridad** (por defecto 1.5): un multiplicador extra de seguridad para cubrir imprevistos en la demanda.
   - **Máx = mín ×** (por defecto 3): el stock máximo se calcula como el mínimo multiplicado por este factor.
   - Puedes cambiar estos números y pulsar **"Recalcular"** para que el sistema vuelva a calcular todas las sugerencias con los nuevos parámetros. Esto guarda esos parámetros para toda la empresa (no es solo para ti), así que aplica para todos los usuarios de aquí en adelante hasta que alguien los cambie de nuevo.
3. Debajo hay un interruptor (checkbox) **"Solo sin configurar"**, activado por defecto: al estar marcado, solo ves los productos que **todavía no tienen** mínimo/máximo configurado manualmente. Si lo desmarcas, ves también los que ya tienen configuración (marcados con la etiqueta "Configurado").
4. La tabla de sugerencias muestra por producto: su clase ABC, la demanda de 90 días, el mínimo/máximo actual (si tiene), el mínimo/máximo sugerido, y si ya está "Configurado".
5. Por defecto, el sistema **preselecciona automáticamente solo los productos que NO tienen configuración todavía** — esto protege los valores que tú (o alguien) ya ajustó manualmente, para no sobrescribirlos sin querer. Puedes marcar/desmarcar productos individualmente, o usar la casilla del encabezado para marcar/desmarcar todos los que están visibles en ese momento.
6. Cuando estés conforme con la selección, pulsa **"Aplicar seleccionados"** abajo. Aparece un cuadro de confirmación indicando a cuántos productos se les va a actualizar el mínimo y el máximo.
7. Al confirmar, el sistema actualiza el mínimo y máximo de cada producto seleccionado con los valores sugeridos, y te avisa cuántos productos se actualizaron (el mensaje se queda ahí en el modal — la pantalla de Reorden ya se refrescó detrás, pero el modal no se cierra solo).
8. Cierra el modal con la "X" arriba a la derecha cuando quieras (antes o después de aplicar, sin perder nada).

### Cuándo usarla

- Todos los días o cada pocos días, para saber qué comprar antes de quedarse sin stock.
- Cuando estés armando la orden de compra semanal/quincenal.
- El asistente de min/max: úsalo quincenal o mensualmente para revisar y ajustar los mínimos/máximos de productos nuevos o de los que aún no tienen configuración, y periódicamente (por ejemplo cada 2-3 meses) para refrescar los ya configurados si la demanda cambió mucho (temporada alta/baja).

### Cosas importantes a tener en cuenta

- Solo el **Admin** ve el botón "Sugerir min/max"; cualquier usuario con acceso a esta pantalla puede seleccionar productos y generar una orden de compra.
- Si aplicas las sugerencias de min/max **sin revisar**, corres el riesgo de sobrescribir un mínimo que alguien configuró a propósito por una razón especial (por ejemplo, un producto de temporada). Por eso el sistema protege por defecto los productos "ya configurados" y no los preselecciona — revisa manualmente antes de incluirlos si de verdad quieres cambiarlos.
- Los productos **agotados que no tienen mínimo configurado en absoluto no aparecen en la lista principal de Reorden** — el aviso amarillo te dice cuántos son. Es fácil pensar que "todo está bien" cuando en realidad hay faltantes invisibles por falta de configuración. Usa el asistente de min/max para configurarlos y que empiecen a aparecer.
- El color del **Stock** en la tabla (rojo = Agotado, naranja = Stock bajo) te dice de un vistazo la urgencia sin tener que leer el número.
- "Generar OC" no crea la compra automáticamente: te lleva al formulario de Nueva compra con los productos precargados, pero tú debes revisar cantidades, proveedor y confirmar.
- Si alguna vez el número de SKUs bajo el mínimo es tan grande que no caben todos en la lista, aparece un aviso amarillo arriba indicando cuántos se están mostrando de cuántos hay en total — así los KPIs de arriba nunca se ven completos sin que te avises.

---

## Slotting

### Qué es y para qué sirve

Slotting es literalmente "acomodar el estante". Esta pantalla compara qué tanto rota cada producto (cuánto se vende o se consume en los últimos 90 días) contra dónde está físicamente ubicado en la bodega, y te sugiere tres cosas: **asignarle una ubicación inicial** al producto que todavía no tiene ninguna, **subir** cerca de la puerta lo que más se mueve, y **bajar** al fondo lo que casi no rota. No necesitas asignar ubicación manualmente a cada producto antes de usar esta pantalla — Slotting ya te dice dónde ponerlo la primera vez.

### Qué encuentra al entrar

- Título "Slotting · Optimización de ubicaciones" con un contador de cuántas sugerencias hay, y una explicación corta de qué hace la pantalla.
- Filtro por sede (si hay sugerencias en más de una sede).
- Una casilla en el encabezado de la tabla para seleccionar todas las sugerencias visibles de una vez, y una casilla por fila para elegir sugerencias individuales.
- Cuando marcas al menos una, aparece una **barra de selección** arriba de la tabla con el conteo de seleccionadas y el botón **"Aplicar seleccionadas"** — pensado para aplicar de un tirón docenas o cientos de sugerencias sin tener que entrar fila por fila (con ~3.000 productos en el catálogo, revisar uno por uno no es práctico).
- La tabla de sugerencias, con columnas:
  - **Producto**: nombre y referencia.
  - **Sede**: en qué bodega/almacén.
  - **Demanda 90d**: cuánto se ha vendido/consumido en los últimos 90 días (el número que justifica la sugerencia).
  - **Actual → Sugerida**: si el producto ya tiene ubicación, un chip con el código actual; si todavía no tiene ninguna, el texto "Sin ubicación". Luego una flecha y el chip de la ubicación sugerida (con mapa visual de la bodega al tocarlo).
  - **Acción**: una etiqueta que dice **Asignar ubicación** (azul — el producto no tenía ubicación y se le da una por primera vez), **Subir** (naranja — acercarlo a la puerta porque rota mucho) o **Bajar** (gris — alejarlo porque casi no rota).
  - **Motivo**: el texto explicando la razón concreta de esa sugerencia.
  - Botón **"Aplicar"** al final de cada fila, para aplicar esa sugerencia sola (solo visible para Admin o Bodeguero).
- En celular, la misma información en tarjetas, con casilla de selección, las mismas etiquetas y el botón "Aplicar sugerencia" ocupando todo el ancho.

### Cómo se usa paso a paso

1. Entra a la pantalla; el sistema calcula automáticamente las sugerencias: para productos sin ubicación con ventas/consumo reciente, sugiere dónde ponerlos por primera vez; para productos que ya tienen ubicación, sugiere si conviene moverlos.
2. Si quieres aplicar sugerencias de a una, revísalas y pulsa **"Aplicar"** en la fila — te pide confirmar antes de mover/asignar.
3. Si quieres aplicar muchas de una vez (lo normal al empezar, con cientos de productos sin ubicación), marca las casillas de las que quieras aplicar (o usa la casilla del encabezado para marcar todas las visibles) y pulsa **"Aplicar seleccionadas"** en la barra de arriba. Un solo cuadro de confirmación te dice a cuántos productos se les va a asignar/mover la ubicación.
4. Al confirmar (individual o en lote), el sistema actualiza la ubicación de cada producto aplicado y esas filas desaparecen de la lista (ya se resolvieron).
5. Puedes ignorar sin problema las sugerencias que no tengan sentido para tu operación real (por ejemplo, si el espacio sugerido no es físicamente práctico por el tamaño del producto) — no hay obligación de aplicar todo.

### Cuándo usarla

- **Al empezar a usar esta función por primera vez**: revisa por sede (empezando por la que más movimiento tenga) y aplica en lote las sugerencias de "Asignar ubicación" — así arrancas con la bodega organizada sin tener que ir producto por producto desde la ficha de cada uno.
- Periódicamente (por ejemplo cada trimestre), para reajustar la bodega si cambiaron los productos que más rotan (temporada, nuevos productos estrella, etc.) — ahí sí verás sugerencias de "Subir"/"Bajar" entre productos que ya tienen ubicación.
- Cuando estés reorganizando físicamente la bodega y quieras un criterio objetivo (basado en ventas reales) de qué debería estar más a mano.

### Cosas importantes a tener en cuenta

- Solo se sugiere ubicación inicial para productos que **sí tuvieron alguna venta o consumo en los últimos 90 días**. Un producto con cero movimiento en ese periodo no aparece aquí — no importa mucho dónde quede algo que no se mueve, así que a esos les puedes asignar ubicación manualmente desde su ficha si quieres, sin apuro.
- Solo **Admin y Bodeguero** pueden seleccionar y aplicar sugerencias (una por una o en lote); otros roles pueden ver la pantalla pero no ejecutar cambios (no ven casillas ni botones de aplicar).
- Al aplicar (individual o en lote), el cambio de ubicación se hace de inmediato tras confirmar — no hay un paso intermedio de "revisar antes de guardar", así que confirma solo si de verdad vas a mover/ubicar el producto físicamente ese día (para que el sistema y la realidad coincidan). En una aplicación en lote, si un producto del grupo falla por algún motivo, ninguno de los del lote se aplica — revisa el mensaje de error y vuelve a intentar.
- Varios productos pueden compartir el mismo código de ubicación sugerida (por ejemplo, muchos productos de alta rotación pueden terminar sugeridos todos a "ST1-P2") — eso es normal: una posición de estante en esta bodega guarda varias referencias pequeñas, no es "un producto por casillero".
- Cada acción tiene su color: "Subir" en naranja (mover ahora, alta rotación lejos de la puerta), "Asignar ubicación" en azul (informativo — el producto no tenía ubicación), "Bajar" en gris (menor urgencia, casi no rota).
- Si en algún momento la lista aparece vacía (sin ninguna sugerencia), significa que los productos ya están bien ubicados según su rotación actual — no es un error de carga.
- Solo se consideran productos **activos** en el catálogo — un producto descontinuado no genera sugerencia aunque haya tenido demanda en el pasado.
- Para que aparezca la sugerencia "Asignar ubicación", el producto necesita ya tener una fila de inventario en esa sede (aunque sea con `ubicacion_id` vacío). Si un producto nunca se ha registrado en el inventario de una sede, Slotting no lo va a sugerir ahí hasta que exista ese registro.
- El contador de sugerencias del encabezado siempre cuenta el total de todas las sedes, aunque tengas el filtro de sede activo mostrando solo una — no te preocupes si el número de arriba no coincide con las filas que ves en la tabla filtrada.

---

## Auditoría

### Qué es y para qué sirve

La pantalla de Auditoría (también llamada "Bitácora de movimientos") es la caja negra del inventario: un libro de registro que anota, automáticamente, cada vez que el stock de un producto cambió — sea porque se vendió, se compró, se trasladó entre sedes, se ajustó a mano, se armó/desarmó un ensamble, se devolvió algo o se consumió en una orden de trabajo. Cada línea queda "pegada" a quién la hizo, en qué sede, a qué hora y con qué cantidad. Es la herramienta que usa el dueño (o quien haga de auditor) para responder preguntas como "¿quién sacó 5 unidades de este repuesto el martes?" o "¿por qué el stock de esta referencia bajó sin que hubiera una venta?".

Ningún registro de esta bitácora se puede editar ni borrar — ni siquiera el Admin puede hacerlo desde la app ni directamente en la base de datos, porque la base de datos tiene un candado técnico que lo impide. Es un historial permanente.

### Qué encuentra al entrar

**Cuatro tarjetas de resumen (KPIs) en la parte superior**, que resumen únicamente lo que está cargado en pantalla en ese momento (no todo el historial completo, ver nota abajo):

- **Movimientos cargados**: cuántas líneas de movimiento se han traído a la pantalla hasta el momento (con un "+" si hay más por cargar).
- **Entradas**: cuántos de esos movimientos sumaron stock (compras, entradas de traspaso, producción de ensambles, devoluciones de cliente).
- **Salidas**: cuántos restaron stock (ventas, salidas de traspaso, consumo de ensambles, consumo por orden de trabajo).
- **Ajustes**: cuántos fueron correcciones manuales o del conteo cíclico.

**Barra de búsqueda y filtro rápido:**

- Un buscador de texto libre que busca por nombre o referencia del producto (con una pequeña pausa mientras se escribe, para no saturar el sistema).
- Un selector de "tipo de movimiento" (Todos, venta, compra, traspaso salida/entrada, ajuste, consumo/producción de ensamble, devolución, consumo de orden de trabajo, ajuste de conteo).
- Un botón "Limpiar" que aparece solo si hay algún filtro activo, para resetear todo de un clic.
- Un contador a la derecha que dice cuántos eventos hay cargados.

**Panel de "Filtros avanzados"** (se despliega con el botón del mismo nombre, arriba a la derecha):

- **Sede**: para ver movimientos solo de una sede (BODEGA, CV, CHV, L3).
- **Usuario**: para ver movimientos hechos solo por una persona.
- **Desde / Hasta**: rango de fechas.

**Tabla de movimientos** (o tarjetas en el celular), ordenada del más reciente al más antiguo, con estas columnas: fecha y hora, tipo de movimiento (con una etiqueta de color: rojo para salidas, verde para entradas, naranja para ajustes), producto (nombre y referencia), cantidad (en rojo si resta stock, en verde si suma, con el signo + o −), módulo de origen (Ventas, Compras, Traspasos, Inventario, Conteo, Ensambles, Devoluciones, Órdenes de trabajo) y el usuario que lo hizo (con sus iniciales en un circulito).

**Panel de detalle** a la derecha (o al tocar una fila en el celular): al hacer clic sobre cualquier movimiento se abre un panel con toda su ficha: fecha y hora exacta, usuario y su rol, módulo, sede, "origen" (a qué venta/compra/orden específica pertenece ese movimiento), y el stock antes y después de ese movimiento (por ejemplo "48 → 45"). Si el movimiento tiene una observación escrita por quien lo hizo, también aparece ahí.

Al fondo de la pantalla hay una nota fija que recuerda que el registro es de solo-agregado: los movimientos quedan asociados a usuario, sede y fecha, y no se pueden editar ni borrar.

### Cómo se usa paso a paso

1. Al entrar, la pantalla carga automáticamente los movimientos más recientes de todas las sedes (los primeros 50).
2. Si busca algo puntual, escriba en el buscador el nombre o referencia del producto; la lista se filtra sola después de una breve pausa.
3. Si quiere acotar por tipo de evento, use el selector de tipo (por ejemplo, elegir "venta" para ver solo salidas por venta).
4. Para preguntas más finas, abra "Filtros avanzados" y combine sede, usuario y rango de fechas — por ejemplo: "todo lo que movió Pedro en BODEGA entre el 1 y el 5 de julio".
5. Haga clic en cualquier fila para ver el detalle completo en el panel derecho (o se abre en el celular al tocar la tarjeta).
6. Si la lista es larga, hay un botón "Cargar más" al final para traer los siguientes 50 movimientos (la lista no trae todo de una vez, para no sobrecargar la conexión).
7. El botón "Limpiar" (aparece solo cuando hay filtros puestos) regresa la vista al estado inicial.

### Cuándo usarla

- Cuando un producto tiene menos (o más) stock del que debería y hay que averiguar qué pasó y quién lo movió.
- Para revisar la actividad de un empleado específico en un día o periodo (por ejemplo, si hubo una queja o una duda sobre su trabajo).
- Como respaldo antes de un cierre de caja o de un conteo físico, para entender movimientos raros antes de conciliar.
- Para investigar un ajuste manual o un ajuste de conteo que llame la atención.
- En general, como "cámara de seguridad" del inventario: cualquier sospecha de faltante o sobrante se investiga aquí primero.

### Cosas importantes a tener en cuenta

- Los KPIs de arriba (Entradas, Salidas, Ajustes) **solo cuentan lo que está cargado en pantalla**, no la totalidad del historial que cumple el filtro. Si aplicó un filtro y solo se cargaron 50 de, digamos, 300 movimientos, esos KPIs reflejan esos 50, no los 300. Para ver más hay que usar "Cargar más".
- Es normal que un mismo evento de negocio genere dos movimientos: por ejemplo, un traspaso entre sedes genera una "salida" en la sede de origen y una "entrada" en la de destino.
- Un ajuste (tipo "ajuste" o "ajuste de conteo") en naranja no es necesariamente un error: puede ser una corrección legítima hecha por el bodeguero o el resultado de un conteo cíclico. Pero si aparecen muchos, vale la pena revisarlos uno por uno.
- Esta pantalla es de **solo consulta**: no hay botón para editar, anular ni borrar ningún movimiento desde aquí, y tampoco existe manera de hacerlo por fuera de la app — la base de datos lo bloquea técnicamente. Si algo quedó mal registrado, la corrección se hace con un nuevo movimiento (por ejemplo un ajuste), nunca modificando el original.
- La nota "Inmutabilidad garantizada..." al final del panel de detalle es literal: ni el equipo de soporte técnico puede alterar un movimiento ya guardado, solo se pueden agregar nuevos que lo corrijan hacia adelante. Esa misma nota aclara honestamente una limitación: **no se registra firma criptográfica ni la IP de origen** de quien hizo el movimiento — la trazabilidad es de usuario/sede/fecha, no forense a ese nivel.

---

## Cierres

### Qué es y para qué sirve

**Cierres** es la pantalla más delicada de toda la aplicación porque es la que trata directamente con el dinero. Sirve para que, al final de un día (o de un periodo más largo, como un mes), el dueño revise cuánto entró, cuánto salió, cuánto quedó de margen, y compare el efectivo que el sistema dice que debería haber en caja contra el efectivo real que hay físicamente (esto se llama "arqueo" o "cuadre de caja"). Una vez que se genera un cierre, queda sellado para siempre: no se puede editar ni borrar, así lo intente el Admin. Por eso la pantalla siempre muestra primero una "vista previa" para revisar todo con calma antes de sellar nada.

Solo el rol **Admin** puede generar cierres, y **solo Admin puede ver el histórico de cierres ya generados** (por diseño de seguridad de la base de datos, ni siquiera Bodega puede consultar cierres pasados). Bodega, desde su propia pantalla de cierre en Operación, solo puede **previsualizar** un cierre nuevo (ver los totales calculados y hacer el arqueo de su sede) — pero nunca genera el cierre definitivo ni ve el historial de cierres anteriores. Esa parte es exclusiva del Admin.

### Qué encuentra al entrar

**Franja de indicadores (KPIs) arriba de todo:**

- **Periodo seleccionado**: la fecha (si es cierre diario) o el rango (si es de periodo) que está configurado en ese momento.
- **Cierres registrados**: cuántos cierres existen en total en el histórico.
- **Margen acumulado periodo**: la suma del margen de todos los cierres de tipo "periodo" ya generados (en rojo si es negativo, en verde si es positivo).
- **Último cierre**: el número del cierre más reciente, su fecha final y quién lo generó.

**Sección "Generar cierre" (o "Consultar cierre" en modo solo lectura), con cuatro campos:**

- **Tipo de cierre**: Diario o Periodo. Si elige "Diario", el campo "Hasta" se bloquea y se iguala automáticamente a "Desde" (un cierre diario siempre es de un solo día).
- **Desde** y **Hasta**: el rango de fechas a cerrar. El campo "Hasta" no permite una fecha anterior a "Desde"; una fecha futura sí se puede escribir en el calendario, pero el sistema la rechaza apenas pulsas "Previsualizar".
- **Observaciones (opcional)**: una nota libre para dejar constancia de algo puntual de ese cierre (por ejemplo, "faltó el recibo de la compra de aceite").
- Botón **"Previsualizar"**: calcula (sin guardar nada todavía) los totales de ese rango.

**Vista previa** (aparece después de previsualizar), con:

- Aviso en rojo si el rango se solapa con un cierre ya existente (en ese caso no se puede generar el cierre; hay que cambiar las fechas).
- Cinco tarjetas de cifras: **Ingresos productos** (ventas directas de mostrador, sin contar ventas a crédito hasta que se paguen) con el número de ventas; **Ingresos servicios** (abonos/anticipos pagados sobre Órdenes de Trabajo) con el número de abonos; **Ingresos total** (productos + servicios); **Egresos** (compras pagadas, sin contar las que quedaron a crédito) con el número de compras; y **Margen** (ingresos totales menos egresos, en rojo si es negativo).
- **Detalle avanzado en pestañas**: Por sede, Cuentas, Egresos, Productos y Arqueo (cada pestaña solo aparece si hay datos para mostrar):
  - _Por sede_: una tabla con cada sede activa y, para cada método de pago que tuvo movimiento (efectivo, transferencia, tarjeta, etc.), cuánto ingresó, más una columna de egresos.
  - _Cuentas_: ingresos y egresos agrupados por sede y por cuenta bancaria (o "Sin cuenta / efectivo" si no aplica).
  - _Egresos_: el detalle línea por línea de en qué se fue el dinero — proveedor, factura y concepto de cada compra, o el concepto si fue un gasto de caja menor, junto con método de pago, cuenta y total.
  - _Productos_: qué productos se vendieron en cada sede, cuántas unidades y cuánto generaron (el ingreso ya viene descontado si esa venta tuvo un descuento aplicado, para que la cifra refleje lo que realmente entró).
  - _Arqueo_: aparece una vez que ya se generó el cierre; muestra el efectivo esperado, el contado y la diferencia por sede.
- **Captura de arqueo de caja** (antes de generar): por cada sede, se muestra el "efectivo esperado" (calculado automáticamente por el sistema, sumando lo cobrado en efectivo de ventas y abonos y restando lo pagado en efectivo en compras) y un campo en blanco para escribir el "efectivo contado" real, físicamente, en la caja. En cuanto se escribe un valor, aparece al lado la diferencia: "Cuadra" (verde, si da igual), "Sobrante" (si contó de más) o "Faltante" (rojo, si contó de menos). **Este paso es opcional**: las sedes que se dejen en blanco simplemente no quedan con arqueo registrado, y aun así el cierre se puede generar.
- Botón **"Generar cierre"** (solo visible para Admin): pide confirmación explícita, mostrando el rango de fechas y el total de ingresos, y advirtiendo que "una vez guardado es inmutable y no podrá editarse ni borrarse".

**Panel de checklist de conciliación**, a la derecha, que se llena solo con datos reales del periodo previsualizado (no hay que marcarlo a mano):

- Ventas del periodo conciliadas (si hubo al menos una venta).
- Abonos de servicios incluidos (si hubo al menos un abono de OT).
- Compras/egresos registrados (si hubo al menos una compra).
- Margen calculado (siempre que haya ingresos).
- Rango sin solapamiento con cierres previos (si las fechas elegidas no chocan con un cierre ya existente).
- Firma del responsable: este ítem siempre aparece pendiente hasta el momento de generar el cierre (se marca automáticamente al pulsar "Generar cierre"); es el único ítem "manual" de la lista.

Una barra de progreso muestra qué porcentaje del checklist está completo. Al final hay una nota: "Al generar, el cierre queda firmado por el responsable, sellado con fecha y bloqueado contra ediciones."

**Histórico de cierres** (tabla en desktop, tarjetas en el celular), con pestañas para filtrar por Todos / Diarios / Periodo. Cada fila muestra: número de cierre, tipo (con icono), rango de fechas, ingresos por productos, ingresos por servicios, egresos, margen y quién lo generó. Al hacer clic en una fila (o tarjeta) se expande y muestra la misma información avanzada por pestañas (sede, cuentas, egresos, productos, arqueo) que en la vista previa, más quién lo generó, cuándo y las observaciones que se escribieron en su momento.

### Cómo se usa paso a paso

1. Elija el tipo de cierre: "Diario" para cerrar un solo día (lo más común, al final de la jornada) o "Periodo" para cerrar un rango más largo (por ejemplo, todo un mes).
2. Ajuste las fechas "Desde" y "Hasta" (en diario, "Hasta" se ajusta solo).
3. Si quiere, escriba una observación.
4. Pulse "Previsualizar". El sistema calcula los totales de ese rango sin guardar nada todavía — se puede previsualizar tantas veces como se quiera, cambiando fechas, sin ningún riesgo.
5. Revise la vista previa: los cinco totales, y luego entre a las pestañas (Por sede, Cuentas, Egresos, Productos) para verificar que todo cuadre con lo que se espera del día.
6. Si quiere hacer el arqueo, cuente el efectivo físico de cada sede y escríbalo en el campo "Efectivo contado" de la tabla de arqueo. Vea si dice "Cuadra", "Sobrante" o "Faltante" por cada sede. Puede dejar sedes sin contar si no aplica ese día.
7. Revise el checklist de la derecha: mientras más ítems estén tachados (completos), más tranquilidad de que el periodo está bien conciliado. El único que siempre queda pendiente es "Firma del responsable", que se completa al generar.
8. Cuando esté conforme, pulse "Generar cierre". Aparece una ventana de confirmación con el resumen (fechas y total de ingresos) y la advertencia de que es irreversible. Solo al confirmar ahí se guarda definitivamente.
9. Después de generar, el cierre aparece arriba de todo en el Histórico, y se puede consultar cuantas veces se quiera (pero nunca editar).

### Cuándo usarla

- **Al final de cada día**, para hacer el cierre diario y el arqueo de caja de esa jornada (lo ideal es hacerlo siempre, para no acumular varios días sin conciliar).
- **Al final de mes** (o del periodo que la empresa maneje), para generar un cierre de tipo "Periodo" que resuma todo ese rango.
- Cuando se necesita saber, con exactitud, cuánto se vendió, cuánto se gastó y cuánto quedó de margen en un rango específico de fechas (por ejemplo, para reportar al contador o para tomar decisiones).
- Cuando hay que investigar si el efectivo físico en caja coincide con lo que el sistema dice que debería haber (arqueo).
- Bodega puede entrar a su propia pantalla de cierre (en Operación) solo para **previsualizar** los totales de un rango y capturar su arqueo — no genera el cierre definitivo ni ve el historial de cierres pasados (eso es exclusivo del Admin, ver más abajo).

### Cosas importantes a tener en cuenta

- **Un cierre, una vez generado, es irreversible.** La base de datos tiene un bloqueo técnico que impide editarlo o borrarlo, ni siquiera el Admin puede hacerlo por ningún medio. Por eso es crucial revisar bien la vista previa (y el arqueo) antes de pulsar "Generar cierre". Si algo salió mal en un cierre ya generado, no hay forma de corregirlo directamente — solo se puede dejar constancia en observaciones de cierres futuros.
- **No se pueden generar dos cierres que se solapen en fechas** (ni siquiera parcialmente). Si la vista previa avisa en rojo que el rango "solapa" un cierre existente, hay que ajustar las fechas — el botón "Generar cierre" queda deshabilitado mientras eso ocurra.
- **El arqueo es opcional**: se puede generar un cierre sin contar el efectivo de ninguna sede. Pero si se deja de hacer seguido, se pierde la posibilidad de detectar faltantes o sobrantes de caja a tiempo.
- **Ventas y compras a crédito no entran en los ingresos/egresos hasta que se pagan.** Una venta a crédito no suma a "Ingresos productos" el día de la venta; solo suma el día en que el cliente efectivamente paga (a través de un abono a esa cuenta por cobrar). Lo mismo aplica a compras a crédito con proveedores. Esto es intencional: el cierre refleja caja real, no ventas facturadas.
- **Los anticipos y abonos de Órdenes de Trabajo (OT) sí cuentan como "ingresos servicios"** el día en que se reciben, no el día en que la orden se termina o se entrega. Esto puede generar la impresión de que "hay más ingresos de servicios de lo que parece" en un día donde no se entregó ningún trabajo, simplemente porque ese día se recibió un anticipo de una orden que se va a entregar después.
- **El "efectivo esperado" del arqueo ya descuenta los gastos en efectivo del día** (compras o caja menor pagadas en efectivo), no es solo lo que entró. Por eso, si hubo un gasto grande en efectivo, el esperado puede ser más bajo de lo que uno intuiría solo mirando las ventas.
- **Una venta con método "Mixto"** (por ejemplo, parte en efectivo y parte en transferencia) se reparte automáticamente en cada pestaña (por sede, por cuenta, arqueo) según cómo se dividió el pago — no hay que hacer nada especial, el sistema ya la desglosa.
- **El ingreso por producto en la pestaña "Productos" ya viene neto de descuento**: si una venta tuvo un descuento (incluyendo cuando un cliente cambia un producto por otro y el producto viejo se toma como parte de pago), la cifra mostrada refleja lo que realmente entró, no el precio de lista completo.
- **Diferencia "Sobrante" vs "Faltante"** en el arqueo: sobrante significa que había más efectivo físico del que el sistema esperaba; faltante significa que hay menos efectivo del que debería. **Las dos se muestran en rojo** (solo "Cuadra", diferencia cero, aparece en verde) — hay que fijarse en el signo o la palabra, no en el color, para saber cuál de las dos es. Ambos casos vale la pena investigarlos revisando la Auditoría de movimientos y el detalle de egresos de ese mismo cierre antes de asumir que fue un error de conteo.
- **Falta el histórico completo para Bodega**: aunque Bodega puede previsualizar un cierre, la lista de "Cierres registrados" y el detalle de cierres pasados de esta pantalla solo los ve el Admin — es una restricción de la base de datos, no un botón oculto que se pueda activar. Ojo: la pantalla de Bodega no muestra un aviso de "no autorizado" — simplemente ve los indicadores en cero ("Cierres registrados: 0", etc.) y el histórico vacío, como si nunca se hubiera generado ningún cierre. Si un Bodeguero pregunta por qué no ve cierres pasados que tú sí generaste, es por este permiso, no porque se hayan perdido.

---

# 3. Operación administrativa

## Conteo cíclico

### Qué es y para qué sirve

Esta pantalla es el lugar donde se verifica que lo que dice el sistema que hay en cada bodega o almacén coincida con lo que realmente hay en el estante. Sirve para detectar (y corregir) diferencias de inventario antes de que se conviertan en un problema grande: un producto que se está "perdiendo" poco a poco, un error de digitación viejo, una devolución mal registrada, etc. Tiene dos pestañas: **Registros**, que es el conteo manual de toda la vida (contar un producto suelto cuando se le ocurra a alguien), y **Plan**, que es el sistema nuevo de conteo cíclico programado, que reparte todo el catálogo en semanas para que nada se quede sin contar.

### Qué encuentra al entrar

**Pestaña Registros:**

- Cuatro indicadores (KPI) en la parte de arriba: "Conteos en vista" (cuántos conteos hay cargados y cuántos ya están aplicados), "Pendientes de ajuste" (cuántos conteos todavía no se han aplicado al inventario, y cuántos de esos tienen diferencia), "Valor divergencias" (cuánta plata en pesos representan las diferencias sin ajustar, calculado como la diferencia de unidades multiplicada por el costo del producto) y "Precisión (vista)" (qué porcentaje de los conteos mostrados cuadraron exactamente, sin diferencia).
- Tres filtros: "Todos", "Pendientes" y "Aplicados".
- Una tabla (o tarjetas en el celular) con cada conteo registrado: producto, su clasificación ABC, sede y quién contó, cuánto decía el sistema, cuánto se contó físicamente, la diferencia (en verde si es positiva, en rojo si falta), el estado (Pendiente o Aplicado) y observaciones si el que contó dejó una nota.
- Debajo, si hay conteos pendientes con diferencia distinta de cero, aparece una sección aparte llamada "Divergencias por ajustar" que las agrupa con su valor estimado en pesos, para que sea fácil ver de un vistazo qué hay que resolver.
- Un botón "Nuevo conteo" arriba a la derecha para registrar un conteo manual en cualquier momento.

**Pestaña Plan:**

- Un selector de sede (el Admin puede elegir cualquiera de las 4 sedes; un Bodeguero solo ve la suya).
- Si la sede no tiene un plan activo, aparece un formulario para generar uno: elegir el horizonte (1 mes/4 semanas o 3 meses/13 semanas) y marcar o no la casilla de "conteo ciego". También muestra una estimación de cuántos productos hay con stock en esa sede y cuántos tocarían por semana en promedio.
- Si ya hay un plan activo, ve cuatro indicadores: "Hoy por contar" (cuántos productos tocan hoy, y si hay atrasados), "Cobertura del ciclo" (porcentaje ya contado del total del plan, con una barra de progreso visual), "Semana" (en qué semana del ciclo está y cuántas semanas dura en total) y "Precisión del ciclo" (porcentaje de los productos ya contados en el plan que cuadraron exactamente).
- Debajo de la barra de progreso, si el plan es ciego se indica con un ícono de "ojo tachado" y el texto "Conteo ciego activo". El Admin además tiene un enlace de texto "Regenerar plan".
- La "cola de hoy": una lista de los productos que tocan contar, cada uno con su nombre, referencia, clasificación ABC, un chip de ubicación (con mapita de la bodega si tiene ubicación asignada), la semana a la que pertenece, una etiqueta "Atrasado" si ya se pasó su semana, y un botón "Contar" que abre directamente el formulario de conteo con ese producto y esa sede ya seleccionados.

### Cómo se usa paso a paso

**Generar un plan nuevo (solo Admin):** entrar a la pestaña Plan, elegir la sede, elegir el horizonte (1 mes o 3 meses — en 3 meses los productos clase A se cuentan dos veces, una en cada mitad del ciclo, y los B/C una sola vez), decidir si va a ser ciego, y presionar "Generar plan". El sistema reparte automáticamente todos los productos activos con stock de esa sede en las semanas del ciclo, dando prioridad temprana a los que antes tuvieron diferencias en conteos pasados.

**Contar un producto de la cola:** presionar "Contar" en cualquier fila de la cola de hoy. Se abre el mismo formulario de conteo, pero con el producto y la sede ya listos — solo falta escribir el stock físico que se ve en el estante. Si el plan es ciego, el formulario no muestra cuánto dice el sistema que hay (para que la persona cuente honestamente sin dejarse influenciar); si no es ciego, sí se ve el stock del sistema y la diferencia se calcula en pantalla al momento de escribir el físico.

**Registrar un conteo manual suelto (con o sin plan activo):** presionar "Nuevo conteo" arriba, buscar el producto por nombre o referencia, elegir la sede (si es Admin), escribir el stock físico contado y opcionalmente una observación. Al guardar, si ese producto formaba parte de la cola del plan activo de esa sede, el plan se actualiza solo — no hay que hacer nada aparte para "avisarle" al plan que ya se contó.

**Qué pasa cuando hay diferencia:** el conteo queda guardado como "Pendiente". Aparece en la lista de Registros y, si tiene diferencia, también en "Divergencias por ajustar". Un Admin debe entrar y presionar el botón "Aplicar" para que esa diferencia se traslade de verdad al inventario del sistema (sumando o restando unidades) y quede registrado un movimiento de auditoría tipo "ajuste de conteo". Mientras no se aplique, el inventario del sistema sigue mostrando el número viejo — el conteo por sí solo no cambia nada todavía.

### Cuándo usarla

- Al final de una jornada o semana, cuando toca "hacer inventario" de una sección o de toda la bodega.
- Cuando alguien sospecha que un producto puntual tiene mal el stock (se ve mucho o poco en el estante comparado con lo que dice el sistema) — ahí se usa el conteo manual suelto, sin necesidad de plan.
- Cuando se quiere organizar el conteo de todo el catálogo de forma ordenada durante el mes o el trimestre, en vez de dejarlo a la memoria de alguien — ahí se genera y se sigue el Plan.
- Antes de una auditoría, cierre contable o revisión de pérdidas, para tener el indicador de "Precisión" como evidencia de qué tan confiable es el inventario.

### Cosas importantes a tener en cuenta

- **"Atrasado"** significa que a ese producto ya le tocaba su semana en el plan y todavía no se ha contado — no que esté vencido ni que algo esté mal, solo que hay que ponerse al día con él primero (por eso la cola los muestra de primero).
- **Aplicar un ajuste es la acción que de verdad mueve el inventario.** Antes de eso el conteo es solo un "registro informativo". Solo un Admin puede aplicar ajustes.
- Si entre el momento de contar y el momento de aplicar el ajuste alguien más vendió o trasladó ese mismo producto (cambiando el stock del sistema), la aplicación del ajuste se bloquea automáticamente con un mensaje pidiendo volver a contar — esto es a propósito, para no borrar por accidente una venta o traspaso real que ocurrió mientras tanto.
- **Borrar un conteo pendiente es irreversible**, pero solo se puede borrar si NO ha sido aplicado todavía (y solo un Admin puede hacerlo) — sirve para corregir un error de digitación antes de que afecte el inventario. Una vez aplicado, un conteo ya no se puede borrar; para corregirlo hay que hacer un conteo nuevo.
- **Diferencia entre conteo normal y conteo ciego:** en el normal, la persona ve en pantalla cuánto dice el sistema mientras cuenta (puede sesgar el resultado, a favor o en contra, sin querer). En el ciego, esa cifra se oculta por completo — ni siquiera viaja al celular — así que el conteo es más confiable como verificación real, aunque toma el mismo tiempo registrar.
- Si un producto nunca había tenido stock registrado en esa sede, el sistema no bloquea el conteo: simplemente arranca de 0 y registra la diferencia contra ese cero.
- **El conteo manual (pestaña Registros) sigue funcionando exactamente igual exista o no un plan activo** — no son excluyentes. Puedes seguir contando productos sueltos aunque no hayas generado ningún plan, o aunque tengas uno activo en curso.
- **Hoy solo el Admin puede entrar a esta pantalla** (está dentro del Panel de Administrador, que es exclusivo de Admin). Por dentro, el sistema ya está preparado para que un Bodeguero use el conteo cíclico viendo solo la cola y el progreso de su propia sede — pero mientras esa puerta no se le abra desde el menú, el Bodeguero no puede llegar aquí. Si en el futuro se decide darle acceso directo a Bodega, no hace falta ningún cambio de fondo, solo habilitar la ruta.

---

## Notas crédito

### Qué es y para qué sirve

Es el lugar donde se ven las "notas crédito" que los proveedores le han dado a la empresa — es decir, plata a favor que un proveedor debe (por ejemplo, porque se le devolvió mercancía defectuosa o hubo un cobro de más) y que todavía no se ha usado. Sirve para no perder de vista esa plata a favor y saber cuánto queda disponible para descontar en próximas compras a ese proveedor.

### Qué encuentra al entrar

- Cuatro indicadores arriba: "Saldo disponible total" (toda la plata a favor que aún no se ha usado, sumada), "Notas con saldo activo" (cuántas notas todavía tienen algo pendiente por aplicar), "Notas agotadas" (cuántas ya se usaron por completo) y "Monto emitido (vista)" (el total de dinero que representan las notas que se están mostrando en pantalla).
- Un botón arriba a la derecha que alterna entre "Solo con saldo" (por defecto, oculta las que ya están en cero) y "Todas (con/sin saldo)".
- Una tabla (o tarjetas en el celular) con cada nota crédito: su número (NC #), el nombre del proveedor, la fecha, el monto original, el saldo que todavía queda disponible (en verde si tiene saldo, en gris si ya se agotó), y observaciones si las hay.
- Si la nota crédito viene de una garantía de compra (un reclamo hecho por un producto defectuoso), aparece un enlace "Garantía" que lleva directo al detalle de esa garantía para ver de dónde salió.
- Un pie de página con el conteo total de notas y el saldo total sumado.

### Cómo se usa paso a paso

Esta pantalla es de solo consulta — no se registran ni se aplican notas crédito desde aquí, solo se ven. Las notas crédito se generan automáticamente cuando se resuelve una garantía de compra a favor de la empresa (en el módulo de Garantías) y se descuentan automáticamente cuando se usan al pagar una compra nueva a ese proveedor (en el módulo de Compras). Aquí el uso típico es: entrar, revisar qué proveedores tienen saldo a favor, y usar esa información antes de aprobar o pagar una compra a ese mismo proveedor, para recordar descontar lo que corresponda.

### Cuándo usarla

- Antes de pagarle una compra nueva a un proveedor, para revisar si tiene saldo a favor pendiente de usar y no pagar de más.
- Al hacer seguimiento mensual de proveedores, para verificar que las notas crédito por garantías se estén usando y no quedando olvidadas.
- Cuando un proveedor pregunta cuánto saldo a favor tiene, para responder rápido sin tener que revisar papeles.

### Cosas importantes a tener en cuenta

- El saldo mostrado ya es lo que queda **después** de descontar lo que se haya usado en compras anteriores — no es el monto original de la nota.
- Una nota con saldo en cero ("agotada") no desaparece de la lista si se desactiva el filtro "Solo con saldo" — solo se oculta con el filtro activo, que es el comportamiento por defecto.
- No hay ningún botón para editar o eliminar una nota crédito desde aquí; si algo está mal, el ajuste se hace desde el origen (la garantía de compra), nunca aquí directamente.

---

## Cuentas por cobrar y pagar

### Qué es y para qué sirve

Es el panel de cartera: por un lado, las ventas que se hicieron a crédito y que los clientes todavía deben (cuentas por cobrar); por otro, las compras que se hicieron a crédito y que la empresa todavía le debe a sus proveedores (cuentas por pagar). Sirve para saber quién debe, cuánto debe, y para registrar los cobros o pagos a medida que van entrando o saliendo.

### Qué encuentra al entrar

- Dos pestañas arriba: "Por cobrar" y "Por pagar".
- Un botón que alterna entre "Solo con saldo" (por defecto, solo muestra lo que aún debe algo) y "Todas (saldadas incl.)".
- Tres indicadores: el total en pesos pendiente (por cobrar en verde, por pagar en rojo), cuántas cuentas todavía tienen saldo, y el valor total facturado de lo que se está mostrando.
- Una tabla (o tarjetas en el celular) con cada venta o compra a crédito: número de documento, nombre del cliente o proveedor, sede, fecha, el total del documento, el saldo que falta por cobrar/pagar, un estado (Pendiente, Parcial o Saldada, cada uno con su color) y un botón "Cobrar" o "Pagar".

### Cómo se usa paso a paso

Al presionar "Cobrar" (o "Pagar") en cualquier fila, se abre una ventana con el detalle de esa cuenta: el total del documento, lo ya abonado/pagado, el saldo restante, y el historial de todos los cobros o pagos anteriores con su fecha, monto y método. Para registrar uno nuevo: escribir el monto (o usar el atajo "Saldar todo" que llena automáticamente el saldo completo), elegir el método (Efectivo, Transferencia o Tarjeta — nótese que "Crédito" no es una opción aquí, porque ya es la cuenta a crédito que se está saldando), si es Transferencia o Tarjeta hay que elegir además la cuenta bancaria de destino/origen, y opcionalmente dejar una nota. Al guardar, el saldo se recalcula al instante y la cuenta pasa de "Pendiente" a "Parcial" o "Saldada" según corresponda.

Si una venta a crédito viene de una cotización que ya tenía abonos anteriores, esos abonos se muestran aparte, ya incluidos en el cálculo del saldo, con un aviso informativo ("Incluye $X de abonos de la cotización de origen").

### Cuándo usarla

- Cuando un cliente viene a pagar (total o parcialmente) una venta que se le hizo a crédito.
- Cuando se le hace un pago a un proveedor por una compra que se le hizo a crédito.
- Para revisar semanalmente cuánto hay pendiente por cobrar (flujo de caja esperado) y cuánto se debe pagar próximamente.
- Para consultar el historial completo de abonos de una cuenta puntual, si un cliente o proveedor pregunta cuánto ha pagado hasta el momento.

### Cosas importantes a tener en cuenta

- Un pago o cobro registrado se puede **anular** (hay un botón de basurero al lado de cada movimiento en el historial), pidiendo un motivo opcional — queda registrado en la auditoría, no desaparece sin dejar rastro. Esto es distinto de "borrar": la anulación es la forma correcta de corregir un cobro/pago mal registrado.
- El estado "Saldada" solo aparece cuando el saldo pendiente es prácticamente cero (se admite un margen de un centavo por redondeos) — si queda cualquier resto, se muestra "Parcial".
- No se puede registrar un cobro o pago si el monto es cero o inválido, ni un pago electrónico (Transferencia/Tarjeta) sin elegir la cuenta bancaria — el sistema lo bloquea con un mensaje.
- Una vez la cuenta queda en "Cuenta saldada", el formulario para registrar más pagos desaparece — no se puede seguir abonando a algo que ya está en cero.
- Esta pantalla es solo para Admin.

---

## Configuración

La pantalla de Configuración es el "cuarto de mandos" de la aplicación: aquí se ajustan los datos y reglas que usan todas las demás pantallas (cotizaciones, ventas, órdenes de trabajo, ensambles). Solo el Admin puede entrar aquí. Al abrir el módulo se ve una fila de pestañas en la parte superior: Cuentas bancarias, Servicios, Checklist OT, Equipos ensamblables y Parámetros del sistema. Cuatro de esas cinco pestañas muestran un contador (por ejemplo "4" o "24 ítems") que indica cuántos registros hay cargados — la pestaña **Parámetros** es la única que no trae contador, porque no es una lista, son 5 valores fijos. La URL recuerda en qué pestaña estabas, así que puedes compartir un enlace directo a una de ellas.

### Parámetros

**Qué es y para qué sirve.** Es la pantalla donde se ajustan cinco valores numéricos que la aplicación usa como "reglas por defecto" en toda la operación: el IVA que se aplica en ventas y cotizaciones, cuántos días dura vigente una cotización antes de vencer, cuántos días se espera antes de avisar que una orden de trabajo quedó abandonada (el cliente no ha recogido su equipo), cuántos días de garantía trae por defecto una venta, y cada cuánto se debe repetir el conteo cíclico de inventario (el conteo periódico de existencias por sede).

**Qué encuentra al entrar.** Una tarjeta grande con los cinco parámetros en dos columnas. Cada parámetro muestra: un nombre humano (por ejemplo "IVA aplicable a cotizaciones y ventas"), debajo el nombre técnico en letra pequeña tipo código (por ejemplo `iva_pct`) junto con una etiqueta que indica si es un número entero o decimal, una casilla donde se escribe el valor con su unidad al lado (%, días), un botón "Guardar" que solo se activa cuando cambias el valor, una breve descripción de qué hace ese parámetro, y —si alguna vez se editó— la fecha y el nombre de quién hizo el último cambio. Arriba de todo hay un aviso en color naranja que advierte: los cambios se aplican en tiempo real a todas las pantallas abiertas, y solo afectan a los documentos que se creen después del cambio (los ya existentes conservan el valor con el que se crearon). Al final hay una nota informativa aclarando que la opción de "días hábiles por defecto" (para calcular vencimientos con días laborales en vez de días de calendario) todavía no está disponible.

**Cómo se usa paso a paso.** 1) Ubica el parámetro que quieres cambiar. 2) Escribe el nuevo valor en su casilla (el sistema no te deja guardar valores fuera de rango: por ejemplo el IVA debe estar entre 0 y 100, la validez de cotización entre 1 y 365 días). 3) Aparece el botón "Guardar" activo (antes estaba apagado). 4) Haz clic en "Guardar". 5) Verás un mensaje verde de confirmación y la fecha/usuario de edición se actualiza.

**Cuándo usarla.** Cuando cambia la tarifa de IVA por norma del gobierno; cuando quieres que las cotizaciones duren más o menos días antes de vencer; cuando quieres ajustar cuántos días de garantía ofrecen por defecto tus ventas; cuando quieres cambiar la frecuencia con la que se debe hacer el conteo físico de inventario; cuando quieres avisar más rápido o más lento sobre órdenes de trabajo que el cliente no ha recogido.

**Cosas importantes / errores comunes.** Los cambios NO son retroactivos: si subes el IVA hoy, las cotizaciones y ventas ya hechas mantienen el IVA con el que se crearon; solo lo nuevo usa el valor actualizado. El sistema valida que escribas números válidos y dentro de los rangos permitidos, así que no podrás guardar, por ejemplo, un IVA negativo o de 500%. Edita estos valores con cuidado porque afectan a toda la operación de la empresa, no solo a una sede.

**Nota especial — Asistente de mínimos y máximos (lead time, factor de seguridad, factor máximo).** Estos tres parámetros que controlan cómo la app sugiere el stock mínimo y máximo de cada producto (para saber cuándo reponer) **no están en esta pestaña de Parámetros**, sino dentro de **Admin → Reorden**, en el botón "Sugerir min/max". Ahí encontrarás: "Lead time (días)" (cuántos días tarda en llegar el pedido de un proveedor una vez lo haces), "Factor de seguridad" (un colchón extra sobre la demanda esperada durante ese tiempo de espera, para no quedarte corto por imprevistos) y "Máx = mín ×" (el stock máximo se calcula multiplicando el mínimo sugerido por este número). En esa misma ventana puedes cambiar esos tres valores, y al hacerlo la aplicación recalcula automáticamente las sugerencias de mínimo y máximo para todos los productos; luego eliges cuáles aplicar. Los tres valores deben ser números mayores que cero.

### Cuentas bancarias

**Qué es y para qué sirve.** Es el directorio de las cuentas bancarias de la empresa que se muestran como datos de pago en las cotizaciones que se le entregan al cliente (para que sepa a qué cuenta consignar). No es un módulo de contabilidad ni mueve dinero real; solo administra la lista de cuentas que se pueden mostrar en los documentos.

**Qué encuentra al entrar.** Un aviso azul explicando que las cuentas activas, con su marca de IVA, son las que aparecen disponibles al generar documentos; que las marcadas "con IVA" son cuentas empresariales registradas y las "sin IVA" suelen ser cuentas digitales personales tipo Nequi o Daviplata. Debajo, un contador de cuántas cuentas hay y un botón "Nueva cuenta". Luego la lista de cuentas (tabla en computador, tarjetas en celular) con: Banco (y debajo el tipo de cuenta y el titular si lo tiene), Número de cuenta, una etiqueta de IVA ("IVA incluido" o "Sin IVA"), una etiqueta de Estado ("Activo"/"Inactivo"), una columna "Default para PDFs" que hoy siempre dice "No configurable aún" (es una función pendiente, no un error), y botones de Editar y de Activar/Desactivar. Al pie de la tabla hay un resumen ("X cuentas · Y con IVA · Z sin IVA") y otro botón para agregar cuenta.

**Cómo se usa paso a paso — crear una cuenta nueva.** 1) Clic en "Nueva cuenta" (arriba o en el pie de la tabla). 2) Se abre una ventana con los campos: Banco (texto libre, ej. "Bancolombia"), Tipo (elige entre Ahorros, Corriente o Digital), Número (el número de cuenta), Titular (opcional, el nombre a nombre de quién está la cuenta) y Marca IVA (opcional: "Sin marca", "IVA incluido" o "Sin IVA"). 3) Banco y Número son obligatorios. 4) Clic en "Guardar". El sistema no permite crear dos cuentas idénticas (mismo banco y mismo número).

**Cómo se usa paso a paso — editar o desactivar una cuenta.** Clic en el lápiz para editar cualquier dato; clic en el ícono de encendido (o el botón "Desactivar"/"Activar" en celular) para sacarla de circulación o volver a ponerla activa. Antes de desactivar, la app pide confirmación explícita.

**Cuándo usarla.** Cuando la empresa abre una cuenta nueva en un banco; cuando cambia de banco o cierra una cuenta; cuando se necesita agregar una cuenta digital (Nequi/Daviplata) para recibir pagos pequeños; cuando hay que corregir el número de una cuenta mal digitada.

**Cosas importantes / errores comunes.** Desactivar una cuenta (en vez de borrarla) es el comportamiento correcto y esperado: la cuenta deja de ofrecerse en cotizaciones nuevas pero no se pierde su historial ni se borra de la base de datos; puedes reactivarla cuando quieras. No existe un botón para eliminar cuentas de forma permanente — es intencional, para no perder trazabilidad. La columna "Default para PDFs" no es un error visual: es una función que todavía no se ha construido.

### Servicios

**Qué es y para qué sirve.** Es el catálogo de servicios que la empresa vende como mano de obra o conceptos (por ejemplo "Mantenimiento de compresor"), a diferencia de los productos físicos que sí tienen inventario. Estos servicios aparecen como opción al registrar una venta o una cotización, junto a los productos.

**Qué encuentra al entrar.** Un aviso azul explicando que los servicios activos aparecen al vender o cotizar, y que el precio e IVA aquí definidos son el valor "por defecto" (se pueden ajustar en el momento de la venta). Debajo, el contador de servicios y el botón "Nuevo servicio". La lista muestra: Servicio (nombre y descripción breve si tiene), Precio (en pesos colombianos), IVA (en porcentaje), Estado (Activo/Inactivo) y botones de Editar y Activar/Desactivar. Al pie, un resumen de cuántos servicios hay y cuántos activos.

**Cómo se usa paso a paso — crear un servicio nuevo.** 1) Clic en "Nuevo servicio". 2) Se abre una ventana con: Nombre (obligatorio, ej. "Mantenimiento de compresor"), Descripción (opcional, un detalle breve), Precio en pesos colombianos (COP, no puede ser negativo) e IVA en porcentaje (entre 0 y 100, viene precargado en 19% por ser el valor típico colombiano). 3) Clic en "Guardar".

**Cómo se usa paso a paso — editar o desactivar.** Clic en el lápiz para cambiar nombre, descripción, precio o IVA; clic en el ícono de encendido para desactivarlo (la app avisa que dejará de aparecer al vender o cotizar) o reactivarlo.

**Cuándo usarla.** Cuando la empresa empieza a ofrecer un servicio nuevo (por ejemplo, instalación, revisión técnica, mano de obra de reparación); cuando cambia el precio estándar de un servicio; cuando un servicio deja de ofrecerse temporal o permanentemente.

**Cosas importantes / errores comunes.** El precio y el IVA que se configuran aquí son solo el punto de partida: el vendedor todavía puede ajustarlos manualmente en el momento de hacer la venta o cotización, así que este catálogo no es una tarifa rígida e inmodificable. Desactivar (no borrar) es la forma correcta de retirar un servicio: conserva el historial de ventas pasadas donde se usó. Solo el Admin administra este catálogo.

### Equipos ensamblables

**Qué es y para qué sirve.** Es la lista de "equipos objetivo" que se pueden armar mediante un ensamble (por ejemplo, un compresor completo construido a partir de varias piezas). Cuando alguien va a crear un ensamble en el módulo de Ensambles, elige de esta lista qué equipo está armando. Una particularidad útil: se puede dar de alta un equipo con un nombre provisional (por ejemplo "Equipo por definir") cuando todavía no se sabe el nombre o modelo exacto, y renombrarlo después sin perder el historial.

**Qué encuentra al entrar.** Un aviso azul que explica justamente esto: se pueden agregar equipos con nombre provisional y renombrarlos luego; la "referencia" (código interno) se genera sola si se deja vacía; y el botón "Quitar" solo saca el equipo de esta lista de ensamblables, sin afectar su venta ni su inventario si ese mismo producto también se vende normalmente. Debajo, el contador de equipos y el botón "Nuevo equipo". La lista muestra: Equipo (nombre y, debajo, su referencia/código), Precio de venta, Estado (Activo/Inactivo) y botones de Editar y "Quitar de ensamblables". Al pie, el resumen de cuántos equipos hay y cuántos activos.

**Cómo se usa paso a paso — agregar un equipo ensamblable nuevo.** 1) Clic en "Nuevo equipo". 2) Se abre una ventana con: Nombre (obligatorio; puede ser provisional, ej. "Equipo por definir" o "Compresor 100L"), Referencia (opcional — si la dejas vacía, el sistema genera un código único automáticamente que empieza con "ENS-") y Precio de venta en COP. 3) Clic en "Guardar". El nuevo equipo queda disponible de inmediato para elegirlo al crear un ensamble.

**Cómo se usa paso a paso — renombrar un equipo (por ejemplo cuando ya se sabe el nombre definitivo) o cambiar su precio.** Clic en el lápiz, editar Nombre, Referencia o Precio, y Guardar. Si borras la referencia al editar, el sistema genera una nueva automáticamente (nunca queda vacía).

**Cómo se usa paso a paso — quitar un equipo de la lista.** Clic en el ícono de "Quitar" (el signo menos). El sistema pide confirmación y aclara que esto solo deja de ofrecerlo al crear ensambles nuevos; no borra el producto, no afecta su inventario ni impide que se siga vendiendo si ya existía como producto normal.

**Cuándo usarla.** Cuando la empresa lanza un producto ensamblado nuevo y hay que darlo de alta antes de armar el primer ensamble; cuando todavía no se conoce el nombre final de un equipo en construcción y se necesita empezar a trabajar con un nombre temporal; cuando un equipo deja de ensamblarse y hay que sacarlo de la lista de opciones.

**Cosas importantes / errores comunes.** "Quitar" no es lo mismo que "eliminar": el producto en sí no desaparece del sistema, solo deja de ofrecerse como destino de ensambles nuevos. Esto es intencional para no afectar accidentalmente productos reales que también se venden por separado. El precio que se define aquí es el precio de venta del equipo terminado.

### Checklist de órdenes de trabajo

**Qué es y para qué sirve.** Es la lista oficial de componentes o puntos que se revisan físicamente cuando un equipo entra al taller en una Orden de Trabajo (OT) — por ejemplo "Filtro de aire", "Cable de poder", etc. Sirve como respaldo legal y de control: lo que no se marcó en la recepción de un equipo se entiende que "no llegó" con el equipo.

**Qué encuentra al entrar.** Un aviso naranja de advertencia muy importante: modificar este checklist NO afecta a las órdenes de trabajo que ya existen; los cambios solo aplican a las OT nuevas que se creen después de guardar. Debajo, el contador de componentes totales y activos, y el botón "Nuevo componente". La lista (numerada 01, 02, 03…) muestra: el ítem del checklist (nombre), su Orden (un número que define en qué secuencia aparece al hacer la inspección física del equipo), Estado (Activo/Inactivo) y botones de Editar y Activar/Desactivar. Al pie, una nota recordando que el "orden" controla la secuencia de inspección.

**Cómo se usa paso a paso — agregar un ítem al checklist.** 1) Clic en "Nuevo componente" (arriba o al pie). 2) Se abre una ventana con: Nombre (obligatorio, ej. "Filtro de aire") y Orden (un número entero que decide en qué posición de la lista aparece durante la inspección; entre más bajo, más arriba aparece). 3) Clic en "Guardar".

**Cómo se usa paso a paso — editar o desactivar un ítem.** Clic en el lápiz para cambiar el nombre o el orden; clic en el ícono de encendido para desactivarlo (deja de ofrecerse en OT nuevas, pero las OT anteriores que ya lo tenían marcado conservan esa información) o reactivarlo.

**Cuándo usarla.** Cuando la empresa detecta que falta un ítem importante por revisar al recibir equipos (por ejemplo, un accesorio nuevo que empezó a venderse con los compresores); cuando se quiere reordenar la secuencia en la que el técnico revisa el equipo; cuando un ítem del checklist ya no aplica y hay que retirarlo de las inspecciones futuras.

**Cosas importantes / errores comunes.** Es fundamental entender que cambiar este checklist es hacia adelante, no hacia atrás: las órdenes de trabajo ya creadas mantienen exactamente el checklist con el que se recibió el equipo en su momento, como constancia legal de lo que llegó o no llegó con el equipo. No se debe usar esta pantalla esperando "corregir" el checklist de una OT antigua — eso no es posible ni deseable, porque rompería la evidencia de lo recibido en su momento.

---

## Usuarios

### Qué es y para qué sirve

Es la pantalla donde el Admin administra quién puede entrar a la aplicación y con qué rol y sede. Aquí **NO se crean cuentas de usuario nuevas** (eso se hace en un panel técnico de Supabase, fuera de esta app) — aquí solo se gestiona el rol (Admin, Bodeguero, Vendedor, Técnico), la sede donde trabaja por defecto cada persona, y si su cuenta está activa o inactiva.

### Qué encuentra al entrar

Un encabezado con contadores: total de usuarios, cuántos están activos, y cuántos hay de cada rol (Admin, Vendedores, Bodegueros, Técnico). Un botón "Nuevo usuario" que aparece apagado (deshabilitado) — al pasar el mouse por encima explica que la creación de cuentas se hace en Supabase Auth. Justo debajo, un aviso azul que confirma esto: "Agrega primero la cuenta en Supabase (Dashboard → Authentication → Users). Aquí se gestiona rol, sede y estado activo", y aclara que existe una protección: **ningún Admin puede desactivar su propia cuenta ni cambiar su propio rol o sede desde aquí**, sin importar si hay otros Admin activos o no — es una regla fija de "no te dispares en el pie", no una excepción solo para cuando eres el único.

Hay una barra de búsqueda para filtrar usuarios por nombre, rol o sede (con una pequeña espera de 400 milisegundos mientras escribes, para no buscar en cada tecla). Luego la lista de usuarios (tabla en computador, tarjetas en celular) con: un avatar circular con las iniciales del nombre y un color según su rol, Nombre (con una etiqueta "gestionado en Auth" indicando que el correo/contraseña no se maneja aquí), Rol (con una etiqueta de color), Sede default (la sede a la que pertenece principalmente), Estado (Activo/Inactivo), Última conexión (hace cuánto tiempo entró por última vez, o "Nunca" si no ha ingresado), un resumen en texto de qué puede hacer ese rol en la aplicación, y botones de Editar y Activar/Desactivar. Al pie de la lista hay un resumen de cuántos usuarios hay por sede y cuándo fue la última actividad de cualquier usuario en todo el sistema.

### Cómo se usa paso a paso

**Dar de alta a un empleado nuevo.** Esto tiene dos partes, en dos lugares distintos: 1) Primero, en el panel de Supabase (Dashboard → Authentication → Users), se crea la cuenta de acceso con su correo y su PIN de 4 dígitos como contraseña — este paso técnico normalmente lo hace quien administra el sistema. 2) Luego, esa persona aparece automáticamente en esta pantalla de Usuarios, donde el Admin entra a "Editar" y le asigna el Rol correcto (Admin, Bodeguero, Vendedor o Técnico) y la Sede donde va a trabajar, y confirma que esté "Activo".

**Cambiar el rol o la sede de alguien.** 1) Busca al usuario (con la barra de búsqueda si hay muchos). 2) Clic en "Editar" (el lápiz). 3) En la ventana que se abre, cambia el campo Rol (Admin/Bodeguero/Vendedor/Técnico) o el campo Sede. 4) Marca o desmarca la casilla "Usuario activo" si quieres cambiar su estado desde aquí también. 5) Clic en "Guardar".

**Desactivar a alguien que se retira de la empresa (o activar a alguien que vuelve).** Clic en el ícono de encendido junto a su nombre (o el botón "Desactivar"/"Activar" en celular). El sistema pide confirmar la acción, y si la persona tenía una sesión abierta en su celular o computador, se cerrará automáticamente la próxima vez que la app intente comunicarse con el servidor.

### Cuándo usarla

- Cuando se contrata a alguien nuevo (después de crear su cuenta en Supabase).
- Cuando alguien cambia de puesto (por ejemplo, pasa de Vendedor a Bodeguero) o de sede.
- Cuando alguien se va de la empresa y hay que quitarle el acceso.
- Cuando alguien regresa después de una ausencia y hay que reactivar su cuenta.
- Cuando se quiere revisar rápidamente cuánta gente hay activa por sede o quién no ha entrado en mucho tiempo.

### Cosas importantes a tener en cuenta

- La regla más importante de esta pantalla es la protección **anti-bloqueo**: **ningún Admin puede desactivar su propia cuenta, nunca — así tenga compañía de otros Admin activos o no.** El bloqueo real (en el servidor y en la pantalla) aplica siempre a cualquier Admin que se intente desactivar a sí mismo, no solo a "el último administrador que queda". Eso sí: el botón de encendido/apagado solo aparece visualmente "bloqueado" con el mensaje "Eres el único Admin activo" cuando de verdad eres el único Admin activo — si hay otros Admin activos, tu propio botón se ve habilitado, pero al pulsarlo igual te va a rechazar la acción con el mismo mensaje de anti-bloqueo. Si de verdad hay que desactivar o cambiar el rol de un Admin, tiene que hacerlo OTRO usuario con rol Admin.
- **Nunca se borra un usuario de verdad: siempre se "desactiva"**, lo que conserva todo su historial de movimientos, ventas, órdenes de trabajo, etc., asociado a su nombre, pero le impide seguir entrando a la aplicación.
- Si necesitas cambiar el correo o el PIN de acceso de alguien, eso se hace en Supabase Auth, no en esta pantalla — aquí solo se gestionan rol, sede y estado activo/inactivo.
- Cada rol tiene permisos distintos y fijos en el sistema (no se pueden personalizar permiso por permiso desde aquí). El texto exacto que ves en la columna "Permisos resumen" de cada fila es: **Admin** — Acceso completo · /ops + /admin; **Bodeguero** — Inventario · Compras · Traspasos · Devoluciones · Garantías · Herramientas; **Vendedor** — Inventario · Ventas · Cotizaciones · Recibos · Devoluciones · Garantías · Herramientas; **Técnico** — Inventario · OT · Ensambles · Herramientas. Es un resumen informativo para ubicarte rápido — el cambio de rol sí cambia automáticamente todos los permisos reales de fondo, aunque ese texto en pantalla sea solo una guía y no liste absolutamente cada pantalla a la que ese rol puede entrar.
