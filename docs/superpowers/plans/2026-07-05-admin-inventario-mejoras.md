# Plan maestro — Mejoras sección Admin de inventario (Bloques A–E)

> Fecha: 2026-07-05 · Rama: `fix/correcciones-3` · Aprobado por el usuario.
> Workflow: **Fable planea y supervisa; Sonnet implementa** (subagentes `model: sonnet`).
> Las migraciones a producción las aplica siempre la sesión principal, nunca el subagente.
> Orden de ejecución acordado: **A → C → B → D → E**. Preview al usuario antes de cada bloque.

## Contexto (auditoría 2026-07-05)

| Hallazgo            | Dato                                                                                 | Impacto                                                              |
| ------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| ABC nunca ejecutado | 1.978 productos todos en 'C' (0 A, 0 B)                                              | Badges falsos; Reorden "Clase A en alerta"=0; conteo/slotting ciegos |
| ABC/Top excluyen OT | `origen='directa'` en `fn_recalcular_abc` y `fn_top_productos`                       | Repuestos que rotan vía OT parecen muertos                           |
| Reorden sin config  | 26/1978 con min/max; 518 sugerencias, 450 con max≤min, 33 insumos vs pool equivocado | La página es ruido                                                   |
| Ubicaciones vacías  | Tabla `ubicaciones` + `inventario.ubicacion_id` existen, 0 uso                       | Base lista para Bloque D                                             |
| Conteo sano         | 323/~2.517 SKUs contados (~13%)                                                      | Bloque C sube cobertura                                              |
| CxC/CxP/NC          | Correctos                                                                            | Sin cambios                                                          |

Investigación (fuentes en el hilo): conteo A cada 4–6 semanas / B trimestral / C semestral,
blind counts como mejor práctica; slotting por velocidad con "golden zone" (cintura–hombro,
cerca del despacho); KPIs núcleo: rotación, días de inventario, stockout, exactitud, merma.

## Stack y convenciones (aplican a todos los bloques)

- React 19 + Vite + Tailwind; tokens CSS obligatorios (`hsl(var(--token))`), nunca hex.
  Modo oscuro sale gratis vía tokens — NO usar colores literales en el mapa/nuevas UIs.
- Patrón de página ops/admin: wrapper `p-4 sm:p-6 space-y-4 animate-fade-in` + `PageHeader`.
- Desktop tabla / móvil cards; botones ≥48px; `StatusBadge` para estados.
- Backend: RPCs Postgres `security definer` con `search_path 'public','pg_temp'`; stock
  siempre vía funciones con `FOR UPDATE`; soft-delete; RLS en todo.
- Dinero: pesos enteros (`round(...)`), COP `formatCOP`.

---

## BLOQUE A — Reparar los datos (✅ HECHO 2026-07-05, commit 0ba7d40)

> Aplicado en prod y verificado: 71 A / 110 B / 1.797 C; cron `abc-mensual` en
> `cron.job`; `v_sugerencias_reorden` 518→71 filas (0 con sugerencia 0); banner
> de agotados sin mínimo en Reorden.jsx; build verde.

**Objetivo:** que ABC/Top/Reorden digan la verdad. Sin UI nueva, solo correcciones.

### A1. ABC incluye OT + ejecución + cron mensual

- Migración `20260705000002_abc_ot_cron_reorden.sql`:
  - `_fn_recalcular_abc_core()` (nueva, sin check de auth; `revoke execute` a `anon,authenticated`)
    con la lógica actual pero `v.origen in ('directa','ot')`. Cortes 80/95 se mantienen.
  - `fn_recalcular_abc()` = check Admin (igual que hoy) + llama al core.
  - `cron.schedule('abc-mensual', '0 5 1 * *', select _fn_recalcular_abc_core())`
    (05:00 UTC = 00:00 Bogotá, día 1). Requiere extensión `pg_cron` (verificar/crear).
  - Ejecutar el core una vez en la migración (primer cálculo real).
- `fn_top_productos`: `v.origen in ('directa','ot')`.

### A2. Reorden confiable

- Reemplazar `v_sugerencias_reorden` (mismas columnas/orden para `create or replace`):
  - `stock_actual = case when p.vendible then i.cantidad else i.cantidad_insumo end`
    (pool correcto para insumos), usado también en el filtro y en `cantidad_sugerida`.
  - Filtros nuevos: `p.stock_minimo > 0` **y** `cantidad_sugerida > 0` (mata las 450 filas basura).
