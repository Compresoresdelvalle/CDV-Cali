# HANDOFF — Continuar mejoras admin (leer PRIMERO en sesión nueva)

> Actualizado: 2026-07-05. Este doc es el punto de entrada tras un /compact o chat nuevo.
> Contiene: estado exacto, protocolo de trabajo barato, qué sigue, y backlog para no perder nada.
> El plan técnico detallado de los bloques vive en `2026-07-05-admin-inventario-mejoras.md` (mismo directorio) — LEERLO también antes de ejecutar.

---

## 1. Qué estamos haciendo

Mejoras a la sección Admin de inventario/analítica, en 5 bloques aprobados por el usuario.
**Orden: A → C → B → D → E.**

| Bloque | Contenido                                                                                                                    | Estado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A**  | ABC real (incluye OT) + cron mensual + Reorden confiable                                                                     | ✅ **HECHO** (commit `0ba7d40`, aplicado en prod, verificado: 71 A / 110 B / 1.797 C; cron `abc-mensual` activo; Reorden pasó de 518 filas ruido a 71 reales)                                                                                                                                                                                                                                                                                                                                                     |
| **C**  | Plan de conteo cíclico programado ("los N de hoy", horizonte elegible 1/3 meses, cobertura del ciclo, opcional conteo ciego) | ✅ **HECHO** (commit `619f335`, migración `20260705000003` aplicada en prod y verificada end-to-end en L3: 30d=410 ítems balanceados 4 sem; 90d=451 ítems, 41 A ×2 una vez por mitad; trigger marca ítem al contar; datos de prueba limpiados — sin plan activo aún: el Admin lo genera desde la pestaña Plan)                                                                                                                                                                                                    |
| **B**  | Min/Max asistidos (sugerencia por demanda 90d ventas+OT, aprobación en lote)                                                 | ✅ **HECHO** (commit `9150194`, migraciones `20260705000004` + fix `minmax_fix_demanda_signo` en prod; verificado: 389 sugerencias, matemática validada a mano, aplicar/revertir OK, Vendedor rechazado. OJO: en `movimientos` las salidas tienen cantidad NEGATIVA — la demanda usa `abs()`)                                                                                                                                                                                                                     |
| **D**  | Ubicaciones + slotting + mapita SVG (layout BODEGA en memoria `bodega-layout-slotting`)                                      | ✅ **HECHO** en 2 partes: D1 `5efe923` (seed 46 ubicaciones, `fn_asignar_ubicacion`, chip 📍 en ~12 UIs, asignación en ProductoDetalle, cola de conteo por recorrido físico) y D2 `42ce0b0` (MapaBodega SVG + popover `conMapa`, `fn_slotting_sugerencias`, página `/admin/slotting`). Verificado en prod; producto PRUEBA quedó en ST1-P2 para probar chips. NOTA: campos legacy `productos.stand/posicion/en_piso` y `detalle_traspaso.ubicacion_origen_id` (FK muerta) conviven — candidatos a limpieza futura |
| **E**  | KPIs de inventario en Dashboard (rotación, días inv., stockouts, exactitud, merma)                                           | ⬅️ **SIGUIENTE**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 2. Protocolo de trabajo (ACORDADO con el usuario — costo bajo, misma calidad)

1. **Sesión nueva por bloque** (por eso existe este doc).
2. **Preview antes de implementar cada bloque**: presentar el detalle al usuario y esperar su OK (regla firme, está en memoria `feedback-preview-antes-de-cada-bloque`).
3. **Fable/Opus planea y supervisa; Sonnet implementa**: usar `Agent` con `model: "sonnet"` para escribir migraciones/frontend. Prompts a Sonnet a nivel de REQUISITOS (no código completo — no pagar el código 3 veces).
4. **Revisión por `git diff`**, no relectura de archivos completos. La sesión principal SÍ revisa línea a línea toda migración que toque dinero/stock/permisos.
5. **Solo la sesión principal aplica migraciones a prod** (`mcp apply_migration`) y verifica con SQL — verificaciones AGRUPADAS en 1-2 queries.
6. El subagente NUNCA: aplica a prod, hace git, ni decide diseño de dinero.

**Por qué ahorra:** el costo dominante NO es Sonnet (~96k tokens el Bloque A) sino el
contexto de la sesión principal repitiéndose en cada turno — una conversación larga
re-procesa TODO el historial cada mensaje. Sesión nueva + este doc (~2 páginas) =
mismo contexto útil, fracción del costo. Y el prompt a Sonnet a nivel de requisitos
evita pagar el mismo código 3 veces (spec → archivo → relectura).

**Qué NO se recorta (aquí vive la calidad — no negociable):**

- La sesión principal revisa línea a línea TODA migración que toque dinero, stock o
  permisos ANTES de aplicarla. Delegar esa revisión a otro Sonnet = Sonnet revisando
  a Sonnet, se pierde justo lo que se paga.
- Aplicar a prod y verificar con datos reales lo hace SIEMPRE la sesión principal
  (la única BD es producción).
- El preview con el usuario antes de cada bloque se mantiene siempre.
- `npm run build` verde antes de cada commit.

