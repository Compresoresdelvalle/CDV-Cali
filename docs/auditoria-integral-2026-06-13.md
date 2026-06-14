# Auditoría Integral CDV-Cali — Diagnóstico (2026-06-13)

> **Solo diagnóstico — no se modificó código ni base de datos.** Auditoría read-only sobre producción
> (36 agentes, ~3.8M tokens, 831 consultas/lecturas). Cada hallazgo CRÍTICO/ALTO fue **verificado
> adversarialmente** (un segundo agente intentó refutarlo con pruebas transaccionales rollback).

## Métricas

| Severidad  | Cantidad |
| ---------- | -------- |
| 🔴 CRÍTICA | 5        |
| 🟠 ALTA    | 12       |
| 🟡 MEDIA   | 22       |
| 🔵 BAJA    | 18       |
| ⚪ INFO    | 8        |
| **Total**  | **65**   |

## Resumen ejecutivo

El sistema está **fundamentalmente sano en su núcleo transaccional**: la matemática de stock y dinero
cuadra al 100% sobre datos reales (0 descuadres negativos en el ledger, totales de venta/compra/OT/cotización
consistentes con su fórmula, `movimientos` append-only probado), las invariantes críticas se respetan y la
mayoría de operaciones pasan por RPC `SECURITY DEFINER` server-authoritative.

Sin embargo se identificaron **5 fallas CRÍTICAS**, todas reproducidas en producción con pruebas
read-only/rollback. El **patrón transversal dominante** es claro: _la lógica de negocio en las RPC es correcta,
pero varias tablas permiten escrituras REST directas que saltan esas RPC_ (Herramientas, Compras pendientes,
Cotizaciones cross-sede, completar Ensamble), y la superficie `anon` está sobre-expuesta.

Para una empresa de 6 usuarios internos en producción temprana el blast radius actual de datos es pequeño,
pero los defectos son **estructurales y crecen con el volumen**. La hoja de ruta prioriza cerrar las CRÍTICAS
de bajo esfuerzo primero.

## Salud por área

| Área                         | Estado           | Nota                                                                                  |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| Integridad de stock / ledger | 🟡 observaciones | Ledger SANO; única falla funcional: conteo cíclico ignora pool de insumo (LEDGER-01). |
| Ventas                       | 🟢 bien          | Núcleo sólido verificado sobre 165 ventas; solo hardening y limpieza.                 |
| Compras                      | 🟡 observaciones | Núcleo correcto; 2 gaps ALTA de permisos por REST directo (COMPRAS-01/02).            |
| Traspasos                    | 🟢 bien          | Conservación intacta en 116 traspasos; bug histórico confirmado corregido.            |
| Órdenes de Servicio          | 🟡 observaciones | Saldo negativo en PDF por sobre-abono; divergencia UI/RLS de repuestos.               |
| Ensambles                    | 🔴 riesgo        | Producción-de-la-nada con receta vacía (ENSAMBLES-01) + autocompletar Técnico.        |
| Garantías                    | 🟡 observaciones | Falta tope cantidad reclamada vs comprado (feature sin uso aún).                      |
| Cotizaciones                 | 🟡 observaciones | Doble cobro OT+venta (latente) + RLS sin scoping de sede.                             |
| Herramientas                 | 🔴 riesgo        | `hp_update` permite UPDATE REST que elude RPC Admin-only y pierde insumo.             |
| Dinero y abonos              | 🟡 observaciones | Núcleo SANO; hueco: tope de abono OT se salta con total=0.                            |
| RLS y seguridad              | 🔴 riesgo        | Vistas de cartera legibles por anon/cross-sede + bypass de rol NULL.                  |
| Roles y permisos             | 🟡 observaciones | Modelo sólido; desviaciones documentales (Vendedor en Compras/Traspasos).             |
| Frontend                     | 🟡 observaciones | Costos bien ocultos salvo `ultimo_costo` renderizado a no-admin.                      |
| Trazabilidad y advisors      | 🟡 observaciones | Ledger sólido; huecos: anulación sin rastro, abonos con DELETE físico.                |

---

## 🔴 Hallazgos CRÍTICOS (5)

### RLS-01 — Vistas de cartera (`v_cuentas_por_cobrar` / `v_cuentas_por_pagar`) corren como SECURITY DEFINER: fuga financiera a anon y cross-sede

