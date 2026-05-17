# Estado del Proyecto — Compresores del Valle S.A.S.

> **Documento de contexto maestro.** Si abres una sesión nueva (o reinstalaste
> Claude y se perdió el contexto), **lee esto primero**. Resume qué se hizo, qué
> bugs aparecieron y cómo se arreglaron, en qué fase vamos y a dónde seguimos.
> Última actualización: **2026-05-17**.

---

## 0. CÓMO RETOMAR (leer apenas abras sesión nueva)

1. Lee este archivo completo.
2. Lee `CLAUDE.md` (reglas de código: tokens CSS, RLS, soft-delete, etc.).
3. Lee el plan maestro: `C:\Users\davi-\.claude\plans\reactive-sprouting-kitten.md`
   — tiene el roadmap y los planes detallados de cada fase.
4. **Estamos planeando la Fase 15.** Ver sección 7 abajo: hay **2 decisiones
   pendientes** que el usuario debe responder antes de implementar.
5. Working tree git limpio. Último commit: `1d75b52` (Fase 14).

---

## 1. Qué es el proyecto

PWA de gestión de inventarios y operaciones para una empresa colombiana de
compresores y repuestos neumáticos. Reemplaza un sistema fallido en AppSheet.

- **Stack:** React 18 + Vite + Tailwind + Zustand + Supabase (Postgres + Auth + Realtime)
- **Escala:** ~2.000-3.000 productos, 4 sedes, 6 usuarios, uso diario móvil/PC
- **Hosting destino:** Netlify Free
- **Repo:** github.com/jdconsultors369-ai/Compresores-del-Valle (rama `main`)
- **Reglas de código:** ver `CLAUDE.md` (tokens CSS `hsl(var(--*))`, soft-delete,
  RLS en todas las tablas, stock solo vía funciones PG con `FOR UPDATE`, etc.)

---

## 2. Roadmap — dónde vamos

Fases 0-8 cerradas (sistema base). Luego se insertaron fases extra (post-reunión
con el cliente) antes del deploy v1.0:

| Fase   | Nombre                                                      | Estado                           |
| ------ | ----------------------------------------------------------- | -------------------------------- |
| 9      | Configuración General (cuentas, parámetros, checklist)      | ✅ Cerrada                       |
| 10     | Ajustes OT (checklist, autorización, abonos, 30 días)       | ✅ Cerrada                       |
| 11     | Ajustes Cotizaciones (PDF, IVA editable, cuentas)           | ✅ Cerrada                       |
| 11.5   | Workflow cotizaciones (borrador→enviada→aprobada/rechazada) | ✅ Cerrada                       |
| 12     | Ajustes Inventario + Compras + Traspasos + Nuevo Producto   | ✅ Cerrada                       |
| 13     | Garantías (compras y ventas) + Notas crédito                | ✅ Cerrada                       |
| 13B    | Recibo POS de venta + impresión de OT                       | ✅ Cerrada                       |
| **14** | **Recibos manuales completos**                              | ✅ **Cerrada (commit 1d75b52)**  |
| **15** | **Dashboard expandido + Cierres**                           | 🟡 **EN PLANEACIÓN (siguiente)** |
| 16     | Frontend Redesign + reestructura `src/features/`            | ⏳ Pendiente                     |
| 17     | Deploy v1.0 (Netlify, QR masivo, smoke test)                | ⏳ Pendiente                     |

Post-v1.0 (no parte de v1): F18 Ensambles v2, F19 Dashboard avanzado
(garantías/recibos en dashboard — el cliente lo postergó explícitamente).

---

## 3. Lo que se construyó por fase

### Fase 9 — Configuración General

- Tablas: `cuentas_bancarias`, `parametros_sistema`, `checklist_componentes`
- RPC `fn_get_parametro(key)`, hook `useParametro`
- Admin → Configuración con 3 tabs
- 5 parámetros sembrados: `iva_pct=19`, `validez_cotizacion_dias=15`,
  `dias_alerta_ot_abandonada=30`, `dias_garantia_venta=90`, `dias_conteo_ciclico=15`

