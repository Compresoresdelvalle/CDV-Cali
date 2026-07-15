# Registro de revisión de problemas — Compresores del Valle

Campaña de auditoría profunda sección por sección sobre la rama `revision-de-problemas`.
Cada sección se audita con una flota multi-agente (Fable orquesta y sintetiza; subagentes Sonnet 5 ejecutan) que cubre backend/Postgres, forense de datos en producción (solo lectura), frontend, contrato frontend↔backend, lógica de negocio y UX, con verificación adversarial de cada hallazgo técnico.

**Reglas fijas:** base de datos de producción solo lectura durante la auditoría; ninguna corrección se implementa sin aprobación explícita; un commit por sección; nada de DELETE físico ni cambios en auth o en el candado append-only de `movimientos`.

**Leyenda de estado:** `REPORTADO` (pendiente de aprobación) · `APROBADO` (a implementar) · `CORREGIDO` (con commit) · `DESCARTADO` · `DECISIÓN` (requiere definición de negocio).

**Severidad:** P0 = dinero o pérdida/corrupción de datos · P1 = funcional serio · P2 = fricción / pulido / robustez.

---

## Sección 1 — Ventas y pagos

**Auditada:** 2026-07-15 · **Estado:** resultados entregados, pendiente de aprobación.
**Alcance:** VentaNueva, VentaDetalle, VentaHistorial, ventas-ui, ventaPOS (PDF), ModalCambioProducto, ClientePicker; RPCs `fn_registrar_venta`, `fn_anular_venta`, `fn_registrar_cambio`, `fn_upsert_cliente`; triggers de `ventas`/`detalle_venta`; tablas `ventas`, `detalle_venta`, `pagos_venta`, `movimientos`, `clientes`.
**Resultado de la cacería:** 35 hallazgos crudos → 27 problemas únicos (2 P0, 10 P1, 15 P2). Verificación adversarial: 30 confirmados, 1 plausible, 0 refutados, 4 de UX curados directamente.

### P0 — Crítico (dinero / seguridad)

| ID    | Tipo           | Título                                                                       | Ubicación                                                                                     | Estado    |
| ----- | -------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------- |
| S1-01 | Seguridad      | RLS permite escribir `ventas` directo por REST, evadiendo las funciones      | pg_policies `ventas_insert`/`ventas_update`; `detalle_venta` sin política INSERT              | REPORTADO |
| S1-02 | Lógica-negocio | Sin tope de descuento ni precio mínimo: cualquier vendedor puede vender a $0 | `fn_registrar_venta`, `trg_recalcular_total_venta`, `usuarios.puede_descuento_alto` (sin uso) | REPORTADO |

**S1-01.** Las políticas `ventas_insert` y `ventas_update` habilitan a cualquier `authenticated` (Admin/Vendedor) a hacer `POST`/`PATCH` directo a `/rest/v1/ventas`. El único trigger en `ventas` (`trg_ventas_proteger_anulacion`) solo protege la columna `anulada`; el resto (`total`, `metodo_pago`, `cuenta_bancaria`, descuentos) queda libre. Un `PATCH` puede cambiar el total de una venta ya cobrada sin dejar rastro en `movimientos`; un `POST` crea una venta con total arbitrario y cero ítems (el recálculo vive en `detalle_venta`, que no tiene política INSERT para `authenticated`). Verificado contra pg_policies/pg_trigger/pg_proc reales.
**Fix propuesto:** revocar INSERT/UPDATE directos de `authenticated` en `ventas` (toda escritura por funciones `SECURITY DEFINER`), o trigger `BEFORE UPDATE` que congele las columnas financieras salvo vía las funciones con el patrón GUC ya usado para `anulada`.