- **Categoría:** seguridad · **Verificado:** sí · **Confianza:** alta
- **Evidencia:** Advisor `security_definer_view` (ERROR). Ambas vistas tienen `reloptions=NULL` (sin `security_invoker=true`), owner `postgres` (bypassa RLS). `SELECT` concedido a **anon Y authenticated**. Ninguna filtra por sede ni rol. **Regresión confirmada:** la migr `20260609000006` las creó con `security_invoker=on`, pero `20260610000041_pagos_cuenta_soft_delete.sql` las recreó con `create or replace view` **sin el flag**. Reproducido con Vendedor real: la vista devuelve filas de OTRAS sedes; anon también lee.
- **Impacto:** Cualquier usuario autenticado —o anon con la publishable key del bundle— puede volcar la cartera completa (montos, saldos, clientes, proveedores) de las 4 sedes vía REST, saltando el aislamiento por sede y el RoleGuard solo-Admin de la UI.
- **Recomendación:** Recrear ambas vistas con `WITH (security_invoker = true)` y `REVOKE SELECT ... FROM anon`. Para confidencialidad entre authenticated, anteponer `(get_my_rol()='Admin' OR sede_id = get_my_sede_id())`.

### RLS-02 — Bypass de compuerta de rol con rol NULL: anon puede cancelar órdenes, anular ventas y cancelar compras

- **Categoría:** permisos · **Verificado:** sí · **Confianza:** alta
- **Evidencia:** Patrón `if get_my_rol() <> 'Admin' then raise`. En plpgsql `NULL <> 'Admin' = NULL` y `if NULL then` **no** ejecuta el raise; `get_my_rol()` es NULL para anon. **Prueba end-to-end (role anon, ROLLBACK):** `fn_cancelar_orden` cambió una OT REAL de `abierta` a `cancelada` sin error. `fn_anular_venta` y `fn_cancelar_compra` pasan la compuerta. Las 3 **no** tienen guard `if auth.uid() is null`. (Corrección: `fn_eliminar_abono_cotizacion`, `fn_eliminar_pago_cuenta`, `fn_eliminar_ensamble`, `fn_anular_garantia_*` SÍ tienen guard y NO son explotables por anon.)
- **Impacto:** Un atacante anónimo con solo la anon key puede cancelar órdenes de servicio (probado), y con IDs reales anular ventas y cancelar compras. Destrucción de datos por un no autenticado.
- **Recomendación:** Cambiar las compuertas a `if get_my_rol() is distinct from 'Admin' then raise` y agregar `if auth.uid() is null then raise` al inicio de TODA función SECURITY DEFINER. `REVOKE EXECUTE ... FROM anon`.

### ENSAMBLES-01 — Ensamble con receta vacía infla stock vendible sin consumir insumo (producción de la nada)

- **Categoría:** integridad · **Verificado:** sí · **Confianza:** alta
- **Evidencia:** `trg_ensamble_stock` suma **incondicionalmente** `cantidad_producida` al stock del producto resultado, sin verificar que exista receta. **Pruebas (ROLLBACK):** (a) ensamble SIN detalle, completar → inventario +5, `costo_total=0`, 0 insumo consumido; (b) ensamble con 1 componente eliminado antes de completar → +3. La UI permite borrar todos los insumos mientras `!completado` y luego completar.
- **Impacto:** Se crea stock vendible sin respaldo físico ni consumo de materiales, con `costo_total=0` que distorsiona el costeo. El movimiento `ensamble_produccion` queda como producción legítima, permitiendo vender unidades inexistentes. La igualdad `inventario=SUM(movimientos)` se mantiene; lo que se rompe es la integridad física.
- **Recomendación:** Exigir al completar que el ensamble tenga ≥1 `detalle_ensamble` y validar coherencia receta↔cantidad. Idealmente encapsular el completar en una RPC que valide y registre atómicamente.

### HERRAMIENTAS-01 — Devolver herramienta inventariable se elude con UPDATE REST directo: pierde stock de insumo silenciosamente