### Fase 10 — Ajustes OT

- Estado nuevo `pendiente_recogida` en enum `estado_orden`
- Columnas en `ordenes_servicio`: `estado_autorizacion` (text), `valor_revision`
  (numeric), `fecha_alerta_30_dias`, `pendiente_recogida_at`
- Tablas: `ot_checklist`, `abonos`
- Trigger anti-anticipo, validación de transiciones
- RPC `fn_total_abonos_ot(p_orden_id)`

### Fase 11 — Ajustes Cotizaciones

- PDF con jsPDF tamaño carta, IVA configurable, cuentas bancarias en PDF
- Columnas en `cotizaciones`: `iva_pct`, `condiciones_pago`, `tiempo_entrega_nota`,
  `ot_id`, `venta_id`
- Tabla `cotizacion_cuentas_bancarias` (M2M)

### Fase 11.5 — Workflow Cotizaciones

- Estados: borrador → enviada → aprobada/rechazada/vencida
- Trigger `trg_cotizacion_validar_transicion` (matriz legal)
- RPC `fn_cambiar_estado_cotizacion`, `fn_marcar_cotizaciones_vencidas`
- `fn_convertir_cotizacion` exige estado `aprobada`
- Componente `EstadoCotizacionPanel` (banner contextual)

### Fase 12 — Inventario + Compras + Traspasos

- Enums: `tipo_producto` (nuevo/segunda_mano), `estado_compra`, `tipo_traspaso`
- `productos`: `codigo_interno` (UNIQUE), `codigo_proveedor`, `tipo`
- Tabla `productos_proveedores` (M2M) + vista `v_producto_ultimo_proveedor`
- RPC `fn_alertas_rotacion`, `fn_crear_producto`
- **Nuevo Producto** form (resolvió el `<Placeholder>` que existía desde Fase 3)
- Alertas admin: 3 tabs nuevos (sobre-stock, mayor/menor rotación)

### Fase 13 — Garantías

- Enums: `resolucion_garantia_compra`, `estado_garantia_compra`,
  `resolucion_garantia_venta`, `estado_garantia_venta`, `tipo_ot`
- `tipo_movimiento` extendido: `garantia_salida`, `garantia_entrada`
- `ordenes_servicio.tipo` (normal/garantia)
- 5 tablas: `garantias_compra`, `detalle_garantia_compra`,
  `notas_credito_proveedor`, `garantias_venta`, `detalle_garantia_venta`
- 4 RPCs: `fn_abrir_garantia_compra`, `fn_marcar_reposicion_recibida`,
  `fn_consumir_nota_credito`, `fn_abrir_garantia_venta`
- Frontend: `CompraDetalle.jsx` (nueva), `Garantias/` (index + 2 detalles),
  `NotasCredito.jsx` admin, 2 modales
- Garantía venta: 3 caminos (cambiar pieza / devolver dinero / arreglar →
  crea OT tipo=garantia con valor_revision=0). Vencimiento 90 días.

### Fase 13B — Recibo POS de venta + impresión de OT

- `src/lib/pdf/ventaPOS.js` — recibo tipo tirilla 80mm, altura dinámica
  (medición en 2 pasadas para nombres largos de producto)
- `src/lib/pdf/ordenPDF.js` — documento imprimible de OT, tamaño carta
- Botones "Imprimir" en `VentaDetalle.jsx` y `OrdenDetalle.jsx` con guarda
  anti doble-click (flag `imprimiendo` + disabled 1.5s)

### Fase 14 — Recibos manuales ✅ CERRADA