**S1-02.** No existe tope de descuento server-side. La columna `usuarios.puede_descuento_alto` existe pero nunca se consulta; la migración que la creó dice textualmente que el tope "queda pendiente de que el cliente defina el límite" y no se implementó. Ni `fn_registrar_venta` ni el trigger validan un precio mínimo. **El forense encontró 3 ventas reales con descuentos de 50%, 83% y 100%.**
**Fix propuesto:** definir con el negocio el límite (p. ej. % máximo sin autorización) y aplicarlo en `fn_registrar_venta`, exigiendo `puede_descuento_alto` por encima del tope. Requiere una definición del cliente antes de codificar.

### P1 — Funcional serio

| ID    | Tipo             | Título                                                                                                           | Ubicación                                                                 | Estado    |
| ----- | ---------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------- |
| S1-03 | Datos/privacidad | Teléfono/email/dirección de un cliente se filtran a otro al editar el nombre a mano                              | VentaNueva.jsx:53-55, 469-477, 596-607                                    | REPORTADO |
| S1-04 | Bug              | Desglose de pago mixto invisible en el detalle y en el recibo impreso                                            | VentaDetalle.jsx:577-605; ventaPOS.js:206-217                             | REPORTADO |
| S1-05 | Bug/negocio      | El recibo POS de una venta anulada se imprime sin ninguna marca de "ANULADA"                                     | VentaDetalle.jsx:339-348; ventaPOS.js                                     | REPORTADO |
| S1-06 | Bug              | "Cargar más" desaparece al buscar por texto: ventas fuera de la página cargada quedan inalcanzables              | VentaHistorial.jsx:90-103, 335-344                                        | REPORTADO |
| S1-07 | Lógica-negocio   | Anular una venta "cambio de producto" por otra vía duplica el stock del producto nuevo                           | `fn_anular_venta` (no distingue origen 'cambio'); VentaDetalle.jsx        | REPORTADO |
| S1-08 | Lógica-negocio   | Anular una venta tras un cierre ya generado deja ese cierre desactualizado para siempre                          | `fn_anular_venta`, `_fn_cierre_totales`, `trg_no_modify_cierre`           | REPORTADO |
| S1-09 | Lógica-negocio   | Venta a crédito sin cliente identificado: deuda sin dueño en Cuentas por Cobrar                                  | `fn_registrar_venta`; VentaNueva.jsx:593                                  | REPORTADO |
| S1-10 | Lógica-negocio   | `fn_registrar_venta` no exige cuenta bancaria en pagos electrónicos (solo la UI la pide)                         | `fn_registrar_venta` (método simple y `p_pagos`)                          | REPORTADO |
| S1-11 | UX/bug           | Cambiar la sede en Nueva Venta vacía el carrito completo sin advertencia                                         | VentaNueva.jsx:336-343                                                    | REPORTADO |
| S1-12 | DECISIÓN         | Venta sin stock: producción la BLOQUEA, contradiciendo la política documentada; `NegativoModal` es código muerto | `trg_venta_descontar_stock` (mig. 20260610000025); VentaNueva.jsx:401-417 | DECISIÓN  |

**S1-03.** `clienteTelefono/Email/Direccion` son estado oculto que solo se llena al elegir un cliente del picker y nunca se limpia si luego se edita el nombre a mano. Al confirmar, `fn_upsert_cliente` puede asignar los datos de contacto de un cliente al nombre de otro. Fix: limpiar esos campos en `onChange` cuando el texto deja de coincidir con el cliente seleccionado (o solo enviarlos si el nombre final coincide exactamente).

**S1-04.** Una venta "Mixto" guarda el desglose real (efectivo/transferencia + cuenta) en `pagos_venta`, pero ni VentaDetalle ni el recibo consultan esa tabla: muestran "Mixto · 1 movimiento" y el total. Quien cuadra caja no puede saber cuánto entró en efectivo ni a qué cuenta. Fix: cargar `pagos_venta` por `venta_id` y renderizar una fila por forma de pago; pasar la lista a `generarVentaPOS`. (Reportado también como contrato/BE-1 y ux/UX-2.)

