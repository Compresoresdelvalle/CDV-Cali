# Estado del Proyecto — Compresores del Valle S.A.S.

> **Documento de contexto maestro.** Si abres una sesión nueva, lee esto primero
> para saber qué se hizo, qué bugs aparecieron, en qué fase vamos y a dónde
> seguimos. Última actualización: **2026-05-15**.

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

Fases 0-8 cerradas (sistema base). Luego se insertaron 9 fases extra (post-reunión
con el cliente) antes del deploy v1.0:

| Fase   | Nombre                                                      | Estado                         |
| ------ | ----------------------------------------------------------- | ------------------------------ |
| 9      | Configuración General (cuentas, parámetros, checklist)      | ✅ Cerrada                     |
| 10     | Ajustes OT (checklist, autorización, abonos, 30 días)       | ✅ Cerrada                     |
| 11     | Ajustes Cotizaciones (PDF, IVA editable, cuentas)           | ✅ Cerrada                     |
| 11.5   | Workflow cotizaciones (borrador→enviada→aprobada/rechazada) | ✅ Cerrada                     |
| 12     | Ajustes Inventario + Compras + Traspasos + Nuevo Producto   | ✅ Cerrada                     |
| **13** | **Garantías (compras y ventas) + Notas crédito**            | ✅ **Cerrada (último commit)** |
| 14     | Recibos manuales completos                                  | ⏳ **SIGUIENTE**               |
| 15     | Dashboard expandido + Cierres                               | ⏳ Pendiente                   |
| 16     | Frontend Redesign + reestructura `src/features/`            | ⏳ Pendiente                   |
| 17     | Deploy v1.0 (Netlify, QR masivo, smoke test)                | ⏳ Pendiente                   |

Post-v1.0 (no parte de v1): F18 Ensambles v2, F19 Dashboard avanzado.

**Plan maestro detallado:** `C:\Users\davi-\.claude\plans\reactive-sprouting-kitten.md`
(contiene los planes detallados de cada fase, incluido F14).

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
- Columnas: `estado_autorizacion`, `valor_revision`, `fecha_alerta_30_dias`,
  `pendiente_recogida_at`
- Tablas: `ot_checklist`, `abonos`
- Trigger anti-anticipo, validación de transiciones

### Fase 11 — Ajustes Cotizaciones

- PDF con jsPDF tamaño carta, IVA configurable, cuentas bancarias en PDF
- Columnas: `iva_pct`, `condiciones_pago`, `tiempo_entrega_nota`, `ot_id`, `venta_id`
- Tabla `cotizacion_cuentas_bancarias` (M2M)

### Fase 11.5 — Workflow Cotizaciones

- Estados: borrador → enviada → aprobada/rechazada/vencida
- Trigger `trg_cotizacion_validar_transicion` (matriz legal)
- RPC `fn_cambiar_estado_cotizacion`, `fn_marcar_cotizaciones_vencidas`
- `fn_convertir_cotizacion` ahora exige estado `aprobada`
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
  crea OT tipo=garantia con valor_revision=0)
- Vencimiento: 90 días (`dias_garantia_venta`)

---

## 4. Bugs encontrados y resueltos (memoria histórica)

Para no repetir errores. Patrones que se rompieron:

| Bug                                         | Causa raíz                                                                                           | Fix                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| IVA no se sumaba al asociar cotización a OT | `WHERE NOT EXISTS` evitaba re-copiar items                                                           | DELETE+INSERT con `ROUND(precio*(1+iva/100),2)`                      |
| Estado "aprobada" mutaba sin lógica         | Se mutaba `estado` como flag de conversión                                                           | Columna `venta_id` como source-of-truth, sin mutar estado            |
| Desvincular cotización no borraba repuestos | Solo hacía `UPDATE ot_id=NULL`                                                                       | Columna `detalle_orden.cotizacion_id` tracking + RPC `fn_desasociar` |
| Convertir a venta siempre fallaba           | RPC pasaba `cliente_telefono` (no existe en ventas), faltaban NOT NULL                               | Reescribir RPC con campos correctos                                  |
| Producto nuevo no aparecía en lista         | Realtime solo escuchaba UPDATE no INSERT                                                             | `useRealtime` ahora escucha INSERT y refresca                        |
| `fn_crear_producto` fallaba                 | `stock_maximo` NOT NULL recibía NULL; `sedes.activa` (no `.activo`)                                  | Default 0; corregir nombre columna                                   |
| Picking no transicionaba estado             | Es regla de segregación: verificador ≠ picker                                                        | UX clarificadora (alert + banner)                                    |
| RPCs garantía fallaban                      | `movimientos` usa `observaciones` (no `motivo`/`notas`); `stock_anterior`/`stock_posterior` NOT NULL | Calcular stock antes de INSERT + UPDATE inventario aparte            |
| Tests E2E frágiles                          | Locators `a[href]` cuando filas son `<tr onClick>`; placeholder global vs página                     | Usar `tr.cursor-pointer`, placeholders específicos, UUID regex       |

**Lección clave de testing:** los specs E2E deben usar locators robustos
(`tr.cursor-pointer`, scope `tbody`, regex UUID estricto), y los flujos pesados
de Playwright correrse en background con Monitor — no sub-agentes largos.

---

## 5. Convenciones de BD verificadas (importante para F14+)

- `movimientos`: append-only (triggers anti-DELETE/UPDATE). Columnas:
  `tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
referencia_id, referencia_tipo, usuario_id, observaciones`.
  **stock_anterior y stock_posterior son NOT NULL** — el caller los calcula.
- `sedes` usa columna `activa` (femenino), no `activo`.
- `productos` usa `activo`. Soft-delete con `activo=false`, nunca DELETE.
- RLS patrón: `(SELECT get_my_rol()) = 'Admin' OR sede_id = (SELECT get_my_sede_id())`.
- `ALTER TYPE ... ADD VALUE` NO corre dentro de transacción → ejecutar aparte
  con `execute_sql`, no en `apply_migration`.
- Consecutivos: columnas `numero` con `GENERATED ALWAYS AS IDENTITY` o `SERIAL`.

---

## 6. Siguiente paso — Fase 14: Recibos manuales

**Objetivo:** módulo formal de recibos con PDF, dos modos de creación
(desde cotización / desde cero), consolidación de abonos de OT.

**Resumen del alcance (MD cliente §6):**

- No automático: el usuario los crea, la app asiste con formato.
- Dos modos: desde cotización existente (pre-llena) o desde cero.
- PDF + impresión directa (reusar `src/lib/pdf/`).
- Vinculación opcional con OT: muestra abonos previos y descuenta del total.
- Campos: número consecutivo, fecha, cliente texto libre, NIT, concepto
  multi-línea, cotización/OT vinculada opcional, subtotal, IVA editable,
  total, abonos previos, saldo, forma de pago, cuenta bancaria, recibido por.

**Tablas nuevas:** `recibos`, `detalle_recibo`. Consecutivo por trigger BD.
**Frontend:** `src/pages/ops/Recibos/{Nuevo,Detalle,Historial}.jsx`.

> El plan detallado se hace en `/plan mode` al arrancar F14. Ver el plan
> maestro `reactive-sprouting-kitten.md` para el bloque F14.

---

## 7. Cómo testear (proceso establecido)

1. Aplicar migration vía MCP supabase (`apply_migration`, o `execute_sql`
   para `ALTER TYPE`).
2. `npm run build` + `npx eslint src/` → ambos limpios.
3. SQL stress tests: función `_fXX_stress_suite()` que retorna tabla con
   resultados OK/BUG (patrón usado en F11.5, F12, F13).
4. UI E2E: spec en `tests/e2e/faseXX-*.spec.js`, correr con Playwright en
   background + Monitor.
5. Cleanup datos de test (soft-delete o DELETE según tabla).
6. Commit + push.

**Login de prueba:** Carlos (Admin) PIN `0001`. Otros: maria/pedro/luis.

---

## 8. Estado git

- Rama: `main`
- Último commit relevante: `9c2350e` test(fase13)
- Working tree limpio tras cada fase.
- `test-results/` y `playwright-report/` están gitignored.
