# Informe de correcciones y mejoras del sistema

**Compresores del Valle S.A.S.**
**Fecha:** 15 de julio de 2026
**Asunto:** Correcciones de la fase post-despliegue — órdenes de trabajo, modo oscuro, ensambles, herramientas y equipos ensamblables
**Estado:** Correcciones de base de datos aplicadas en producción. Los ajustes de pantalla quedan en el código y llegan a cada dispositivo al actualizar la app (ver nota sobre la PWA al final).

> Continúa la fase de correcciones iniciada en el informe del 28 de junio de 2026
> (`docs/informe-correcciones-clienta-2026-06-28.md`). Este documento cubre lo
> trabajado a partir de los reportes de la clienta de julio.

---

## 1. Resumen ejecutivo

En esta ronda se atendieron reportes de la clienta sobre el flujo de órdenes de
trabajo, la legibilidad en modo oscuro, el módulo de ensambles, el préstamo de
herramientas y el catálogo de equipos ensamblables. Para cada reporte se
verificó primero **si era un error real de la aplicación o un mal uso / mala
interpretación**, se probó en producción de forma segura (transacciones que se
revierten, sin dejar datos de prueba) y solo entonces se corrigió.

Además se reforzó un principio de diseño pedido por la clienta: **la aplicación
siempre debe comunicarse con el usuario** — si algo no deja hacerse, debe
explicar por qué, qué hacer y a quién acudir; nadie debe quedar perdido ante un
error.

| #   | Corrección / diagnóstico                                                        | Tipo           | Impacto |
| --- | ------------------------------------------------------------------------------- | -------------- | ------- |
| 1   | OT: la cotización obligaba a poner mano de obra aunque el cliente no autorizara | Error de flujo | Medio   |
| 2   | Modo oscuro: las listas desplegables (`<select>`) eran ilegibles                | Error visual   | Medio   |
| 3   | Ensambles: cambiar la cantidad de un insumo fallaba siempre                     | Error real     | Alto    |
| 4   | Herramientas: no se podía dar de alta más de 1 unidad a la vez                  | Error de flujo | Alto    |
| 5   | Herramientas: el aviso de préstamo parcial se cerraba sin verse                 | Error de aviso | Medio   |
| 6   | Herramientas: dar de baja ("consumida") no dejaba rastro en el historial        | Auditoría      | Bajo    |
| 7   | Equipos ensamblables: se duplicaba el inventario al crear un equipo             | Error real     | Alto    |
| 8   | Ensambles: el costo promedio quedaba en $0 y había que escribirlo a ciegas      | Mejora de uso  | Medio   |
| 9   | Herramientas: sumar unidades a una herramienta que ya existe                    | Función nueva  | Alto    |
| 10  | Herramientas: el botón "+" del préstamo ya no queda mudo (explica y anima)      | Comunicación   | Medio   |
| 11  | Limpieza del cabezote 2080 duplicado en producción                              | Dato en prod   | —       |
| —   | Diagnóstico: "la caja de hoy no me da" (Almacén CV)                             | Uso, no error  | —       |
| —   | Diagnóstico: la OT cobraba "doble" mano de obra + revisión                      | Interpretación | —       |

---

## 2. Correcciones al detalle

### 1. Órdenes de trabajo — cotización opcional cuando el cliente no autoriza

**Reporte:** al crear una OT, el paso de _Cotización_ obligaba a poner mano de
obra (o un repuesto) para poder avanzar. Pero cuando el cliente **no** va a
autorizar la reparación no hay nada que cotizar: solo se cobra la revisión, que
se define en el paso siguiente.

**Corrección:** se quitó esa exigencia del paso de cotización (puede quedar
vacía) y se movió al **inicio del trabajo**, separada según la decisión del
cliente: si **no autoriza**, se exige el valor de revisión; si **sí autoriza**,
se exige al menos un repuesto o mano de obra; si no se ha decidido, no deja
iniciar. El anticipo sigue siendo opcional.

> Commit `fa3d421`. Cambio de base de datos aplicado en producción.