- Frontend `src/pages/admin/Reorden.jsx`: banner informativo (tokens, no hex) con el
  conteo de referencias agotadas SIN mínimo configurado (query `inventario` con
  `producto!inner`, `cantidad<=0`, `producto.stock_minimo=0`, `producto.activo=true`,
  `head:true, count:'exact'`): "N referencias agotadas no aparecen aquí porque no tienen
  mínimo configurado" (el Bloque B las cubrirá).
- Copy `src/pages/admin/AnalisisABC.jsx`: footer aclara "ventas directas + repuestos de OT".

**Verificación A:** conteos A/B/C > 0 tras ejecutar; `v_sugerencias_reorden` sin filas
sugerencia 0 ni insumos con pool equivocado; job en `cron.job`; `npm run build` verde.

---

## BLOQUE C — Conteo cíclico programado (✅ HECHO 2026-07-05, commit 619f335)

> Migración `20260705000003_plan_conteo_ciclico.sql` aplicada en prod y verificada
> end-to-end en L3: plan 30d = 410 ítems (= SKUs con stock, balance 105/103/101/101);
> plan 90d = 451 ítems (41 clase A ×2, uno por mitad del ciclo); trigger marcó el
> ítem al registrar conteo del producto PRUEBA; progreso/cola/precisión correctos;
> datos de prueba limpiados. El plan real lo genera el Admin desde la UI.
> Nota de auditoría: se corrigió el reparto de divergencias históricas (round-robin
> solo en la primera mitad de su rango, no en todo el rango).

**Objetivo:** "los N de hoy": nunca más inventarios eternos.

- Tabla `plan_conteo` (id, sede_id, horizonte_dias [30|90 elegible], creado_por, activo)
  - `plan_conteo_items` (plan_id, producto_id, sede_id, semana_objetivo, contado_en, conteo_id).
- RPC `fn_generar_plan_conteo(p_sede, p_horizonte_dias)`: reparte los SKUs con stock
  (vendible + insumo) en semanas según clase: A cada 4–6 sem (reaparecen), B ~trimestral,
  C 1 vez por horizonte. Prioriza divergencias históricas.
- RPC `fn_cola_conteo_hoy(p_sede)`: los pendientes de la semana, orden por ubicación
  (cuando exista Bloque D) o referencia.
- UI en `Conteo.jsx`: nueva pestaña "Plan" — selector horizonte, tarjeta "Hoy: N por
  contar", progreso del ciclo (% cobertura), botón por ítem que abre el modal de conteo
  ya prellenado con el producto. Marcar ítem al registrar el conteo (hook en el flujo actual).
- Opcional (flag): **conteo ciego** — ocultar `stock_sistema` en el modal hasta registrar.
- KPI "Precisión" pasa a calcularse del ciclo, no de los últimos 100.

**Verificación C (criterios de aceptación):** generar un plan de 30 y uno de 90 días
para una sede y comprobar que TODOS los SKUs con stock quedan repartidos (suma de
items = SKUs con stock de esa sede); los clase A reaparecen ≥1 vez por ciclo de 4-6
semanas; registrar un conteo desde "los de hoy" marca el ítem (`contado_en`,
`conteo_id`); % cobertura sube al contar; roles: Bodeguero cuenta, solo Admin
genera/regenera plan; conteo ciego oculta stock hasta registrar; `npm run build` verde.
Datos base: ~2.517 SKUs con stock; clases 71 A / 110 B / 1.797 C.

## BLOQUE B — Min/Max asistidos (✅ HECHO 2026-07-05, commit 9150194)

> Migración `20260705000004_minmax_asistidos.sql` (+ fix `minmax_fix_demanda_signo`:
> las salidas en `movimientos` tienen cantidad NEGATIVA, la demanda usa `abs()`)
> aplicada en prod y verificada: 389 sugerencias con demanda >0 en 90d; matemática
> validada a mano (C2X10: 3.950 uds → min 461 / max 1.383 con lead 7 × 1.5 × 3);
> aplicar/revertir OK sobre producto PRUEBA; Vendedor rechazado en ambos RPCs.
> La demanda sale de `movimientos` (venta + orden_consumo + ensamble_consumo),
> una sola fuente auditada, en vez de sumar ventas+OT+insumos por separado.