**S1-05.** "Imprimir recibo" solo se deshabilita mientras imprime, nunca cuando `venta.anulada` es true, y `generarVentaPOS` no estampa ninguna marca. Un recibo de venta anulada sale idéntico a uno válido. Fix: ocultar/deshabilitar el botón si está anulada, o estampar sello "ANULADA".

**S1-06.** El filtro de texto es client-side sobre lo ya paginado y el botón "Cargar más" se oculta cuando hay texto que no es fecha. Si el registro está en una página no cargada, no hay forma de alcanzarlo. Fix: no condicionar "Cargar más" a la búsqueda, o mover la búsqueda de texto a server-side (`.ilike`).

**S1-07.** Un "cambio de producto" reingresa el viejo por devolución y descuenta el nuevo como venta normal, sin marcador en `ventas` (solo texto en observaciones). VentaDetalle oculta el botón "Anular" por ese texto, pero `fn_anular_venta` no lo impide: anular por otra vía reingresa el nuevo dos veces. Fix: marcar el origen 'cambio' en `ventas` y que `fn_anular_venta` lo bloquee o compense.

**S1-08.** Los cierres son inmutables y calculan por `v.fecha` con `anulada=false`. Anular al día siguiente de cerrar no ajusta el cierre histórico: queda con un ingreso que ya no existe. Fix: al anular dentro de un rango ya cerrado, avisar y/o generar un ajuste visible en el período actual.

**S1-09.** `p_cliente_nombre` es opcional para todo método, incluido Crédito. Se puede dejar una cuenta por cobrar sin nombre. Fix: exigir cliente identificado cuando el método es Crédito (UI + servidor).

**S1-10.** A diferencia de `fn_registrar_pago_cuenta`, `fn_registrar_venta` inserta en `pagos_venta` sin exigir cuenta cuando el método es electrónico. Un pago por transferencia puede quedar con cuenta NULL y caer en el bucket sin cuenta del arqueo. Fix: replicar la validación (`metodo in (transferencia,tarjeta) ⇒ cuenta obligatoria`).

**S1-11.** `onChangeSede` hace `setCarrito([])` sin confirmación. Un click accidental del Admin borra todo el carrito. Fix: confirmar antes de vaciar si `carrito.length > 0`, o revalidar ítems en vez de vaciar.

**S1-12 (DECISIÓN).** El contexto y la memoria dicen "venta sin stock permitida (inventario negativo con aviso)". Producción hace lo contrario: la migración `20260610000025` revirtió esa decisión el 2026-06-10 (por una falla de sobreventa por concurrencia) y hoy el backend **bloquea** con "Stock insuficiente" + `CHECK (cantidad >= 0)`, y el frontend bloquea antes del RPC. Como consecuencia, `NegativoModal` (~60 líneas) es código muerto. **No es un bug claro: es una contradicción entre lo documentado y lo desplegado.** Necesito tu decisión: ¿la política vigente es bloquear (y entonces limpiamos el código muerto y actualizamos CLAUDE.md) o volver a permitir negativo con aviso (resolviendo la concurrencia de otra forma)?

### P2 — Fricción / robustez / pulido