### 2. Modo oscuro — listas desplegables ilegibles

**Reporte:** en modo oscuro, al abrir una lista desplegable, las opciones se
veían casi invisibles (texto claro sobre fondo claro).

**Corrección:** un solo ajuste de estilos que corrige de una vez las 22 listas
de toda la aplicación, además de los selectores de fecha y las barras de
desplazamiento en modo oscuro.

> Commit `e6a8e68`. Solo pantalla.

### 3. Ensambles — cambiar la cantidad de un insumo fallaba siempre

**Reporte:** dentro de un ensamble, editar la cantidad de un componente "no
servía".

**Diagnóstico:** error real. Al ajustar la cantidad, el sistema intentaba
registrar el movimiento de inventario con un tipo mal formado internamente, y
la operación se revertía siempre.

**Corrección:** se ajustó ese registro. Verificado en producción: subir, bajar,
quitar, terminar y completar un ensamble ahora cuadran en inventario y costo.

> Commit `e2d1400`. Cambio de base de datos aplicado en producción.

### 4. Herramientas — no dejaba dar de alta más de una unidad

**Reporte:** "no deja elegir para préstamo más de una". La lógica de préstamo
por lote ya funcionaba, pero **el alta de herramientas creaba una sola unidad
por vez**, así que casi nunca había más de una disponible de la misma
referencia y el contador de cantidad quedaba topado en 1.

**Corrección:** el formulario de nueva herramienta ahora permite indicar
**cuántas unidades crear de una vez** (tanto desde insumo como manual).

> Commit `499cff8`. Cambio de base de datos aplicado en producción.

### 5. Herramientas — el aviso de préstamo parcial no se veía

**Reporte / hallazgo:** cuando un préstamo por lote se completaba parcialmente
(se pedían 5, solo había 3), el aviso "solo se prestaron 3 de 5" aparecía y el
cuadro se cerraba en el mismo instante, así que nunca se alcanzaba a leer.

**Corrección:** ahora el aviso reemplaza el formulario por una confirmación
explícita que el usuario debe cerrar a propósito.

> Commit `499cff8`. Solo pantalla.

### 6. Herramientas — dar de baja no dejaba rastro

**Hallazgo:** al marcar una herramienta como "consumida" (dada de baja), no se
registraba ningún movimiento en el historial de inventario, a diferencia de
"devolver a insumo" que sí lo hace.

**Corrección:** ahora la baja deja un movimiento informativo (que no altera el
stock) para que quede constancia.

> Commit `499cff8`. Cambio de base de datos aplicado en producción.

### 7. Equipos ensamblables — se duplicaba el inventario

**Reporte:** "me está doblando el inventario"; a veces no dejaba crear un equipo
y otras veces creaba un repetido.

**Diagnóstico:** error real. El formulario de "Nuevo equipo ensamblable"
**siempre creaba un producto nuevo** y solo comparaba un campo de código, pero
los productos del catálogo guardan su código en otro campo. Por eso el sistema
no detectaba el choque y dejaba crear un cabezote/compresor repetido.

**Corrección:** el formulario ahora tiene dos caminos —

- **Desde el inventario** (recomendado): busca el producto que ya existe (por
  nombre o por cualquiera de sus códigos) y solo lo marca como ensamblable, sin
  duplicar.
- **Crear nuevo**: solo si de verdad no existe; antes de crear valida que no
  haya ya un producto con ese nombre o código y, si lo hay, ofrece usar ese en
  vez de duplicarlo.

> Commit `b22eecf`. Solo pantalla.

### 8. Ensambles — costo promedio en $0

**Reporte:** tras ensamblar con piezas del inventario, el costo promedio del
producto seguía en $0.

**Aclaración:** el ensamble **sí calcula** el costo de los materiales, pero a
propósito no lo aplica solo al costo promedio del producto: esa confirmación la
hace el administrador, para no distorsionar el promedio cuando ya hay stock
anterior a otro costo.