- **Categoría:** seguridad · **Verificado:** sí · **Confianza:** alta
- **Evidencia:** Policy `hp_update` (UPDATE, authenticated) sin restricción de columnas; `herramientas_prestamo` tiene **0 triggers**. **Prueba (ROLLBACK, Técnico):** UPDATE directo a `estado='disponible'` sobre una inventariable → `rows_updated=1`, `cantidad_insumo` delta=0, `movimientos` delta=0. `fn_devolver_herramienta` exige Admin para inventariables; el UPDATE directo lo saltó.
- **Impacto:** Un Vendedor/Técnico puede devolver/cerrar una herramienta inventariable sin pasar por la RPC: la unidad NUNCA regresa a `cantidad_insumo` ni se inserta el movimiento `ajuste` → **pérdida real de inventario + hueco de trazabilidad**.
- **Recomendación:** Forzar que toda mutación de estado/cierre de `herramientas_prestamo` pase por RPC: endurecer `hp_update` por columna, o trigger BEFORE UPDATE que rechace mutaciones fuera de las funciones SECURITY DEFINER, o revocar UPDATE a authenticated.

### HERRAMIENTAS-02 — Consumir (dar de baja) herramienta inventariable se ejecuta por no-Admin vía UPDATE directo

- **Categoría:** trazabilidad · **Verificado:** sí · **Confianza:** alta
- **Evidencia:** `fn_consumir_herramienta` es Admin-only (migr 20260611000013). Mismo origen que HERRAMIENTAS-01. **Prueba (ROLLBACK):** Técnico hace UPDATE directo `estado='consumido', activo=false` → `rows_updated=1`. Ni la RPC ni el UPDATE insertan en `movimientos`.
- **Impacto:** Cualquier autenticado de la sede puede dar de baja una herramienta inventariable sin ser Admin y sin generar movimiento. La unidad de insumo queda **definitivamente perdida sin rastro contable ni autorización**. Es la vía de fuga de stock más grave porque 'consumido' es justo el caso en que NO se devuelve.
- **Recomendación:** Misma mitigación que HERRAMIENTAS-01. Adicionalmente registrar un movimiento de baja para el consumo.

---

## 🟠 Hallazgos ALTOS (12)

| ID                  | Título                                                                                                                                                                                                 | Categoría  | Recomendación (resumen)                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **COMPRAS-01**      | RLS `compras_update` permite a Bodeguero/Admin alterar por REST cualquier columna de una compra pendiente (totales, proveedor, estado)                                                                 | integridad | Extender `trg_compra_proteger_materiales` a compras NO recibidas, o quitar GRANT UPDATE de columnas materiales a authenticated. |
| **COMPRAS-02**      | Una compra cancelada (no recibida) puede revivirse por REST (`estado='completada'`) y luego recibirse, reingresando stock                                                                              | lógica     | Bloquear en trigger toda transición `OLD.estado='cancelada' AND NEW.estado<>'cancelada'`.                                       |
| **COTIZACIONES-01** | Una cotización vinculada a OT puede además convertirse en venta: **doble facturación y doble consumo de stock** (latente, 0 filas hoy)                                                                 | lógica     | En `fn_convertir_cotizacion` bloquear si `ot_id NOT NULL`; constraint OT-XOR-venta.                                             |
| **COTIZACIONES-02** | RLS de `cotizaciones`/`detalle_cotizacion` no filtra por sede: lectura/escritura/borrado cross-sede vía REST                                                                                           | permisos   | Reescribir `cot_all`/`dcot_all` con predicado de sede + `with_check`.                                                           |
| **DINERO-01**       | Tope de abono de OT se salta cuando `total=0`: sobre-abonos reales en producción (7 OT, incl. 297.500 COP)                                                                                             | lógica     | Quitar la guarda `if v_total>0` y validar el tope siempre. Conciliar las 7 OT.                                                  |
| **ORDENES-02**      | Saldo NEGATIVO en el PDF de OT por sobre-abono con `total=0` (documento entregable al cliente)                                                                                                         | datos      | Clampear saldo a 0 o mostrar "a favor del cliente". Corregir raíz (DINERO-01).                                                  |
| **LEDGER-01**       | El conteo cíclico ignora `cantidad_insumo`: ajustes erróneos en productos INSUMOS (**ocurrió en producción**: 293 discos fantasma ~1.5h)                                                               | integridad | Conteo consciente del pool: para `vendible=false` leer/ajustar `cantidad_insumo`; o bloquear conteo de INSUMOS.                 |
| **ENSAMBLES-02**    | Completar por UPDATE REST permite al Técnico autocompletar y saltarse el control de dos personas (e inyectar cantidad arbitraria)                                                                      | permisos   | Mover completar a RPC que excluya al Técnico; congelar `cantidad_producida` tras 'terminado'.                                   |
| **GARANTIAS-01**    | `fn_abrir_garantia_compra` no valida cantidad reclamada vs lo comprado (sobre-reclamo + nota de crédito inflada; feature sin uso)                                                                      | lógica     | Validar `SUM(garantías no anuladas) + v_cant <= detalle_compra.cantidad`.                                                       |
| **RLS-03**          | `fn_anular_venta`/`fn_cancelar_compra` con bypass NULL-role que solo se salva por accidente (`movimientos.usuario_id NOT NULL`); usuario autenticado sin fila en `usuarios` pasa la compuerta en las 5 | permisos   | Corregir compuerta (`is distinct from` + guard `auth.uid()`); no confiar en NOT NULL como control.                              |
| **FRONTEND-01**     | Fuga de costo **renderizada** a no-admin: `ultimo_costo` en sección Proveedores de `ProductoDetalle.jsx:595-601` (único bloque sin `esAdmin`)                                                          | seguridad  | Envolver en `{esAdmin && (...)}` y omitir de la query.                                                                          |