| ID    | Tipo              | Título                                                                                                              | Ubicación                                                          | Estado    |
| ----- | ----------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------- |
| S1-13 | Bug               | `fn_upsert_cliente` no es `SECURITY DEFINER`: actualizar un cliente existente falla en silencio para no-Admin       | `fn_upsert_cliente`; policy `clientes_update`                      | REPORTADO |
| S1-14 | Datos             | `metodo_pago` sin validación/normalización server-side: variantes de casing quedan invisibles al filtrar por método | `ventas` (sin CHECK), `fn_registrar_venta`; VentaHistorial.jsx:57  | REPORTADO |
| S1-15 | Bug               | El modal de Cambio de producto no exige cuenta bancaria para la diferencia cobrada por Transferencia                | ModalCambioProducto.jsx:207-235                                    | REPORTADO |
| S1-16 | Bug               | Búsqueda de productos sin guardia anti-carrera: una respuesta vieja puede pisar una más nueva                       | VentaNueva.jsx:102-154                                             | REPORTADO |
| S1-17 | Bug               | El KPI "N hoy" usa la zona horaria del dispositivo en vez de America/Bogota                                         | VentaHistorial.jsx:106-115                                         | REPORTADO |
| S1-18 | Bug               | Un error real de carga en VentaDetalle se muestra igual que "venta inexistente"                                     | VentaDetalle.jsx:84-111                                            | REPORTADO |
| S1-19 | Bug               | Errores reales al agregar un producto por QR se tragan en silencio                                                  | VentaNueva.jsx:195-223                                             | REPORTADO |
| S1-20 | UX                | `garantiaVentaEstadoLabel` no traduce el estado 'anulada' (se ve crudo en minúscula)                                | ventas-ui.js:131-134                                               | REPORTADO |
| S1-21 | Lógica-negocio    | El reembolso de un cambio a favor del cliente siempre sale como caja menor en Efectivo, sin importar el método      | `fn_registrar_cambio` → `fn_registrar_caja_menor`                  | REPORTADO |
| S1-22 | Lógica-negocio    | Tolerancia de $1 en pago mixto puede acumular descuadre en el desglose por método                                   | `fn_registrar_venta` (validación `abs(suma-total) > 1`)            | REPORTADO |
| S1-23 | Datos (plausible) | `ventas.descuento_valor` se guarda sin clamp (el `total` sí queda protegido por el trigger)                         | `fn_registrar_venta`; VentaDetalle.jsx:224-225                     | REPORTADO |
| S1-24 | UX                | Ningún buscador (producto/cliente) muestra mensaje de "sin resultados"                                              | VentaNueva.jsx:763-829; ModalCambioProducto.jsx; ClientePicker.jsx | REPORTADO |
| S1-25 | UX                | Botones y objetivos táctiles por debajo de 48px en modales de Cambio y Garantía                                     | ModalCambioProducto.jsx; ModalAbrirGarantiaVenta.jsx               | REPORTADO |
| S1-26 | UX                | En móvil, "Confirmar venta" no queda accesible sin scrollear todo el formulario                                     | VentaNueva.jsx:574,1220; index.css:2411-2421                       | REPORTADO |
| S1-27 | UX                | "Confirmar venta" se deshabilita por pago mixto descuadrado sin explicación junto al botón                          | VentaNueva.jsx:1114-1129,1253-1266                                 | REPORTADO |

---

### Decisiones del usuario (2026-07-15)

- **S1-02 → DESCARTADO.** Vender a $0 es criterio del usuario (si regalan el producto, es su decisión); no es un error. No se implementa ningún tope de descuento ni precio mínimo.
- **S1-12 → BLOQUEAR (política vigente).** La venta sin stock queda bloqueada (comportamiento actual de producción). Se limpia el código muerto (`NegativoModal`) y se actualizará CLAUDE.md.
- **Alcance aprobado:** Todo (P0 + P1 + P2).
- **Ruta de modelos:** frontend implementado por Fable; los cambios a la base de datos de producción los ejecuta un agente Opus.

### Estado de implementación

**Frontend (Fable) — implementado, build + lint en verde (0 errores):**

- CORREGIDO: S1-03, S1-04, S1-05, S1-06, S1-11, S1-15, S1-16, S1-17, S1-18, S1-19, S1-20, S1-24, S1-25, S1-27, y la limpieza de código muerto de S1-12.
- DIFERIDO: **S1-26** (barra CTA fija en móvil). La navegación inferior es `sticky bottom-0` en el mismo contenedor de scroll; una barra `fixed` arriesga solaparla y no se pudo verificar en vivo (requiere login). Se hará en una pasada de layout móvil con verificación en dispositivo.