- **Migration:** `supabase/migrations/20260516233315_fase14_recibos.sql`
  - Tablas `recibos` (id UUID, numero SERIAL, fecha, sede_id, cliente_nombre,
    cliente_nit, concepto, cotizacion_id, orden_id, subtotal, iva_pct, total,
    abonos_previos, monto_pagado, saldo, metodo_pago, cuenta_bancaria_id,
    observaciones, recibido_por, abono_id, anulado, created_at) y `detalle_recibo`.
  - RLS Admin+Vendedor por sede.
  - RPC `fn_registrar_recibo(p_payload JSONB)` — inserta recibo, items opcionales
    (snapshot de cotización), y si hay `orden_id` + `monto_pagado>0` + `crear_abono`
    inserta una fila en `abonos` y guarda `abono_id`.
  - RPC `fn_anular_recibo(p_recibo_id)` — marca `anulado` y borra el abono que creó.
- **Migration de fix:** `fase14_fix_anular_recibo_fk_order` (aplicada a la BD; el
  archivo de repo `20260516233315_fase14_recibos.sql` ya tiene la versión corregida).
- **Frontend:** `src/pages/ops/Recibos/{ReciboHistorial,ReciboNuevo,ReciboDetalle}.jsx`
  - `src/lib/pdf/reciboPDF.js` (PDF carta, API `{blob, download, print, open}`).
- **Rutas:** `/ops/recibos`, `/ops/recibos/nuevo`, `/ops/recibos/:id` (Admin+Vendedor).
- **constants.js:** `Recibos` en ROLE_MODULES (Admin+Vendedor), MODULE_ICONS (`🧾`),
  MODULE_ROUTES (`/ops/recibos`).
- **ReciboNuevo:** modo "desde cero" / "desde cotización"; vínculo opcional a OT
  (muestra abonos previos vía `fn_total_abonos_ot`); checkbox para registrar el
  pago como abono de la OT.
- **Tests:** E2E `tests/e2e/fase14-recibos.spec.js` (4/4) + SQL stress (10/10).

---

## 4. Bugs encontrados y resueltos (memoria histórica — no repetir)

| Bug                                                        | Causa raíz                                                                                   | Fix                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| IVA no se sumaba al asociar cotización a OT                | `WHERE NOT EXISTS` evitaba re-copiar items                                                   | DELETE+INSERT con `ROUND(precio*(1+iva/100),2)`                      |
| Estado "aprobada" mutaba sin lógica                        | Se mutaba `estado` como flag de conversión                                                   | Columna `venta_id` como source-of-truth, sin mutar estado            |
| Desvincular cotización no borraba repuestos                | Solo hacía `UPDATE ot_id=NULL`                                                               | Columna `detalle_orden.cotizacion_id` tracking + RPC `fn_desasociar` |
| Convertir a venta siempre fallaba                          | RPC pasaba `cliente_telefono` (no existe en ventas), faltaban NOT NULL                       | Reescribir RPC con campos correctos                                  |
| Producto nuevo no aparecía en lista                        | Realtime solo escuchaba UPDATE no INSERT                                                     | `useRealtime` ahora escucha INSERT y refresca                        |
| `fn_crear_producto` fallaba                                | `stock_maximo` NOT NULL recibía NULL; `sedes.activa` (no `.activo`)                          | Default 0; corregir nombre columna                                   |
| Picking no transicionaba estado                            | Es regla de segregación: verificador ≠ picker                                                | UX clarificadora (alert + banner)                                    |
| RPCs garantía fallaban                                     | `movimientos` usa `observaciones` (no `motivo`/`notas`); `stock_anterior/posterior` NOT NULL | Calcular stock antes de INSERT + UPDATE inventario aparte            |
| **F13 CRÍTICO:** `fn_abrir_garantia_venta` siempre fallaba | INSERT con `CASE ... END` daba `text`; columna `estado` es enum `estado_garantia_venta`      | Cast explícito `::estado_garantia_venta` (migration 20260516000001)  |
| **F14:** anular recibo con abono de OT fallaba             | `fn_anular_recibo` borraba el abono ANTES de limpiar `recibos.abono_id` → violaba FK         | Limpiar `abono_id=NULL` en el mismo UPDATE, luego DELETE del abono   |
| **F14:** botón "Anular" no hacía nada                      | `ReciboDetalle.jsx` usaba `useConfirm()` pero no renderizaba `<ConfirmDialog />` en el JSX   | Agregar `<ConfirmDialog />` antes del cierre del wrapper             |
| Tests E2E frágiles                                         | Locators `a[href]` cuando filas son `<tr onClick>`; placeholder global vs página             | Usar `tr.cursor-pointer`, placeholders específicos, UUID regex       |