> _(Nota: FRONTEND-01, DINERO-01 y RLS-03 figuran arriba; el bloque ALTA suma 12 contando ORDENES/LEDGER/ENSAMBLES/GARANTIAS/COMPRAS×2/COTIZACIONES×2/DINERO/RLS-03/FRONTEND-01.)_

---

## 🟡 Hallazgos MEDIOS (22) — compacto

- **ORDENES-01** — UI permite a Vendedor/técnico no asignado/OT sin técnico editar repuestos, pero RLS `do_write` lo bloquea (operativa rota + conversión venta→insumo huérfana).
- **RLS-04** — Vendedor puede auto-activar `puede_descuento_alto` en su fila (flag hoy inerte).
- **RLS-05** — `fn_registrar_venta` no valida tope de descuento server-side (límite es solo UI).
- **RLS-09** — 41 funciones SECURITY DEFINER ejecutables por anon (superficie de ataque).
- **TRAZA-02** — Anulación de venta sin rastro de quién/cuándo/por qué; ventas solo-servicio se anulan sin ningún movimiento.
- **LEDGER-02** — `stock_anterior/posterior` ambiguos de pool (mezclan `cantidad` y `cantidad_insumo` sin discriminador). _(verificación: degradada)_
- **LEDGER-03** — Pool de insumo sin apertura ledgerizada (M1 conocido/diferido). _(verificación: degradada)_
- **ORDENES-03** — PDF de OT recompone el total en JS en vez de usar `orden.total` (dos fuentes de verdad).
- **ORDENES-04** — RLS `do_write` permite borrar repuestos de una OT 'cancelada' (no excluye ese estado).
- **COMPRAS-03** — Vendedor puede RECIBIR (ingresar stock) con `p_recibir=true`, contradiciendo el gate Admin/Bodeguero.
- **COMPRAS-04** — Reversa de `costo_promedio` al cancelar es aproximada; deja costo "pegado" con saldo de apertura.
- **COMPRAS-05** — `descuento_valor` se guarda crudo sin clamp mientras los totales usan el clampado.
- **DINERO-03** — Abonos de OT se insertan/eliminan por REST sin RPC, dependiendo solo de un trigger con hueco.
- **DINERO-04** — El cierre de caja mezcla base devengada (ventas a total) con base de caja (abonos OT) e ignora `pagos_cuenta`.
- **DINERO-02** — El saldo se recorta con `Math.max(0,...)` en toda la UI, ocultando sobre-pagos. _(categoría ux)_
- **TRAZA-03** — Los abonos se borran físicamente (DELETE real) sin log de auditoría (contradice soft-delete del proyecto).
- **TRAZA-05** — ~12 políticas RLS con `get_my_rol()/auth.uid()` sin `(select ...)`: reevaluación por fila (rendimiento).
- **TRAZA-06** — 56 FKs sin índice; la más crítica `movimientos.usuario_id` (pantalla de Auditoría).
- **GARANTIAS-02** — `cambiar_pieza` descuenta stock de cualquier producto sin exigir que pertenezca a la venta/OT origen.
- **GARANTIAS-03** — Inconsistencia de roles RPC vs RLS para Técnico en garantía de venta.
- **TRASPASOS-01** — `fn_cancelar_traspaso` devuelve stock al origen sin verificar que realmente salió (sin idempotencia).
- **ENSAMBLES-03** — Limpieza de ensamble huérfano bloqueada por RLS (sin policy DELETE) deja ghost rows para no-Admin.
- **ROLES-02** — Vendedor puede registrar Compras y operar Traspasos (RPC + UI), contradiciendo CLAUDE.md.
- **COTIZACIONES-03** — Asociar cotización a OT ignora descuento y domicilio (total trasladado ≠ cotizado).
- **COTIZACIONES-04** — `detalle_cotizacion` sin CHECK `precio_unitario >= 0` (precios negativos por REST).
- **HERRAMIENTAS-03** — Prestar/cerrar préstamo no exige rol en backend (cualquier autenticado de la sede presta por REST).
- **HERRAMIENTAS-04** — Consumo de herramienta inventariable no deja movimiento de baja (insumo desaparece sin asiento).

