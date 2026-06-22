# Prompt para Claude design — Rediseño del módulo "Órdenes de Trabajo" (OT)

> Copia todo lo de abajo y pégalo en Claude design.

---

Eres un diseñador de producto y front-end senior. Necesito que diseñes la **nueva experiencia del módulo de Órdenes de Trabajo (OT)** de una app web (PWA) de gestión de inventario y taller para una empresa colombiana de compresores y herramientas neumáticas (Compresores del Valle). La app ya existe (React 19 + Vite + Tailwind + Zustand, backend Supabase); tú diseñas e implementas el front de este módulo siguiendo el sistema de diseño existente. Entrega componentes React funcionales con Tailwind, listos para integrarse.

## 1. Contexto del negocio

La empresa repara equipos (compresores, cabezotes, herramientas neumáticas) que los clientes llevan al taller. Es una empresa de "toderos": **6 usuarios, todos hacen de todo**. Hoy el módulo de OT está roto y confuso; lo estamos rediseñando para que sea **un flujo guiado, ordenado e infalible**: si un paso no se completa, el sistema no deja avanzar al siguiente.

Una **OT es, a la vez, una cotización y una venta en sí misma**: cuando llega el equipo se cotiza el arreglo, el cliente abona, se repara y al recoger se convierte en venta. No se usa el módulo de Ventas ni el de Cotizaciones: la OT es autocontenida.

## 2. El flujo completo (7 pasos) — diséñalo como un asistente (stepper)

Quiero un **stepper de 7 pasos** como columna vertebral de la pantalla de detalle de la OT. Cada paso se completa antes de pasar al siguiente. El usuario nunca debe perderse: en cada paso se ve claramente "qué sigue" y "qué falta para avanzar".

**Paso 1 — Recepción** (la hace la vendedora). Llega el cliente con su equipo. Se registran: datos del cliente (nombre, teléfono, identificación), descripción del equipo y serie, y un **checklist de "cómo llegó el equipo"** (marcar qué componentes traía: compresor, motor, manómetro, correa, filtros, etc. — lista de ~24 ítems). Importante: lo que **falte** marcado NO es lo que se va a reparar (el cliente pudo dejar el filtro en casa); el checklist es solo constancia del estado de recepción. Al terminar, se **imprime una constancia** para el cliente (sin valores económicos todavía). Requisito para avanzar: equipo descrito + checklist tocado.

**Paso 2 — Diagnóstico** (lo hace el técnico, ya asignado). El técnico revisa el equipo y escribe qué hay que hacer (ej.: "cambio de automático, mantenimiento, empaquetadura, cambio de aceite"). Requisito para avanzar: diagnóstico escrito.

**Paso 3 — Cotización** (la hace la vendedora). Con base en el diagnóstico, se arma la cotización **dentro de la misma OT**: se agregan los **repuestos** (buscador de productos; cada repuesto se cobra a **precio de venta**) y se fija la **mano de obra**. Se puede elegir **IVA** (0% sin IVA / 19% con IVA, igual que en el módulo de ventas) y un **descuento** opcional. Se ve el total en vivo. Esta cotización se le envía/muestra al cliente. Requisito para avanzar: al menos un repuesto o mano de obra > 0.

**Paso 4 — Autorización + anticipo** (la hace la vendedora). El cliente aprueba. Para iniciar el trabajo se exige un **anticipo del 50%** (se registra como "anticipo", con método de pago). Se muestra el **saldo pendiente** en vivo. Requisito para avanzar: cliente aprobó **y** anticipo registrado.

**Paso 5 — Descarga + trabajo** (técnico / bodega). Se **descargan los repuestos del inventario** (salen del stock) y el técnico ejecuta la reparación. Si falta un repuesto se puede pausar en "esperando repuesto". Requisito para avanzar: repuestos descargados (o confirmar "sin repuestos").

**Paso 6 — Terminado** (técnico). Marca el trabajo como terminado y escribe el "trabajo realizado". La OT queda "lista para recoger". Requisito para avanzar: trabajo realizado escrito.

**Paso 7 — Recogida → Venta** (vendedora). El cliente viene, paga el **saldo** restante y se pulsa **"Convertir a venta / Entregar"** (con confirmación). En ese momento la OT **se convierte en venta** (el ingreso se registra ahí, en la recogida — no antes) y se **imprime la factura final** con total, anticipos y saldo. Requisito: saldo cubierto.

> Nota de negocio clave: los productos salen del inventario en el paso 5, pero **la venta/ingreso se reconoce solo en el paso 7 (recogida)**, porque el cliente a veces se demora días o semanas en recoger.

## 3. Estados de la OT (para colorear el stepper y la lista)

`recepcion → diagnostico → cotizada → autorizada → en_proceso (o esperando_repuesto) → terminada → entregada`. Más `cancelada` (solo Admin). En el stepper: pasos completados en **verde**, paso actual en **azul/primario**, pasos futuros bloqueados en **gris**.

## 4. Permisos (muy importante para la UI)

