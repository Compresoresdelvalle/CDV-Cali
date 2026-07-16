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

### Notas de método (Sección 1)

- Auditoría en solo lectura; ninguna escritura a producción durante la cacería.
- Verificación adversarial aplicada a los 31 hallazgos técnicos; los 4 de UX puro se curaron por criterio.
- Los identificadores S1-xx consolidan hallazgos que varios cazadores reportaron desde ángulos distintos (backend/frontend/contrato/negocio/ux).

---

## Sección 2 — Órdenes de Trabajo

**Auditada:** 2026-07-15 · **Estado:** resultados entregados, pendiente de aprobación.
**Alcance:** OrdenNueva, OrdenDetalle (stepper 7 pasos), OrdenHistorial, ot-flujo.js, ordenes-ui.js, ordenPDF.js, componentes ot/*; RPCs `fn_generar_venta_ot`, `fn_cancelar_orden`, `fn_convertir_a_insumo`, `fn_generar_producto_segunda_ot`, `fn_asociar_cotizacion_a_ot`, `fn_total_abonos_ot`, abonos; triggers `trg_orden_*`, `trg_garantia_venta_cerrar_por_ot`; tablas `ordenes_servicio`, `detalle_orden`, `ot_checklist`, `abonos`, `ventas(origen='ot')`.
**Resultado:** 40 agentes. 31 confirmados (11 P0, 9 P1, 11 P2) + 4 UX → **27 problemas únicos (8 P0, 10 P1, 9 P2)**. Refutados: DATA-5, FE-4, UX-1, y UX-7 (refutado por verificación propia: `fn_cancelar_orden` NO valida abonos — su premisa era falsa).

> **La auditoría halló datos reales problemáticos en producción, no solo bugs de código.** Varias OT ya están en estado inconsistente y su remediación (corrección de datos) debe consultarse aparte, por lo delicado de la base.

### P0 — Crítico (dinero / inventario)

| ID    | Título                                                                                                                                                     | Evidencia en producción                                         | Estado    |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------- |
| S2-01 | `fn_cancelar_orden` no valida anticipos: cancela y deja el dinero huérfano (regresión — el bloqueo de la mig. 20260611000009 lo quitó 20260621000008)      | 2 OT canceladas con **$160.500** en abonos fuera de todo cierre | REPORTADO |
| S2-02 | El total de la OT puede quedar **negativo** (triggers sin `greatest(0,…)`, sin CHECK en `descuento_valor` ni `total`)                                      | OT #76: total **−$51.000**                                      | REPORTADO |
| S2-03 | IVA 19% genera centavos → la OT nunca se salda ni se entrega (redondeo a centavos vs. pesos enteros; `fn_generar_venta_ot` tolera 0.01)                    | OT #89 y #97 atascadas                                          | REPORTADO |
| S2-04 | Repuesto agregado a una OT **no autorizada** se consume del inventario pero nunca se factura (fuga)                                                        | OT #42 (CV): repuesto $1.000 consumido, total $0                | REPORTADO |
| S2-05 | 10 OT en 'entregada' **sin `venta_id`**: reparaciones entregadas nunca facturadas                                                                          | ~**$182.710** fuera de todo cierre                              | REPORTADO |
| S2-06 | Abonos que superan el total vigente de la OT (el tope solo se valida al insertar; el total baja después)                                                   | 12 OT, hasta **$800.000** de más                                | REPORTADO |
| S2-07 | Doble conteo entre cierres cuando el anticipo cae en un período y la venta-OT en otro ya cerrado (cruza con **Sección 3 Cierres**)                         | riesgo estructural                                              | REPORTADO |
| S2-08 | `fn_asociar_cotizacion_a_ot` corrompe precio/costo al copiar a `detalle_orden` (mete precio con IVA en la columna equivocada; falla con ítems de servicio) | contrato roto                                                   | REPORTADO |

### P1 — Funcional serio

| ID    | Título                                                                                                                                                                   | Estado    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| S2-09 | Seguridad: un `UPDATE` REST directo puede poner `estado='entregada'` sin pasar por `fn_generar_venta_ot` (causa probable de S2-05)                                       | REPORTADO |
| S2-10 | Seguridad: `INSERT` directo en `ventas` con `origen='ot'` sin unicidad por `orden_id` (venta-OT falsa/duplicada)                                                         | REPORTADO |
| S2-11 | Una OT **cancelada** sigue editable en campos financieros (RLS/triggers solo protegen 'entregada')                                                                       | REPORTADO |
| S2-12 | `fn_asociar_cotizacion_a_ot` no excluye OT canceladas → consume stock en una orden cerrada                                                                               | REPORTADO |
| S2-13 | El gate del paso Recepción depende de un flag de sesión (`checklistTocado`), no del checklist ya guardado → OT trabada al reabrir                                        | REPORTADO |
| S2-14 | Error silenciado al cargar el checklist → la constancia legal se imprime con "0 componentes"                                                                             | REPORTADO |
| S2-15 | `fn_generar_producto_segunda_ot` rechaza el estado 'terminada' del flujo nuevo (mensaje contradictorio)                                                                  | REPORTADO |
| S2-16 | "Revisión servicio (COP)" al crear la OT se guarda en `costo_mano_obra` (columna equivocada) → puede cobrar la revisión como mano de obra                                | REPORTADO |
| S2-17 | "Convertir a venta y entregar" (irreversible: genera venta, cierra garantía) no pide confirmación                                                                        | REPORTADO |
| S2-18 | `AbonosPanel`, `AutorizacionPanel`, `CotizacionesAsociadasOT`, `SelectorCotizacionExistente` están terminados pero **nunca montados** en OrdenDetalle (funciones sin UI) | REPORTADO |

### P2 — Robustez / seguridad de fondo / pulido

| ID    | Título                                                                                                                   | Estado    |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | --------- |
| S2-19 | Grants de `anon` sin revocar + policies con rol `{public}` en `ordenes_servicio`/`detalle_orden`/`abonos`/`ot_checklist` | REPORTADO |
| S2-20 | Al anular una venta-OT no se reabre la garantía que la entrega había cerrado                                             | REPORTADO |
| S2-21 | Coexisten dos máquinas de estado (nueva de 7 pasos vs. legacy) que saltan los gates de negocio                           | REPORTADO |
| S2-22 | OT 'no_autorizado' conservan `costo_mano_obra`/`valor_repuestos` irreales (distorsiona reportes de costo/margen)         | REPORTADO |
| S2-23 | El modo 'final' de `ordenPDF.js` calcula el total sin IVA ni descuento (hoy no usado)                                    | REPORTADO |
| S2-24 | Ítems del checklist de recepción a 44px (< 48px del sistema de diseño)                                                   | REPORTADO |
| S2-25 | Botón "Nueva OT" visible para Bodeguero; RoleGuard lo rebota al dashboard sin mensaje                                    | REPORTADO |
| S2-26 | Repuesto sin `costo_promedio` se descuenta a $0 → margen inflado en la venta-OT                                          | REPORTADO |
| S2-27 | La constancia impresa muestra el estado crudo ('recepcion') sin traducir (`ESTADO_LABEL` solo cubre estados legacy)      | REPORTADO |

### Remediación de datos en producción (requiere decisión, no solo código)

Estos son datos ya inconsistentes que un fix de código no corrige por sí solo; hay que decidir cómo tratarlos:

- OT #42 — repuesto consumido sin facturar (¿facturar, revertir el consumo, o dejar?).
- OT #76 — total −$51.000 (¿corregir a 0/valor real?).
- OT #89, #97 — atascadas por centavos (¿redondear su total a pesos enteros?).
- 10 OT entregadas sin `venta_id` (~$182.710) — ¿generar sus ventas retroactivas o registrarlas de otra forma?
- 12 OT con abonos por encima del total (hasta $800.000) — ¿saldo a favor del cliente, devolución, o ajuste?
- 2 OT canceladas con $160.500 en abonos huérfanos — ¿registrar devolución?

### Cruces con otras secciones

- **S2-07** (doble conteo entre cierres) se resuelve mejor en la **Sección 3 (Cierres)**, junto con S1-08.

### Sección 9 (Herramientas) — H-1 y H-2 RESUELTOS (adelantados por prioridad del usuario, 2026-07-15)

- **H-1 — CORREGIDO (no era bug de backend):** la devolución no daba ningún aviso; una herramienta inventariable se devolvía al insumo y desaparecía de la lista (`activo=false`), y parecía que "no la devolvía". Diagnóstico: `fn_devolver_herramienta` viva SÍ suma 1 a `cantidad_insumo`; la herramienta del reporte (SET DE LLAVES ALEN, SA8P) es **manual** (`producto_id=null`), que por definición no tiene insumo. Fix (frontend, `Herramientas.jsx`): mensaje de éxito explícito en `devolver`/`consumir` diciendo qué pasó (a insumo con conteo / quedó disponible / dada de baja). No se tocó el backend.
- **H-2 — CORREGIDO:** `fn_crear_herramienta_desde_insumo` inserta N filas (una por unidad) — correcto para el préstamo por unidad. Fix (frontend): el **catálogo agrupa** las unidades idénticas (mismo producto, o nombre+código, por sede) en una sola tarjeta con badge `×N` y desglose "X disponibles · Y prestadas". Sin cambios de BD; el préstamo por lote ya opera por grupo.

### Investigación de datos (2026-07-15, solo lectura) y decisiones del usuario

- **S2-05 (10 sin venta):** todas de inicio de junio, en su mayoría prueba/legacy; reales a cuadrar por fecha: #22 (William Losada $45.000), #33 (Ramiro Duran $35.000), #36 (Oscar Agredo $20.000). → remediación por fecha.
- **S2-06 (exceso de abono):** 12 OT, casi todas de junio con `total=0` (nunca llegaron a un total real, no sobrecobro por precio). **"Saldo a favor" no existe en la empresa** → fix preventivo: no dejar que el total baje por debajo de lo abonado, sin crear crédito.
- **S2-04:** el código vivo de `fn_generar_venta_ot` aún salta repuestos en `no_autorizado` → se blinda; OT #42 es legacy (16 jun).
- **S2-03:** OT #89 y #97 son recientes (1–2 jul), atascadas por centavos → bug actual.
- **S2-18:** los 4 componentes son "Fase 10" (pre-rediseño) → **DESCARTADO como feature; se eliminan como código muerto**.
- **S2-14 (constancia 0 componentes):** el usuario decidió **dejarlo así** → DESCARTADO.
- **S2-01:** al cancelar con anticipos → **bloquear con pop-up claro** que explique por qué y qué hacer.

### Estado de implementación (Sección 2)

**Base de datos (Opus) — aplicado a producción y probado con transacciones que revierten.** Migración: `supabase/migrations/20260715200000_s2_ot_hardening.sql` (definiciones originales comentadas para reversibilidad).

- CORREGIDO **S2-01**: `fn_cancelar_orden` bloquea si hay abonos, con mensaje accionable.
- CORREGIDO **S2-02**: total nunca negativo (clamp de descuento y `greatest(0,…)`) en `trg_orden_recalcular_total_mo` y `trg_orden_recalcular_totales`. La OT #76 (cancelada, −$51.000) se deja como está.
- CORREGIDO **S2-03**: redondeo a pesos enteros (`round(...,0)`) + data-fix de las 2 OT atascadas: **#89 540500.38→540500, #97 3343.90→3344**.
- CORREGIDO **S2-04 + S2-22**: marcar `no_autorizado` con repuestos cargados se bloquea; y en `no_autorizado` se ponen `costo_mano_obra`/`valor_repuestos` en 0.
- CORREGIDO **S2-06**: el total no puede bajar por debajo de lo ya abonado (sin crear saldo a favor).
- CORREGIDO **S2-08 + S2-12**: `fn_asociar_cotizacion_a_ot` copia `precio_unitario` correcto, deja el costo real, excluye servicios y rechaza OT cancelada/entregada.
- CORREGIDO **S2-09**: entrega solo vía `fn_generar_venta_ot` (señal GUC `cdv.entregando_ot`); UPDATE directo a `entregada` bloqueado.
- CORREGIDO **S2-11**: policy `os_update` excluye 'cancelada'; el trigger rechaza cambios en OT entregada/cancelada.
- CORREGIDO **S2-15**: `fn_generar_producto_segunda_ot` acepta 'terminada'.
- CORREGIDO **S2-19**: `REVOKE` de `anon` en las 4 tablas de OT; policies `{public}`→`authenticated`.
- CORREGIDO **S2-20**: al anular la venta-OT se reabre la garantía cerrada por esa entrega.
- CORREGIDO **S2-10**: índice único parcial `ux_ventas_orden_id_activa` (excluye anuladas; verificado que no hay OT con >1 venta activa).
- NO-APLICA **S2-26**: repuesto sin `costo_promedio` es dato de catálogo faltante; requiere cargar costos, sin fix seguro en BD.

**Frontend (Fable) — implementado, build en verde:**

- CORREGIDO: S2-01 (aviso claro al anular con anticipos), S2-03 (redondeo a enteros en `calcularMontos`), S2-13 (gate de Recepción desde el checklist real, no un flag de sesión), S2-16 ("Revisión" a `valor_revision`), S2-17 (confirmación al convertir a venta), S2-18 (eliminados 4 componentes muertos), S2-23 (total del PDF canónico), S2-24 (checklist 48px), S2-25 (botón "Nueva OT" solo Admin/Vendedor), S2-27 (estados nuevos en el PDF).
- DESCARTADO: **S2-14** (constancia con 0 componentes; decisión del usuario), **S2-18 como feature** (eran componentes del flujo viejo).

**Diferido a la Sección 3 (Cierres):** **S2-07** (doble conteo entre cierres), junto con S1-08.

**Remediación de datos pendiente (por consultar caso por caso):** las 10 OT entregadas sin venta (reales: #22, #33, #36), OT #42 (repuesto legacy), OT #76 (total negativo), y las OT con exceso de abono (casi todas datos viejos con total=0).

---

## Sección 3 — Cierres y Cuentas

**Auditada:** 2026-07-15 · **Estado:** resultados entregados, pendiente de aprobación.
**Alcance:** Cierres.jsx, Cuentas.jsx, PagoCuentaModal.jsx, cuentas-ui.js; RPCs `_fn_cierre_totales`, `fn_preview_cierre`, `fn_generar_cierre`, `fn_registrar_pago_cuenta`, `fn_eliminar_pago_cuenta`; trigger `trg_no_modify_cierre`; tablas `cierres`, `pagos_cuenta`.
**Resultado:** 33 agentes. 25 confirmados (2 P0, 9 P1, 14 P2) + 5 UX → **~18 problemas únicos**. 1 marcado CÓDIGO_VIEJO (la regla nueva funcionó), 1 refutado (que resultó confirmado por otra vía). Confirmó con datos reales el doble conteo (S2-07) y la anulación post-cierre (S1-08).

### P0 — Crítico (dinero)

- **S3-01 — Cerrar el día "en caliente" deja ventas/cobros posteriores fuera de TODO cierre, para siempre.** [forense/CIE-01 + negocio/CIERRE-01] Si se genera el cierre del día antes de que el día termine, las ventas posteriores caen en un rango ya cerrado e inmutable, y el `EXCLUDE` de solapamiento impide un segundo cierre del mismo rango → ese dinero nunca entra a ningún cierre. Fix propuesto: avisar/bloquear al cerrar un día que aún no ha terminado (o permitir un cierre complementario). **Requiere decisión de política.**

### P1 — Funcional serio

- **S3-02 — Escritura directa por REST a `cierres` sin bloquear** (seguridad): un Admin puede `insert` un cierre fabricado con montos arbitrarios, saltándose `fn_generar_cierre`, y queda inmutable. Mismo patrón que S1-01. Fix: REVOKE INSERT/UPDATE/DELETE a authenticated/anon. [CIERRE-01]
- **S3-03 — Anular una venta tras un cierre generado no deja ningún ajuste** (S1-08): el cierre queda inflado y el reembolso es invisible. Confirmado con datos reales. [negocio/CIERRE-02]
- **S3-04 — Doble conteo / desalineación OT entre cierres** (S2-07): el detalle `por_producto` usa la fecha de la venta-OT (entrega) mientras el total de OT usa la fecha del abono (cobro); anticipo en un periodo + entrega en otro descuadra el detalle vs el total. Confirmado con dato real (abono $400.000 sobre OT de $2.000). [CIERRE-02 + forense/CIE-02 + CIE-04 + ux/CIE-01]
- **S3-05 — Los anticipos de cotización (`abonos_cotizacion`) son invisibles para Cierres** y al convertir se etiqueta mal el método de pago. [negocio/CIERRE-03]
- **S3-06 — `safeError()` no reconoce los mensajes de negocio de Cierres/Cuentas** y los reemplaza por un genérico inútil. [frontend/F1]
- **S3-07 — `PagoCuentaModal` ignora el `error` de sus consultas** (pagos_cuenta/cuentas_bancarias) → puede mostrar un saldo incorrecto sin ningún aviso. [frontend/F2]

### P2 — Robustez / seguridad de fondo / pulido

- **S3-08 — `fn_eliminar_pago_cuenta` tiene dos firmas activas**: la vieja de 1 argumento hace **DELETE físico sin auditoría** y sigue otorgada. (Marcado CÓDIGO_VIEJO: hoy inerte por el trigger, pero contrato peligroso.) Fix: eliminar el overload legacy. [CIE-03/F3/contrato-F1/CIERRE-04]
- **S3-09 — El `EXCLUDE` de no-solapamiento de cierres no incluye `sede_id`**, contradiciendo la lógica per-sede. [CIERRE-03]
- **S3-10 — Grants sobrantes** de anon/authenticated (DELETE/UPDATE/TRUNCATE) en cierres/pagos_cuenta. [CIERRE-05]
- **S3-11 — Botón "Anular" de pago no se deshabilita durante la petición** → doble clic. [F4]
- **S3-12 — KPIs de Cuentas por cobrar/pagar se calculan solo sobre los primeros 300 registros** → subestimación silenciosa si crecen. [F5/contrato-F2]
- **S3-13 — Histórico de cierres se carga sin límite/paginación.** [F6]
- **S3-14 — `_fn_cierre_totales` calcula `por_metodo_pago` pero ningún componente lo lee.** [contrato-F3]
- **S3-15 — Arqueo: "Efectivo contado" admite negativos**, grabados en un registro inmutable. [ux/CIE-07]
- **S3-16 — Etiqueta "Sin cuenta / efectivo"** se aplica también a pagos electrónicos con `cuenta_bancaria` NULL por dato faltante. [ux/CIE-08]
- **UX (P2):** monto confirmado vs guardado puede diferir (F7/CIE-09); el checklist marca "pendiente" un periodo sin movimientos (CIE-04); "Sobra/Falta/Cuadra" del arqueo solo en tooltip, invisible en touch (CIE-05); la tabla histórica de arqueo no colorea sobra/falta (CIE-06).

### Cruces confirmados

- **S1-08** (anular post-cierre) → S3-03. **S2-07** (doble conteo OT entre cierres) → S3-04. Ambos **confirmados con datos reales** en esta sección; su corrección de fondo vive aquí.

### Estado de implementación Sección 3 (en curso, 2026-07-15)

- **Frontend batch 1 — CORREGIDO:** S3-06 (`safeError` muestra mensajes de negocio P0001), S3-07 (`PagoCuentaModal` maneja error de consulta, no muestra saldo falso), S3-11 (botón Anular deshabilitado durante la petición), S3-12 (KPIs de cartera sobre el universo completo, no solo 300), S3-13 (histórico de cierres con cota de 200).
- **Backend (agente Opus, en curso):** S3-01 cierre complementario (delta, soporta negativo → cubre S1-08), S3-02/S3-10 (REVOKE escritura directa a cierres/pagos_cuenta), S3-04 (por_producto alineado, S2-07), S3-05 (abonos_cotizacion visibles), S3-08 (drop overload legacy DELETE), S3-09 (EXCLUDE per-sede), S3-15 (arqueo no negativo).
- **Pendiente frontend:** UI del cierre complementario (botón/aviso en Cierres.jsx, S3-01) — se integra cuando aterrice la RPC `fn_generar_cierre_complementario`; y pulido P2 UX (CIE-04/05/06 arqueo, F7).

### Sección 3 — CERRADA (2026-07-15)

- **Backend aplicado** (migración `20260715210000_s3_cierres_hardening.sql`, probado con BEGIN/ROLLBACK, sin regresión del motor — agregado byte-idéntico): S3-01 (cierre complementario, 5 escenarios PASS), S3-02/S3-10 (REVOKE escritura directa), S3-04 (por_producto excluye origen='ot'), S3-08 (drop overload legacy), S3-09 (EXCLUDE per-sede), S3-15 (arqueo no negativo).
- **S3-05 DIFERIDO:** abonos_cotizacion en el motor — 0 filas hoy, riesgo alto, requiere reescribir bloques sensibles; no afecta ningún cierre existente.
- **Frontend:** batch 1 (S3-06,07,11,12,13) + UI del cierre complementario (botón/aviso cuando el rango ya está cerrado, más aviso al cerrar el día en curso). El cierre complementario captura el delta (soporta negativo), resolviendo también S1-08/S3-03 (anulación post-cierre).
- **Pendiente menor:** pulido P2 UX del arqueo (CIE-05 sobra/falta visible en touch, CIE-06 color histórico, CIE-04 checklist) y S3-16 (etiqueta "Sin cuenta") — cosméticos.

---

## Sección 4 — Inventario y Productos (2026-07-16)

Auditoría multi-agente (34 agentes). 27 hallazgos confirmados (2 P0, 12 P1 dedup, 13 P2), 1 descartado como código-viejo (QR/`referencia`: `fn_crear_producto` ya rellena referencia←codigo_interno; irreproducible). Sin regresión: cada corrección se validó contra la definición viva.

### Frontend (aplicado, build OK)

- **S4-01 (fe)** `ProductoDetalle`: `costo_promedio` ya NO se pide en el SELECT para no-Admin (antes viajaba al navegador; el ocultamiento era solo visual). Backend REST-hardening → DIFERIDO (decisión del dueño).
- **S4-02** `inventarioStore`: filtrar por Tipo ya no trunca a 500; el tipo se aplica sobre la query principal (`producto.tipo`), no en la pre-query con `limit`.
- **S4-04** `ProductoDetalle`: botón "→ a insumo" visible para Admin/Bodeguero/Técnico/Vendedor (igual que el RPC `fn_convertir_a_insumo`); "→ a venta" sigue solo Admin. Modal de conversión ahora habilitado para esos roles.
- **S4-05** `ProductoForm`: tipo "chatarra" fuerza `vendible=false` y bloquea el checkbox.
- **S4-07** `Inventario`: chip Stand/Pos solo en BODEGA (tabla y card); otras sedes → "—".
- **S4-09** `inventarioStore`: `loadingMore` se resetea al iniciar un fetch no-append → `loadMore` ya no queda bloqueado tras cambiar un filtro.
- **S4-10** `Inventario`/`inventario-ui`/`index.css`: "Sobrestock" filtrable y con color info (`.stk-pill.i`/`.dot-stk.i`), ya no gris neutro.
- **S4-11** `inventarioStore`: `.order(producto_id, sede_id)` antes de `.range()` → paginación estable.
- **S4-16** `ProductoForm`: `stock_maximo` se envía como 0 (no null) → no rompe el UPDATE directo de edición (NOT NULL).
- **S4-21 (fe)** `ProductoForm`: valida `stock_maximo > stock_minimo` (0 = sin tope). + aviso de margen negativo (Admin).
- UX: QR de producto desactivado da mensaje distinto a inexistente; `categoriaClass` amplía buckets; tap-targets de filtros ≥44px en móvil; Stat "Ubicación (BODEGA)"; confirmación de cambio de precio en `ProductoEditar`.

### Backend (migraciones aplicadas y verificadas en prod)

- **S4-06** `fn_actualizar_estado_stock`: Sobrestock solo si `stock_maximo>0`. Backfill: 963 `Sobrestock→OK`, 185 `OK→Agotado`. Sobrestock pasó de 968 → 5 (legítimos).
- **S4-D2** `fn_crear_producto`: recalcula estado al crear (cantidad 0 ⇒ Agotado). Verificado: 0 filas `cantidad=0 con OK`.
- **S4-08** `trg_productos_recalc_estado_stock`: recalcula estado al editar min/max.
- **S4-18** RLS `inventario`: se removió `inv_modify_block`; solo queda `inv_select`. Escritura directa por REST bloqueada; todo pasa por RPCs SECURITY DEFINER (verificado: ningún flujo del frontend escribe inventario directo).
- **S4-19** `trg_compra_sumar_stock`: `FOR UPDATE` sobre `productos` antes del promedio ponderado (evita race en compras concurrentes).
- **S4-20** `REVOKE EXECUTE fn_actualizar_estado_stock FROM anon/PUBLIC`.
- **S4-17** `fn_cancelar_compra`: NO-APLICA (el cambio de costo ya queda auditado por `trg_productos_log_precio_costo`).

### Diferido (requiere decisión / dato)

- **S4-01/S4-03 (backend REST-hardening)**: gating de `costo_promedio`/`ultimo_costo` a nivel BD requiere RPC SECURITY DEFINER Admin-only + REVOKE de columna + reescribir 2 vistas (`v_producto_ultimo_proveedor`, `v_sugerencias_reorden`) y consumidores. Riesgoso (todos los usuarios comparten rol `authenticated`). La fuga casual ya está cerrada en frontend. → Decisión del dueño.
- **S4-21 (CHECK)**: `CHECK (stock_maximo=0 OR stock_maximo>stock_minimo)` bloqueado por 1 fila que incumple: 'CDA' (min 10 > max 3) — es dato (S4-D5). Se aplica tras corregir CDA.

### Datos en producción — PENDIENTE presentar caso por caso (S4-Dx)

- **S4-D1**: 509 productos activos sin ninguna fila de inventario (invisibles en el módulo).
- **S4-D3**: 8 productos `vendible=false` con stock en pool vendible (teflón, aceite, etc.).
- **S4-D4**: 4 costos corruptos con margen −99% sin respaldo de compra (TA1/4G, TA1/2G, UG3/8, ADAM32PP).
- **S4-D5**: 'CDA' (servicio) min 10 > max 3.
- **S4-D6**: 'C25AM' costo_promedio=0 con venta real (margen falso 100%).

### Datos S4-Dx — decisiones aplicadas (2026-07-16)

- **S4-D5** APLICADO: 'CDA' → min=0, max=0. Se habilitó el CHECK `chk_stock_max_min` (migración `s4_21_check_max_min`). S4-21 cerrado.
- **S4-D3** APLICADO: los 8 SÍ se venden a veces → se marcaron `vendible=true` (el stock ya estaba bien en el cajón de venta; NO se movió a insumo).
- **S4-D4 + S4-D6** APLICADO: costo reiniciado a 0 (TA1/4G, TA1/2G, UG3/8, ADAM32PP; C25AM ya en 0) + notificación `costo_revisar` al Admin para fijar costo y precio correctos.
- **S4-D1** PENDIENTE: falta elegir enfoque (A: backfill filas en 0; B: refactor store LEFT JOIN).
- **S4-01/03 backend**: por decisión del dueño se deja SOLO el cierre en frontend; no se toca la BD.

- **S4-D1** APLICADO (opción A): se crearon filas de inventario en 0 (Agotado) para los 509 productos activos sin existencias, en las 4 sedes (2.036 filas nuevas). Verificado: 0 productos activos sin inventario. Sección 4 cerrada por completo.


---

## Sección 5 — Cotizaciones (2026-07-16)

Auditoría multi-agente (36 agentes; primera corrida cortada por límite de sesión, reanudada desde caché). 29 hallazgos confirmados (mucha duplicación entre cazadores). Realidad del módulo: **casi no se usa** — 18 cotizaciones, 1 conversión histórica, **0 abonos**, 0 líneas no-vendibles. La mayoría de "P0" eran huecos latentes, no pérdidas reales.

### Backend (8 migraciones `s5_cotizaciones_*` aplicadas y verificadas en prod)
- **COT-A** `fn_anular_venta` ahora limpia `cotizaciones.venta_id` → la cotización se puede reconvertir. + fix del único caso real: cotización #7 (venta #51 anulada) liberada. Bloqueadas restantes = 0.
- **COT-B** REVOKE INSERT/UPDATE/DELETE a authenticated/anon en cotizaciones/detalle_cotizacion/abonos_cotizacion/cotizacion_cuentas_bancarias (patrón S1-01/S3-02). Verificado: el frontend no escribe directo.
- **COT-C** guarda de rol Admin/Vendedor en fn_registrar/editar/convertir/cambiar_estado_cotizacion (antes solo validaban sede → Bodeguero/Técnico podían operar).
- **COT-F** `fn_registrar_abono_cotizacion` rechaza abonos sobre cotización rechazada/vencida.
- **COT-G** `fn_editar_cotizacion` impide bajar el total por debajo de lo ya abonado.
- **COT-L** cron `cotizaciones-vencidas-diario` (06:00 UTC = 01:00 Bogotá) para `fn_marcar_cotizaciones_vencidas` (solo borrador/enviada vencidas → 'vencida'; no toca aprobada/rechazada).

### Frontend (aplicado, lint + build OK)
- **COT-H** `CotizacionEditar` filtra `vendible=true` en búsqueda y QR (Nueva ya lo hacía).
- **COT-I** guardas síncronas (ref) anti doble-submit en registrar/eliminar abono.
- **COT-J** Historial: "Cargar más" ya no se oculta al escribir texto de búsqueda.
- **COT-K** historial de cotización usa `updated_at` (no la columna inexistente `fecha_conversion`).
- **UX** botón "Convertir en venta" oculto en cotizaciones vinculadas a OT (evita doble cobro).

### Código viejo eliminado (autorizado, verificado muerto)
- Flujo huérfano "Fase 10" `?ot_id=` en `CotizacionNueva.jsx`: ningún punto de la app navega con ese parámetro. Se borró el bloque (otIdParam/otIdValido/useEffect precarga/llamada a `fn_asociar_cotizacion_a_ot`/label). Backend: `DROP FUNCTION fn_asociar_cotizacion_a_ot` (0 referencias en BD). **NO se tocó** la columna `cotizaciones.ot_id` ni la visualización del enlace OT en Historial/Detalle (3 filas históricas).

### DIFERIDO — decisión del dueño (riesgo actual = 0, abonos_cotizacion=0 filas)
- **COT-D + COT-E**: los abonos de cotización no entran a `_fn_cierre_totales`, y al convertir el método de pago es binario (Efectivo/Crédito) ignorando el método real. El patrón de abonos de OT NO es trasladable directo (la venta de cotización es `origen='directa'` y SÍ se cuenta completa en el cierre → espejarlo duplicaría el conteo, el mismo problema de la Sección 3). Diseño correcto: **Opción 2** — que `fn_convertir_cotizacion` cree pagos con el método real y deje la venta que el cierre capte por la maquinaria de cobros (requiere frontend: capturar pago al convertir). Se relaciona con S3-05 (también diferido).