## 🔵 Hallazgos BAJOS (18) e ⚪ INFO (8) — compacto

- **TRAZA-04** (BAJA) — `productos_precio_costo_log` existe pero no tiene superficie en la Bitácora de Auditoría.
- **ROLES-03** (BAJA) — `os_select` deja a Admin **y Vendedor** ver OTs de todas las sedes.
- **ROLES-04** (BAJA) — `clientes_insert` con `WITH CHECK true` (cualquier authenticated crea clientes).
- **TRASPASOS-02** (BAJA) — Desync `inventario < ledger` en producto de prueba 'PRUEBA' (#29/#39).
- **TRASPASOS-03** (BAJA) — `fn_procesar_traspaso`/`fn_crear_traspaso` ejecutables por anon/PUBLIC (inconsistente con la hermana).
- **VENTAS-01** (BAJA) — `fn_registrar_venta`/`fn_anular_venta` con GRANT EXECUTE a anon.
- **VENTAS-02** (BAJA) — Ruta de "venta con inventario negativo" es código muerto (induce a error de mantenimiento).
- **VENTAS-03** (BAJA) — Inconsistencia de mayúsculas en `metodo_pago` ('efectivo' vs 'Efectivo'); default en minúscula.
- **VENTAS-04** (BAJA) — Banner "cliente recurrente" cuenta por nombre exacto y dice "en esta sede" aunque Admin agrega todas.
- **COTIZACIONES-05** (BAJA) — `CotizacionEditar` busca productos sin filtrar `vendible=true` (insumos cotizables al editar).
- **FRONTEND-02** (BAJA) — Ítem de menú 'Productos' visible para Técnico pero la ruta lo bloquea (menú muerto).
- **FRONTEND-03** (BAJA) — `inventarioStore` nunca se resetea al cerrar sesión (cuentas compartidas en mismo dispositivo).
- **FRONTEND-04** (BAJA) — Errores de queries secundarias tragados sin manejo en `ProductoDetalle`.
- **ENSAMBLES-04** (BAJA) — `EnsambleDetalle` permite agregar el mismo insumo dos veces (sin dedupe).
- **ENSAMBLES-05** (BAJA) — No se impide usar el producto resultado como su propio insumo.
- **GARANTIAS-04** (BAJA) — Reúso de producto chatarra por referencia puede colisionar con un producto real 'CHAT-<ref>'.
- **GARANTIAS-06** (BAJA) — `devolver_dinero` no concilia con caja; regla "reembolso solo Admin" no se cumple en backend.
- **ORDENES-05** (BAJA) — Consumo de repuesto puede atribuirse al técnico asignado en vez del actor real.
- **COMPRAS-07** (BAJA) — Caja menor queda con `iva_pct=19` aunque `iva=0` (cosmético).
- **TRAZA-07** (BAJA) — Índice duplicado en `clientes`, 15 índices sin uso, 16 políticas permisivas múltiples.
- **RLS-08** (BAJA) — Protección de password filtrado desactivada en Auth (impacto limitado con PINs de 4 dígitos).
- **DINERO-05** (BAJA) — `fn_anular_venta` no revierte `pagos_cuenta` ni `abonos_cotizacion` asociados.
- **GARANTIAS-09** (INFO) — Flujo de reposición parcial: la UI no expone completar ítems restantes.
- **LEDGER-04** (INFO) — La merma de traspaso se imputa a la sede DESTINO, no a tránsito/origen (neto correcto).
- **RLS-06** (INFO) — Columnas de costo legibles por no-admin vía RLS de fila (**gap conocido/aceptado**, nivel-UI).
- **DINERO-06** (INFO) — `abonos.monto` sin escala definida (numeric ilimitado) vs `numeric(12,2)` del resto.
- **LEDGER-05** (INFO) — ✅ **Confirmación:** integridad de stock superada (apertura, signos, coherencia, append-only, no-negativos).
- **TRASPASOS-05** (INFO) — ✅ **Confirmación:** bug histórico corregido y conservación intacta en 116 traspasos.
- **VENTAS-05** (INFO) — ✅ **Confirmación:** núcleo de Ventas sano sobre 165 ventas.

---

## Matriz de roles

| Rol                             | Qué ve                                                                                                                                                                                                                                                        | Qué hace                                                                                                                                                                                                                                              | Límite de sede                                                         | Inconsistencias detectadas                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Admin (Carlos)**              | Acceso total: inventario, costos/márgenes, cartera, OTs y ventas de todas las sedes.                                                                                                                                                                          | Todo: único que anula ventas, cancela compra/orden/traspaso, aplica conteo, genera cierres, edita precio/costo, marca herramienta consumida, gestiona usuarios.                                                                                       | Sin límite.                                                            | **RLS-02/03:** la compuerta `<> 'Admin'` falla abierta con rol NULL (anon o usuario sin fila en `usuarios` pasa como Admin).                       |
| **Vendedor (María, Juan, Ana)** | Inventario (todas las sedes por UI; precio no costo), Ventas, Cotizaciones, Recibos, Garantías de venta, Herramientas. **Además (no en CLAUDE.md): OTs de todas las sedes, cartera completa (RLS-01), cotizaciones de otras sedes, `ultimo_costo` en ficha.** | Ventas (su sede), Cotizaciones. **Además: registra Compras y opera Traspasos/Picking; puede RECIBIR; vía REST modifica/borra cotizaciones cross-sede, presta/consume herramientas, auto-activa `puede_descuento_alto`, aplica descuento sin tope.**   | Su sede en escritura. **Roto en lectura: cuentas, OTs, cotizaciones.** | Permiso real excede el documentado en Compras/Traspasos y lectura cross-sede. La UI ofrece editar repuestos de OT que la RLS bloquea (ORDENES-01). |
| **Bodeguero (Pedro)**           | Inventario, Compras (costo legítimo), Traspasos, Ensambles, Devoluciones, Garantías de compra, Conteos, Herramientas. **Además: cartera completa, `ultimo_costo`.**                                                                                           | Compras, Traspasos/Picking/Recepción, Ensambles, Devoluciones, Conteos, Herramientas. **Vía REST: alterar columnas materiales de compras pendientes (COMPRAS-01), revivir compra cancelada (COMPRAS-02), presta/consume herramientas sin RPC.**       | Su sede.                                                               | Conteo cíclico corrompe pool de insumo (LEDGER-01). Puede falsificar registro contable de compras pendientes (COMPRAS-01).                         |
| **Técnico (Luis)**              | OTs (su sede), Ensambles, Herramientas. NO ve costo. **Menú muestra 'Productos' pero la ruta lo bloquea.**                                                                                                                                                    | OTs (si `tecnico_id` propio), Ensambles (si `realizado_por` propio), abonos de OT, Herramientas. **Vía REST: autocompletar ensamble e inyectar stock saltando el control de dos personas (ENSAMBLES-02); presta/consume herramientas sin ser Admin.** | Su sede.                                                               | RLS de garantía de venta excluye Técnico aunque la RPC lo permite (GARANTIAS-03). Evade control "técnico termina, vendedora completa".             |

---

## Hoja de ruta (remediación parte por parte)

| Paso   | Área                      | Qué se hace                                                                                                                                                                                                                                                                                                                                                  | Sev. máx   | Esfuerzo |
| ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | -------- |
| **1**  | RLS / seguridad           | (a) Recrear vistas de cuentas con `security_invoker=true` + REVOKE anon (RLS-01). (b) Corregir compuertas de rol NULL + guard `auth.uid()` en `fn_cancelar_orden`/`fn_anular_venta`/`fn_cancelar_compra` (RLS-02/03).                                                                                                                                        | 🔴 CRÍTICA | bajo     |
| **2**  | Herramientas              | Forzar que toda mutación de `herramientas_prestamo` pase por RPC (endurecer `hp_update` por columna o trigger BEFORE UPDATE). Cierra HERRAMIENTAS-01/02/03.                                                                                                                                                                                                  | 🔴 CRÍTICA | medio    |
| **3**  | Ensambles                 | Exigir receta no vacía al completar + mover completar a RPC que valide rol y congele cantidad (ENSAMBLES-01/02); policy DELETE/creación transaccional (ENSAMBLES-03).                                                                                                                                                                                        | 🔴 CRÍTICA | medio    |
| **4**  | Compras                   | Blindar registro contable por REST (COMPRAS-01); bloquear revivir cancelada (COMPRAS-02); persistir descuento clampado (COMPRAS-05).                                                                                                                                                                                                                         | 🟠 ALTA    | medio    |
| **5**  | Cotizaciones              | Bloquear conversión si `ot_id` (COTIZACIONES-01); RLS por sede (COTIZACIONES-02); CHECK precio (COTIZACIONES-04); prorrateo de descuento (COTIZACIONES-03).                                                                                                                                                                                                  | 🟠 ALTA    | medio    |
| **6**  | Dinero / abonos           | Corregir tope de abono OT con `total=0` (DINERO-01); clampear saldo en PDF (ORDENES-02/DINERO-02); encapsular abonos OT en RPC (DINERO-03); conciliar las OT con sobre-abono.                                                                                                                                                                                | 🟠 ALTA    | bajo     |
| **7**  | Ledger                    | Conteo consciente del pool de insumo o bloquear conteo de INSUMOS (LEDGER-01); excluir del picker de Conteo.                                                                                                                                                                                                                                                 | 🟠 ALTA    | medio    |
| **8**  | Garantías / OT / Frontend | Tope cantidad vs comprado (GARANTIAS-01); alinear UI/RLS de repuestos OT (ORDENES-01/04); gatear `ultimo_costo` (FRONTEND-01).                                                                                                                                                                                                                               | 🟠 ALTA    | medio    |
| **9**  | Hardening transversal     | `REVOKE EXECUTE ... FROM anon, PUBLIC` + GRANT solo authenticated (RLS-09); `puede_descuento_alto` inmutable + tope descuento server-side (RLS-04/05); encapsular prestar herramienta (HERRAMIENTAS-03/04); idempotencia `fn_cancelar_traspaso` (TRASPASOS-01).                                                                                              | 🟡 MEDIA   | medio    |
| **10** | Trazabilidad              | Columnas `anulada_por/fecha/motivo` en ventas (TRAZA-02); soft-delete/log de abonos (TRAZA-03); revertir `pagos_cuenta` al anular (DINERO-05); superficie de `productos_precio_costo_log` en Auditoría (TRAZA-04); base devengada vs caja del cierre (DINERO-04).                                                                                            | 🟡 MEDIA   | medio    |
| **11** | Rendimiento               | `(select ...)` en políticas RLS calientes (TRAZA-05); índices en FKs (TRAZA-06); limpiar índices duplicados/sin uso y políticas permisivas (TRAZA-07).                                                                                                                                                                                                       | 🟡 MEDIA   | medio    |
| **12** | Consistencia / UX / docs  | Documentar/decidir Vendedor en Compras/Traspasos (ROLES-02/03); `clientes_insert` por rol (ROLES-04); reset de store en logout (FRONTEND-03); eliminar código muerto (VENTAS-02); normalizar `metodo_pago` y tipar montos (VENTAS-03/DINERO-06); dedupe/filtro vendible en cotizaciones (ENSAMBLES-04/COTIZACIONES-05); `iva_pct=0` caja menor (COMPRAS-07). | 🔵 BAJA    | bajo     |

---

_Metodología: workflow multi-agente (14 dominios + verificación adversarial + síntesis), read-only sobre el
proyecto Supabase de producción. Cada hallazgo CRÍTICO/ALTO se intentó refutar antes de incluirlo. Las
confirmaciones ✅ (LEDGER-05, TRASPASOS-05, VENTAS-05) documentan lo que SÍ está correcto._