**Lección clave de testing:** los specs E2E deben usar locators robustos
(`tr.cursor-pointer`, scope `tbody`, regex UUID estricto), y para diálogos
`useConfirm()` SIEMPRE renderizar `<ConfirmDialog />` en el JSX.

---

## 5. Estado de los tests E2E (diagnóstico 2026-05-17)

Se corrió la **suite E2E completa** (todas las fases). Resultado:
**126 passed**, 13-16 "failed" según la corrida, 4 flaky, 5 did not run.

**Las fallas NO son regresiones de código** — son inestabilidad de red:

- El log del WebServer muestra `TypeError: Failed to fetch` en peticiones a
  Supabase. Es conectividad, no lógica.
- Con `workers=1` (run largo de 24min) hubo MÁS fallas que con `workers=2` —
  una regresión daría resultado estable; esto escala con la duración del run
  → degradación de red / límite de conexiones del plan free de Supabase.
- 4 tests pasaron al reintentar (flaky) → confirma flakiness ambiental.
- Ninguna falla toca código modificado recientemente (F12/F13/F14).

**Regla para el futuro:** correr los specs **por fase individualmente**
(runs de 1-2 min, `--workers=1`), NUNCA toda la suite de golpe — los runs
largos saturan Supabase free-tier y generan falsas fallas.

El spec de F14 (`fase14-recibos.spec.js`) pasa **4/4 limpio** en corrida aislada
(verificado 2 veces seguidas).

---

## 6. Convenciones de BD verificadas

- `movimientos`: append-only (triggers anti-DELETE/UPDATE). Columnas:
  `tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
referencia_id, referencia_tipo, usuario_id, observaciones`.
  **stock_anterior y stock_posterior son NOT NULL** — el caller los calcula.
- `sedes` usa columna `activa` (femenino), no `activo`.
- `productos` usa `activo`. Soft-delete con `activo=false`, nunca DELETE.
- RLS patrón: `(SELECT get_my_rol()) = 'Admin' OR sede_id = (SELECT get_my_sede_id())`.
- `ALTER TYPE ... ADD VALUE` NO corre dentro de transacción → ejecutar aparte
  con `execute_sql`, no en `apply_migration`.
- Consecutivos: columnas `numero` con `SERIAL` (la mayoría) o `GENERATED ... IDENTITY`.
- Helpers: `get_my_rol()`, `get_my_sede_id()` leen de `usuarios` por `auth.uid()`.

### Esquema verificado para Fase 15 (consultado a la BD real 2026-05-17)

- **`ventas`**: id, numero, fecha, vendedor_id, sede_id, cliente_nombre,
  cliente_nit, subtotal, descuento_pct, iva_pct, total, metodo_pago,
  observaciones, **anulada** (boolean), created_at. NO tiene `estado`.
- **`ordenes_servicio`** (campos de dinero): `costo_mano_obra`, `costo_repuestos`,
  `total`, `valor_revision` (numeric), `estado` (enum), `estado_autorizacion`
  (text), `tipo` (enum normal/garantia), `fecha`, `fecha_entrega`, `sede_id`.
  NO tiene `anulada`.
- **`abonos`**: id (bigint), orden_id, fecha, monto, metodo_pago, observaciones,
  registrado_por, created_at. **NO tiene `sede_id`** → se deduce vía la OT.
- **`compras`**: id, numero, fecha, proveedor, registrado_por, sede_destino_id,
  subtotal, iva, total, factura_proveedor, observaciones, **recibida** (boolean),
  fecha_recepcion, estado (enum), created_at.
- **`recibos`** (F14): total, monto_pagado, abonos_previos, saldo, anulado,
  orden_id, cotizacion_id, fecha, sede_id.