- **Todos los roles VEN las OT de todas las sedes** (lista y detalle).
- Pero **solo pueden MANIPULAR las OT de su PROPIA sede**. Si abren una OT de otra sede, la pantalla va en **modo solo lectura**: el stepper se ve pero los botones de acción están deshabilitados, con un aviso tipo "Esta OT es de la sede X; solo lectura".
- **Cancelar/anular** una OT: solo el rol **Admin** ve y usa esa acción.
- Roles: Admin, Vendedor, Tecnico, Bodeguero. Cualquier rol de la sede puede ejecutar cualquier paso (empresa de toderos); no restrinjas pasos por rol, solo por sede.

## 5. Pantallas a diseñar

1. **Lista / tablero de OT** (ya existe, mejórala para el nuevo flujo): vista lista (tabla en desktop, cards en móvil) y vista kanban por estado. Filtros por estado, búsqueda por cliente/equipo/serie. Cada OT muestra: número, cliente, equipo, estado (pill de color), sede, días en taller, total y saldo. Marcar visualmente las OT de **otra sede** (solo lectura) y las **vencidas** (>30 días sin recoger).
2. **Detalle de la OT** (lo central): el **stepper de 7 pasos** arriba, y debajo el **panel del paso actual**. Cada panel es su propia tarjeta con su acción y un aviso claro de "qué falta para avanzar". Incluye paneles laterales/secundarios siempre visibles: resumen económico (total, anticipos, saldo), datos de cliente/equipo, técnico asignado, y un historial de eventos.
3. **Impresiones**: dos formatos — constancia de recepción (paso 1, sin valores) y factura final (paso 7, con total + anticipos + saldo).

## 6. Requisitos de UX (operarios industriales)

- **Móvil primero** (se usa desde celular/tablet en el taller): en móvil el stepper es un **acordeón vertical**; en desktop, horizontal.
- Botones grandes (mínimo 48px de alto — se usan con guantes).
- Buscador de repuestos con resultados claros (referencia, nombre, stock, precio).
- Teclados numéricos cómodos para montos.
- Estados de color con alto contraste; el usuario debe entender el estado sin leer.
- Mensajes de gating explícitos y amables ("Falta registrar el anticipo del 50% para continuar").

## 7. Sistema de diseño (OBLIGATORIO — úsalo, no inventes colores)

Usa tokens CSS (HSL), nunca hardcodees colores. Tokens disponibles:
`--background` (fondo), `--foreground` (texto), `--card` (fondo de tarjetas), `--card-foreground`, `--primary` (azul de marca ~#245A8C), `--primary-foreground`, `--muted` y `--muted-foreground` (textos/fondos sutiles), `--border` (bordes), `--destructive` (rojo, errores/anulación), `--success` (verde, OK/aprobado), `--warning` (naranja, stock bajo/pendiente), `--info` (azul claro).

Ejemplo correcto: `style={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}`. Tipografía: "IBM Plex Sans". Tarjetas redondeadas (`rounded-xl`), bordes sutiles, headers de sección en mayúsculas pequeñas con `--muted-foreground`. Patrón de página: wrapper con `p-4 sm:p-6 space-y-4`, un PageHeader con título/descripción/acciones, y tarjetas tipo "SectionCard" (header + body). Desktop = tabla; móvil = lista de cards. Estados con un componente tipo `StatusBadge`.

## 8. Modelo de datos (campos reales que maneja cada paso)

- OT: `numero`, `cliente_nombre/telefono/identificacion`, `equipo_descripcion`, `equipo_serie`, `diagnostico`, `trabajo_realizado`, `tecnico` (asignado), `sede`, `estado`, `costo_mano_obra`, `valor_repuestos` (a precio), `valor_revision` (cobro si el cliente no autoriza), `iva_pct` (0 o 19), `descuento_valor`, `total`, `fecha`, `fecha_entrega`.
- Repuestos (líneas): producto (referencia + nombre), `cantidad`, `precio_unitario` (precio de venta), `subtotal`.
- Anticipos: `monto`, `metodo_pago` (efectivo/transferencia/tarjeta/otro), `fecha`. Saldo = `total − suma(anticipos)`.
- Checklist de recepción: lista de componentes con marcado sí/no.

## 9. Qué entregar

- Componentes React + Tailwind: la pantalla de **detalle con stepper** y sus **7 paneles de paso**, el **componente stepper** (desktop horizontal / móvil acordeón), y la **lista/kanban** de OT.
- Maneja los estados visuales (completado/actual/bloqueado), el modo **solo lectura** (OT de otra sede), los avisos de gating, el resumen económico en vivo (total/anticipos/saldo) y los dos formatos de impresión.
- Prioriza claridad y que el operario **no se pierda nunca**: el siguiente paso y lo que falta deben ser obvios en todo momento.

Diseña con criterio premium pero sobrio (es una herramienta de trabajo diaria, no marketing): limpio, legible, rápido, con jerarquía visual clara y foco en el paso actual.