Archivos tocados (frontend): `src/pages/ops/VentaNueva.jsx`, `src/pages/ops/VentaDetalle.jsx`, `src/pages/ops/VentaHistorial.jsx`, `src/lib/pdf/ventaPOS.js`, `src/lib/ventas-ui.js`, `src/components/ventas/ModalCambioProducto.jsx`, `src/components/forms/ClientePicker.jsx`, `src/components/garantias/ModalAbrirGarantiaVenta.jsx`.

**Base de datos (Opus) — aplicado a producción y verificado con transacciones que revierten.**

Migración: `supabase/migrations/20260715000004_s1_ventas_hardening.sql` (incluye la definición original de cada función como comentario, para reversibilidad).

- CORREGIDO **S1-01**: `REVOKE INSERT/UPDATE/DELETE` de `authenticated`/`anon` en `ventas`, `detalle_venta`, `pagos_venta` (queda `SELECT`). Las RPCs `SECURITY DEFINER` (dueño `postgres`, `bypassrls`) siguen escribiendo; probado creando una venta en una transacción revertida.
- CORREGIDO **S1-10**: `fn_registrar_venta` exige cuenta bancaria en pagos electrónicos (método simple y cada pago del mixto).
- CORREGIDO **S1-09**: `fn_registrar_venta` exige cliente identificado en ventas a Crédito.
- CORREGIDO **S1-23**: `fn_registrar_venta` clampa `descuento_valor` a `[0, subtotal]`.
- CORREGIDO **S1-14**: nuevo helper `_fn_metodo_pago_canonico` normaliza `metodo_pago` al insertar (métodos no reconocidos como `Abonos OT` pasan intactos; sin CHECK ni cambio de datos legacy). Legacy fuera de canon: **1 fila** `'efectivo'` (candidata a limpiar aparte), 37 `'Abonos OT'` (legítimas, no tocar).
- CORREGIDO **S1-07**: `fn_anular_venta` rechaza anular la venta-diferencia de un cambio (marcador `observaciones LIKE 'Cambio por venta #%'`).
- CORREGIDO **S1-13**: `fn_upsert_cliente` pasa a `SECURITY DEFINER` (+ guard `auth.uid()`, y `REVOKE EXECUTE` a `anon`/`PUBLIC`); el Vendedor ya puede actualizar clientes existentes sin duplicar.
- CORREGIDO **S1-21**: el reembolso de un cambio a favor del cliente registra el egreso con el método real (señal transaccional GUC `cdv.caja_menor_metodo`/`_cuenta`), sin cambiar firmas ni romper otros callers. Frontend coordinado en `ModalCambioProducto` (cobro por transferencia envía cuenta; devolución/par van en efectivo).
- SIN CAMBIO **S1-22**: la tolerancia de $1 en pago mixto es redondeo deliberado (correcto).
- DIFERIDO **S1-08**: el aviso de "venta pertenece a un cierre ya generado" exige cambiar el retorno de `fn_anular_venta` de `void` a `jsonb` (`DROP+CREATE`, cambio de contrato). Sin callers internos y el frontend ignora el retorno, así que es retrocompatible; se hará en la Sección 3 (Cierres), donde vive la lógica de ajuste del cierre.

Advisors: la única alerta nueva es `fn_upsert_cliente` como `SECURITY DEFINER` (esperada, mismo patrón que otras 83 funciones del proyecto); la exposición a `anon` se cerró con el `REVOKE`.

### Notas de método

- Auditoría en solo lectura; ninguna escritura a producción durante la cacería.
- Verificación adversarial aplicada a los 31 hallazgos técnicos; los 4 de UX puro se curaron por criterio.
- Los identificadores S1-xx consolidan hallazgos que varios cazadores reportaron desde ángulos distintos (backend/frontend/contrato/negocio/ux).