- **NO existe** tabla `cierres` ni RPC `fn_cierre_periodo` → se crean en F15.

---

## 7. SIGUIENTE PASO — Fase 15: Dashboard expandido + Cierres

**Estado: EN PLANEACIÓN.** Se exploró el código y la BD. Falta que el usuario
responda 2 decisiones de diseño y luego escribir el plan detallado.

**Alcance (MD cliente §8):**

- §8.1-8.2: ampliar Dashboard Admin — separar **ingresos por productos** (ventas)
  vs **ingresos por servicios** (OTs: mano de obra, repuestos, valor revisión,
  abonos), mostrar **egresos** (compras) y **margen**.
- §8.3: módulo nuevo **Cierres** — página `/admin/cierres`, cierre diario/periódico
  que consolida ingresos + egresos de un rango de fechas.
- §8.4: garantías y recibos en el dashboard → NO incluir (fase posterior F19).

**Decisiones PENDIENTES (preguntar al usuario antes de implementar):**

1. **Base de cálculo de ingresos:**
   - Opción A (recomendada) — **Por caja (lo que entró):** ingresos = ventas
     pagadas + abonos recibidos a OTs. Refleja el dinero real del día. Encaja con
     el concepto de "cierre de caja". Evita doble-conteo (abonos es la única
     fuente del cash de OTs; OT.total no se cuenta directo).
   - Opción B — **Por facturado (devengado):** ingresos = ventas.total + total de
     OTs entregadas, sin importar si ya se cobró. Requiere elegir anchor temporal
     (fecha vs fecha_entrega) y evitar contar abonos.

2. **Módulo Cierres:**
   - Opción A (recomendada) — **Cierre formal guardado:** cada cierre se guarda
     en tabla `cierres` con consecutivo; queda histórico inmutable.
   - Opción B — **Solo reporte al vuelo:** se calcula y muestra el periodo, sin
     guardar nada.

**Tablas/archivos previstos (sujeto a las decisiones):**

- Tabla `cierres` (periodo, fecha, totales por categoría, sede, consecutivo, RLS).
- RPC `fn_generar_cierre(desde, hasta, tipo)` y/o `fn_preview_cierre`.
- Extender `fn_dashboard_kpis` con ingresos_productos / ingresos_servicios / egresos / margen.
- Frontend: `src/pages/admin/Dashboard.jsx` (tarjetas nuevas), `Cierres.jsx` (nueva),
  ruta `/admin/cierres`, entrada en `ADMIN_MODULES` de `constants.js`.

---

## 8. Cómo testear (proceso establecido)

1. Aplicar migration vía MCP supabase (`apply_migration`, o `execute_sql`
   para `ALTER TYPE`).
2. `npm run build` + `npx eslint src/` → ambos limpios.
3. SQL stress tests: función `_fXX_stress()` que retorna tabla con resultados
   OK/FALLO, simulando auth con `set_config('request.jwt.claims', json, true)`.
   Limpiar datos de test al final y `DROP FUNCTION`.
4. UI E2E: spec en `tests/e2e/faseXX-*.spec.js`, correr **aislado** con
   `--workers=1` en background (no toda la suite junta — ver sección 5).
5. Commit + push.

**Login de prueba:** Carlos (Admin) PIN `0001`, María (Vendedora) `5678`,
Pedro (Bodeguero) `1234`. Helper E2E: `tests/e2e/helpers.js`.

---

## 9. Estado git

- Rama: `main`
- Último commit: `1d75b52` — `feat(fase14): recibos manuales — PDF, abonos
consolidados, anulación`
- Working tree limpio (solo `.claude/scheduled_tasks.lock` sin trackear — ignorar).
- `test-results/` y `playwright-report/` están gitignored.

**Nota:** las migraciones de F11-F13 se aplicaron vía `apply_migration` pero no
todas quedaron como archivo en `supabase/migrations/`. La de F14 SÍ se guardó.
Si se necesita reproducir la BD desde cero, exportar el esquema actual de Supabase.