## 3. Entorno y reglas del repo (resumen operativo)

- Rama actual: **`fix/correcciones-3`**. Push SIEMPRE a los 2 remotes: `origin` y `cdv-cali`. Merge a `main` solo cuando el usuario lo pida (fast-forward habitual).
- **La única BD es PRODUCCIÓN** (Supabase). Migraciones: archivo en `supabase/migrations/` + `apply_migration`. Probar con productos "INVENTARIO DE PRUEBA" (999). E2E con login los corre el usuario. NO tocar auth ni el candado de `movimientos`.
- Build: `npm run build` antes de commit. Hay un hook formateador que retoca archivos tras editar.
- Commits: convencionales en español, terminar con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Diseño: SOLO tokens CSS (`hsl(var(--token))`), nunca hex ni `bg-white`; patrón PageHeader + SectionCard; tabla desktop/cards móvil; botones ≥48px; dinero COP en pesos enteros (todo redondeado, migración `20260630000001`).
- Memorias relevantes (auto-cargadas): `proyecto-mejoras-admin-inventario`, `bodega-layout-slotting`, `testing-compresores-constraints`, `feedback-preview-antes-de-cada-bloque`, `feedback-fix-bugs-as-found`.

## 4. Lo ya hecho en esta rama (fix/correcciones-3) — para no rehacer nada

1. `20260630000002_ot_abono_opcional.sql` — **anticipo de OT opcional**: el gate del backend (`trg_orden_validar_transicion`) ya NO exige abono para iniciar trabajo; front (`ot-flujo.js` paso 3) igual. La entrega SIGUE exigiendo pago completo (`fn_generar_venta_ot`: abonado ≥ total). Técnico sigue solo-lectura.
2. `ordenPDF.js` — sección **"Observaciones"** se imprime bajo el checklist en constancia de recepción Y documento final (solo si la OT tiene observaciones; se capturan al crear la OT en `OrdenNueva.jsx`).
3. `20260630000003` — eliminada función huérfana `trg_orden_validar_anticipo` (era código muerto).
4. `20260705000001_venta_ot_metodo_abonos.sql` — ventas de OT ya no dicen **"Varios"** sino **"Abonos OT"** (11 backfilled). El cierre las excluye por `origen='ot'`, no por método → cero impacto en dinero.
5. `Cierres.jsx` — KPIs ya no se truncan con "..." (fuente responsiva + break-words en `Stat` y `Kpi`).
6. `20260705000002_abc_ot_cron_reorden.sql` — **Bloque A completo** (ver tabla arriba).
7. `20260705000003_plan_conteo_ciclico.sql` — **Bloque C completo**: tablas `plan_conteo`/`plan_conteo_items` (un plan activo por sede, historial conservado), `fn_generar_plan_conteo` (solo Admin; A ×2 en 90d, divergencias históricas en la primera mitad de su rango, round-robin), `fn_cola_conteo_hoy` (Bodeguero forzado a su sede), trigger `trg_conteo_avanza_plan` (cualquier conteo marca el ítem), `fn_progreso_plan` (cobertura/semana/atrasados/precisión). Frontend: pestaña "Plan" en `Conteo.jsx` + modal con prefill y modo conteo ciego. OJO: el plan real aún NO se generó — lo genera el Admin desde la UI cuando quiera arrancar. El conteo manual sigue funcionando igual sin plan (requisito del usuario).
8. `20260705000004_minmax_asistidos.sql` — **Bloque B completo**: tabla `parametros` (lead time 7 / factor seguridad 1.5 / factor max 3, editable solo Admin), `fn_sugerir_minmax(p_dias)` (demanda desde `movimientos` tipos venta+orden_consumo+ensamble_consumo con `abs()` — las salidas son NEGATIVAS), `fn_aplicar_minmax(jsonb)` batch. Modal "Sugerir min/max" en `Reorden.jsx` (solo Admin): parámetros editables + recalcular, toggle "solo sin configurar" (protege valores manuales, default ON), aplicar con confirmación. Fix aplicado en prod como migración extra `minmax_fix_demanda_signo` (mismo contenido que el archivo corregido).
9. `20260705000005_ubicaciones_seed.sql` — **Bloque D1**: seed de `ubicaciones` (46: BODEGA ST1..ST9 × P1..P4 con `prioridad_picking` = distancia×10 + golden zone, + PISO=60; CV/CHV/L3 ENTRADA/MEDIO/FONDO 1/2/3), RLS lectura authenticated, `fn_asignar_ubicacion` (Admin/Bodeguero, valida sede, null quita), `fn_cola_conteo_hoy` con `ubicacion_id` y orden por recorrido físico (¡cambiar RETURNS TABLE exige DROP previo!). Componente `UbicacionChip` + chip en ~12 UIs; asignación por sede en `ProductoDetalle.jsx`; asignación opcional en el modal de conteo.
10. `20260705000006_slotting.sql` — **Bloque D2**: `MapaBodega.jsx` (SVG de la U real, 100% tokens; barra de 3 zonas para CV/CHV/L3), `UbicacionChip` con prop `conMapa` (popover con mapa; activo en Conteo, Picking, ProductoDetalle, VentaNueva), `fn_slotting_sugerencias()` (SUBIR: top 25% demanda >0 lejos de la puerta → ST1-P2/ENTRADA; BAJAR: demanda 0 en zona premium → ST5-P4/FONDO), página `/admin/slotting` + entrada en sidebar. Producto PRUEBA quedó ubicado en ST1-P2 para probar los chips.