**Mejora:** al abrir "Editar costo" de un producto ensamblado, ahora aparece
**precargado el costo de materiales del último ensamble** como valor sugerido,
con un botón "Usar este valor". Ya no hay que escribir el número a ciegas.

> Commit `b22eecf`. Solo pantalla.

### 9. Herramientas — sumar unidades a una que ya existe

**Necesidad:** para prestar varias unidades de una herramienta que ya estaba
registrada como una sola, no había forma sencilla de sumarle más.

**Función nueva:** botón **"Agregar unidades"** en el detalle de cada
herramienta (Admin/Bodega). Suma N unidades físicas de esa misma herramienta;
si es inventariable salen del stock de insumo, si es manual crea N filas
iguales. Después de esto, el préstamo por lote sí deja prestar varias.

> Commit `56a97bb`. Cambio de base de datos aplicado en producción (limpieza de
> una función que había quedado duplicada al agregar el parámetro de cantidad).

### 10. Herramientas — el botón "+" ya no queda mudo

**Pedido de la clienta:** "si el botón no deja, debe decir por qué; el usuario
no puede quedar perdido ante ningún error".

**Corrección:** en el préstamo, cuando se intenta subir la cantidad más allá de
lo disponible, aparece un **aviso animado** que explica _por qué_ no deja ("solo
hay X disponibles de esta herramienta en la sede") y _qué hacer_ ("agrégalas con
'Agregar unidades'"). Cuando solo hay una unidad, se muestra además un texto
fijo explicándolo.

> Commit `56a97bb`. Solo pantalla.

### 11. Limpieza del cabezote 2080 duplicado (dato en producción)

Como consecuencia del punto 7, había quedado un **CABEZOTE 2080 RF 5HP SEG**
(código CSR2080) registrado dos veces. Con autorización de la gerencia se
limpió en producción: se marcó como ensamblable el producto **real** del
catálogo, se redirigió el ensamble en curso (#23, Almacén CV) hacia el producto
real, y el duplicado se **retiró** (inactivo, fuera de ensamblables, con la
referencia liberada). No se borró nada de forma irreversible; se verificó antes
que el duplicado no tuviera ventas, compras, inventario ni movimientos.

---

## 3. Diagnósticos que NO eran errores de la aplicación

Parte del trabajo fue distinguir errores reales de malos usos o
malinterpretaciones. Estos dos casos se revisaron a fondo y resultaron correctos
en el sistema:

- **"La caja de hoy no me da" (Almacén CV).** La diferencia correspondía a
  **salidas de efectivo no registradas** (pagos y consignaciones que salieron de
  la caja sin anotarse). Las ventas cuadraban al peso. No era un error del
  sistema. Queda como oportunidad de mejora un concepto de "salida de efectivo /
  consignación" para registrar ese dinero sin afectar el margen.

- **La OT "cobraba doble" mano de obra + revisión.** Se verificó una OT real: el
  total era correcto. Cuando el cliente **no autoriza**, solo se cobra la
  revisión (la mano de obra que se hubiera puesto no se suma). Era una
  interpretación, no un cobro doble. Aun así se corrigió la incomodidad de que
  el paso de cotización obligara a poner mano de obra (ver corrección #1).

---

## 4. Notas técnicas

- **Todas** las correcciones de base de datos se probaron en producción con
  transacciones que se revierten (sin dejar datos de prueba) antes de aplicarse
  de forma definitiva.
- Los cambios se publican en los dos repositorios del proyecto.
- **La aplicación es una PWA:** cada dispositivo guarda una copia del programa
  para cargar rápido. Cuando sale una actualización, el equipo debe **cerrar por
  completo la app y volver a abrirla** (en computador: recargar con
  Ctrl+Shift+R) para recibir la versión nueva. Si un cambio "no aparece", casi
  siempre es esto.

---

## 5. Pendientes / decisiones abiertas

- Concepto de **"salida de efectivo / consignación"** para el flujo de caja (a
  confirmar si se construye).
- Definir si el **manual del Panel de Administrador** y sus capturas se versionan
  en el repositorio o se mantienen solo en el equipo (las capturas contienen
  datos reales del negocio).