- RPC `fn_sugerir_minmax(p_dias default 90)`: demanda diaria = (ventas directas + OT +
  consumos insumo) / días; `min = ceil(demanda_diaria × lead_time_dias × 1.5)`;
  `max = min × 3` (parámetros en tabla `parametros`, editables). Devuelve tabla propuesta.
- UI en Reorden: pestaña/modal "Sugerir mínimos" — tabla con actual vs sugerido,
  checkboxes, botón "Aplicar seleccionados" (RPC `fn_aplicar_minmax` batch, solo Admin).
- No tocar productos con min/max ya configurados a mano salvo que el Admin los marque.

## BLOQUE D — Ubicaciones + Slotting + mapita ⭐

**Layout real BODEGA** (dado por el usuario, ver memoria `bodega-layout-slotting`):
rectángulo, entrada por lado corto; stands en **U**: derecha desde la puerta ST9→ST8→ST7→ST6,
fondo ST5, izquierda ST4→ST3→ST2→ST1 (ST1 y ST9 flanquean la puerta). Cada stand 4
posiciones de altura (P1 más baja, arranca ~½ m del piso; P4 la más alta). Zona central =
**"stand piso"** (sin posiciones; carga pesada, ej. tina de aceite).
**CV/CHV/L3 no tienen ubicaciones claras** → solo zonas relativas: `ENTRADA | MEDIO | FONDO`.

- **Datos:** reusar tabla `ubicaciones` existente (id text = código legible):
  - BODEGA: `ST{1..9}-P{1..4}` (estante=stand, nivel=posición) + `PISO`.
    `prioridad_picking` precalculada: distancia a la puerta (ST1/ST9=1 … ST5=5) y
    golden zone vertical (P2/P3 mejor que P1/P4).
  - CV/CHV/L3: `ENTRADA`, `MEDIO`, `FONDO` (3 filas por sede).
  - Seed en migración; asignación por producto: `inventario.ubicacion_id` (ya existe).
- **UI de asignación:** en Inventario (detalle producto + edición masiva desde tabla):
  selector de ubicación por sede. Al escanear QR de producto, opción "asignar ubicación".
- **Mostrar ubicación en TODAS las UIs de selección de producto** (requisito del usuario):
  `ProductPicker`, búsqueda de VentaNueva, cotizaciones, OT (agregar repuesto), Picking,
  Traspasos, Conteo (modal), Ensambles. Chip pequeño `📍 ST3-P2` junto al stock.
- **Mapita `<MapaBodega highlight="ST3" />`:** componente SVG (~9 rects en U + zona
  central punteada, según mockups del usuario), 100% tokens (`--card`, `--border`,
  `--primary` para el stand resaltado, `--warning/0.4` borde del piso), responsive,
  tooltip-less (etiqueta debajo). Para CV/CHV/L3: barra horizontal de 3 zonas con la
  zona resaltada. Se muestra en: popover del chip 📍, modal de conteo, picking.
- **Slotting (reporte trimestral):** vista `v_slotting_sugerencias` = cruce rotación 90d
  (ventas+OT+insumo) × `prioridad_picking` actual → sugerencias "mueve REF de ST8-P4 a
  ST1-P2" (solo BODEGA; en CV/CHV/L3 sugiere "acercar a ENTRADA"). Página admin
  `Slotting.jsx` con lista, aceptar → actualiza `ubicacion_id` y registra en auditoría.

## BLOQUE E — KPIs de inventario en Dashboard admin

- Vista `v_kpis_inventario`: rotación (COGS 90d / inventario promedio), días de
  inventario, stockouts del mes (SKUs con min configurado que tocaron 0), exactitud
  (% conteos cuadrados del ciclo activo), merma $ (ajustes negativos aplicados del mes).
- 5 tarjetas nuevas en `Dashboard.jsx` (patrón `Kpi` existente, tokens, sin recortes
  de texto — lección del fix de Cierres). Tope 10 KPIs visibles en total.

---

## Registro de decisiones

- 2026-07-05: usuario aprueba todo el roadmap; pide empezar por A; layout BODEGA
  entregado con mockups (U de 9 stands + piso, 4 posiciones); CV/CHV/L3 solo zonas
  relativas; ubicación visible en todas las UIs de producto + mapita.