## 5. Conocimiento de negocio ganado (NO perder)

- **Cierre de caja**: el dinero de OT entra por `abonos` en su FECHA (aunque la venta se genere días después); ventas `origen='ot'` excluidas de todo lo monetario del cierre (documento fiscal). El arqueo cuenta abonos efectivo por fecha. "Pagó hoy, recoge mañana" = registrar abono hoy + convertir a venta el día de recogida → verificado sin doble conteo. RLS de abonos permite abonar mientras la OT no esté entregada/cancelada.
- **Caso embobinada (servicio tercerizado)**: productos `EMB*` existen en catálogo con stock 0; NO agregarlos como repuesto en OT (se traba la descarga). Instrucción operativa: quitar el ítem y poner el valor en **mano de obra**. (Idea futura: tipo de ítem "servicio tercerizado" en OT.)
- **Diferencias de caja de la clienta (2-jul)**: CHV descuadraba por $1.000.000 consignado en efectivo al banco (el sistema no registra consignaciones); CV por compra de aceite $245.000 no registrada. L3 cuadró. El sistema calculaba bien.
- **Decimales**: eran centavos del IVA 19%; ya TODO se redondea a pesos enteros (triggers + funciones + backfill). No deben volver a aparecer.

## 6. Backlog fuera del roadmap (ideas aprobadas a medias o pendientes de decisión)

- **Registrar consignación de efectivo al banco** (sacar plata de caja → banco) para que el arqueo cuadre los días que consignan. La clienta lo sufre cada semana. El usuario dijo "solo arregla lo de Varios" — queda PENDIENTE de proponerse formalmente.
- **Ítem "servicio tercerizado" en OT** (caso embobinada) — a prueba de bobos.
- **Abonos con cuenta bancaria**: los abonos no piden cuenta destino; en el cierre "por cuenta" caen como "sin cuenta". Limitación conocida, mejora futura.
- **Top 10 menores**: netear descuentos (consistencia con cierre) + toggle "incluir OT" visible.
- **NotasCredito**: KPI "agotadas" solo tiene sentido con filtro "Todas" (aclarar u ocultar).
- Bloques C/B/D/E del roadmap (arriba).

## 7. Contexto de la clienta (cómo comunicar)

La dueña reporta por WhatsApp con lenguaje enredado; pide explicaciones simples. Patrón que funciona: verificar SIEMPRE contra datos reales de prod antes de responder, explicarle con sus propios números (cuaderno vs app), y mensajes listos para reenviar con emojis moderados. Los empleados: vendedoras registran; Yesid = tercero que hace embobinadas.

## 8. Qué hacer al arrancar sesión nueva (Bloque E — el último)

1. Leer este doc + `2026-07-05-admin-inventario-mejoras.md` (spec del Bloque E) + memoria.
2. Diseñar el detalle fino del Bloque E: vista/función de KPIs de inventario — rotación (COGS 90d / inventario promedio), días de inventario, stockouts del mes (SKUs con mínimo configurado que tocaron 0), exactitud (% conteos cuadrados del ciclo activo, reutiliza `fn_progreso_plan`/plan_conteo), merma $ (ajustes negativos aplicados del mes). 5 tarjetas en `Dashboard.jsx` admin (patrón `Kpi` existente, sin truncar texto — lección Cierres; tope 10 KPIs visibles). **Presentar preview al usuario** → esperar OK.
3. Tras OK: delegar a Sonnet, revisar diff, aplicar migración, verificar, `npm run build`, commit y push a ambos remotes.

Datos útiles para E: demanda/consumo con el patrón `abs(movimientos)`; `movimientos.tipo` incluye 'conteo_ajuste' y 'ajuste' (para merma usar ajustes con cantidad negativa aplicados); costo en `productos.costo_promedio`; los KPIs de precisión del ciclo ya existen en `fn_progreso_plan(sede)`.

## 9. Prompt de continuación (copiar y pegar en la sesión nueva)

```
Lee docs/superpowers/plans/2026-07-05-HANDOFF-continuar.md y luego
docs/superpowers/plans/2026-07-05-admin-inventario-mejoras.md.
Estamos en la rama fix/correcciones-3. Continúa con el Bloque E
(KPIs de inventario en Dashboard) siguiendo el protocolo del handoff:
preséntame el preview del bloque y espera mi OK antes de implementar.
```

Al terminar cada bloque: actualizar la tabla de estado de este doc (sección 1), la
memoria `proyecto-mejoras-admin-inventario`, cambiar "Bloque C" por el siguiente en
este prompt, commit + push a ambos remotes. Así el ciclo se repite hasta el Bloque E.
