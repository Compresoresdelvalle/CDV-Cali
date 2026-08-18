# Rediseño de las dos campanas del header — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la campana de stock en un botón de "Reposición" que cuenta trabajo accionable (76) en vez de ruido (2.868), y corregir los siete defectos de la campana de notificaciones sin cambiarle el propósito.

**Architecture:** Dos migraciones de base de datos primero (esquema de `notificaciones` con agrupado por `dedupe_key`, y la vista nueva `v_faltantes_con_demanda`), luego un hook de conteo compartido, un componente nuevo `ReposicionButton` y la reescritura de `NotificacionesBell` movido a `layout/`. Los dos shells consumen el hook una vez y reparten el conteo, para no duplicar suscripciones de realtime.

**Tech Stack:** React 19, Vite, Zustand, Supabase (PostgreSQL + Realtime + RLS), lucide-react, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-18-campanas-header-design.md`

---

## Antes de empezar: cómo se verifica aquí

Este repo tiene vitest con tests de integración en `tests/integration/`, pero todos
usan fixtures ficticios (usuarios `carlos`/`pedro`/`maria`, sedes `BOD-PRINCIPAL` y
`ALM-01`) que **no existen en esta base**. `integrationEnvNoDisponible()` los salta
enteros. Escribir tests ahí daría una falsa sensación de cobertura: no correrían.

Así que la verificación real de cada tarea es, en este orden:

1. **SQL contra producción** con cifras exactas esperadas, incluidas en cada tarea.
2. **`npm run lint` y `npm run build`** para el frontend.
3. **Prueba manual** descrita paso a paso; el E2E con login lo corre el dueño.

Las pruebas de datos usan los productos `INVENTARIO DE PRUEBA (999)`, nunca datos
reales de clientes.

**Preview antes de cada bloque:** presentar los cambios del bloque al dueño y esperar
su OK antes de implementarlo.

## Estructura de archivos

| Archivo                                                                     | Responsabilidad                                                                                                                   |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260818000001_campanas_01_notificaciones_esquema.sql` | Crear: `updated_at`, `dedupe_key`, índices, realtime, grants por columna                                                          |
| `supabase/migrations/20260818000002_campanas_02_conversion_agrupada.sql`    | Crear: `fn_convertir_a_insumo` con upsert por día y sede                                                                          |
| `supabase/migrations/20260818000003_campanas_03_vista_faltantes.sql`        | Crear: vista `v_faltantes_con_demanda`                                                                                            |
| `src/hooks/useReposicionCount.js`                                           | Crear: conteo de reposición con realtime y debounce. Solo datos, sin UI                                                           |
| `src/components/layout/ReposicionButton.jsx`                                | Crear: botón `PackageX` con badge y panel de dos pestañas. Solo UI, recibe el conteo por prop                                     |
| `src/components/layout/NotificacionesBell.jsx`                              | Crear (movido desde `admin/`): campana de avisos reescrita                                                                        |
| `src/components/admin/NotificacionesBell.jsx`                               | Borrar                                                                                                                            |
| `src/components/layout/AdminShell.jsx`                                      | Modificar: cambiar el Link de campana por `ReposicionButton`, montar `NotificacionesBell` en móvil, borrar `useAlertasCountAdmin` |
| `src/components/layout/AppShell.jsx`                                        | Modificar: cambiar el botón de campana por `ReposicionButton`, montar `NotificacionesBell`, borrar `useAlertasCount`              |
| `src/pages/ops/Inventario.jsx`                                              | Modificar: aceptar `?estado=` además del `?q=` que ya lee                                                                         |
| `src/pages/admin/Auditoria.jsx`                                             | Modificar: inicializar filtros desde `tipo`, `sede`, `desde`, `hasta` de la URL                                                   |

---

# BLOQUE 1 — Base de datos

## Task 1: Esquema de `notificaciones`

**Files:**

- Create: `supabase/migrations/20260818000001_campanas_01_notificaciones_esquema.sql`

- [ ] **Step 1: Anotar el estado previo para poder comparar**

Correr y guardar el resultado:

```sql
select
  (select count(*) from pg_publication_tables
     where pubname='supabase_realtime' and tablename='notificaciones') en_realtime,
  (select count(*) from information_schema.columns
     where table_name='notificaciones' and column_name in ('updated_at','dedupe_key')) cols_nuevas,
  (select count(*) from notificaciones) total_filas;
```

Esperado antes de la migración: `en_realtime=0`, `cols_nuevas=0`, `total_filas=1106`.

- [ ] **Step 2: Escribir la migración**

```sql
-- Campanas del header, parte 1: esquema de notificaciones.
-- Agrega updated_at (para que un aviso agrupado suba en la lista al
-- actualizarse), dedupe_key (clave de agrupación), realtime y grants por
-- columna. Ver docs/superpowers/specs/2026-08-18-campanas-header-design.md

ALTER TABLE public.notificaciones
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS dedupe_key text;

-- Backfill: las filas existentes nunca se han actualizado, así que su
-- updated_at debe ser su created_at, no el now() del DEFAULT.
UPDATE public.notificaciones SET updated_at = created_at WHERE updated_at <> created_at;

-- Índice parcial: los avisos que NO se agrupan llevan dedupe_key NULL y no
-- deben chocar entre sí. Postgres no considera NULLs en un índice único, pero
-- el WHERE lo deja explícito y es el predicado que exige el ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notificaciones_dedupe_key
  ON public.notificaciones (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- El panel pasa a ordenar por updated_at, no por created_at.
CREATE INDEX IF NOT EXISTS idx_notificaciones_para_rol_updated
  ON public.notificaciones (para_rol, updated_at DESC);

-- Realtime: sin esto cualquier suscripción del frontend no haría nada, en
-- silencio. ADD TABLE falla si ya está, de ahí la guarda.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
       AND tablename = 'notificaciones'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notificaciones;
  END IF;
END $$;

-- Endurecer: la policy notif_update valida para_rol/created_by, pero Postgres
-- no tiene RLS por columna, así que hoy un usuario podría modificar `data` o
-- el dedupe_key por REST. Los grants por columna sí lo impiden.
REVOKE UPDATE ON public.notificaciones FROM authenticated;
REVOKE UPDATE ON public.notificaciones FROM anon;
GRANT  UPDATE (leida) ON public.notificaciones TO authenticated;
```

- [ ] **Step 3: Aplicar la migración**

Aplicar con el MCP de Supabase (`apply_migration`), nombre
`campanas_01_notificaciones_esquema`.

- [ ] **Step 4: Verificar que quedó como se espera**

```sql
select
  (select count(*) from pg_publication_tables
     where pubname='supabase_realtime' and tablename='notificaciones') en_realtime,
  (select count(*) from notificaciones where updated_at <> created_at) desalineadas,
  (select array_agg(privilege_type order by privilege_type)
     from information_schema.column_privileges
    where table_name='notificaciones' and grantee='authenticated'
      and column_name='leida') grant_leida,
  (select count(*) from information_schema.column_privileges
    where table_name='notificaciones' and grantee='authenticated'
      and column_name='data' and privilege_type='UPDATE') puede_tocar_data;
```

Esperado: `en_realtime=1`, `desalineadas=0`, `grant_leida` contiene `UPDATE`,
`puede_tocar_data=0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260818000001_campanas_01_notificaciones_esquema.sql
git commit -m "feat(notificaciones): updated_at, dedupe_key, realtime y grants por columna"
```

---

## Task 2: Conversiones a insumo agrupadas por día y sede

Reemplaza el `INSERT` de `fn_convertir_a_insumo` por un upsert. El resto de la
función se copia tal cual de la definición vigente en producción: solo cambia el
bloque de notificación y se agregan dos variables al `DECLARE`.

**Files:**

- Create: `supabase/migrations/20260818000002_campanas_02_conversion_agrupada.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- Campanas del header, parte 2: las conversiones a insumo se agrupan en un
-- solo aviso por día y sede, que se actualiza en vivo en vez de crear una fila
-- nueva. 840 de 886 notificaciones (95%) eran de este tipo y mataron la campana.

CREATE OR REPLACE FUNCTION public.fn_convertir_a_insumo(
  p_producto_id uuid, p_sede_id text, p_cantidad integer
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rol text; v_usuario text;
  v_venta int; v_insumo int;
  v_prod text; v_sede text;
  v_notificar boolean;
  v_fecha date;
  v_key text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::text, nombre INTO v_rol, v_usuario FROM usuarios WHERE id = v_uid;
  IF v_rol IS NULL OR v_rol NOT IN ('Admin','Bodeguero','Tecnico','Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para convertir stock a insumo (rol %)', COALESCE(v_rol,'desconocido');
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad a convertir debe ser mayor a 0';
  END IF;

  SELECT cantidad, cantidad_insumo INTO v_venta, v_insumo
    FROM inventario WHERE producto_id = p_producto_id AND sede_id = p_sede_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no tiene inventario en la sede %', p_sede_id;
  END IF;
  IF v_venta < p_cantidad THEN
    RAISE EXCEPTION 'Stock de venta insuficiente (hay %, intentas convertir %)', v_venta, p_cantidad;
  END IF;

  UPDATE inventario
     SET cantidad = cantidad - p_cantidad,
         cantidad_insumo = cantidad_insumo + p_cantidad,
         ultimo_movimiento = now(), updated_at = now()
   WHERE producto_id = p_producto_id AND sede_id = p_sede_id;

  INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_tipo, usuario_id, observaciones)
  VALUES ('conversion_a_insumo', p_producto_id, p_sede_id, -p_cantidad,
    v_venta, v_venta - p_cantidad, 'conversion', v_uid,
    format('Convertidas %s uds de venta a insumo', p_cantidad));

  PERFORM fn_actualizar_estado_stock(p_producto_id, p_sede_id);

  v_notificar := (v_rol <> 'Admin');
  IF v_notificar THEN
    SELECT nombre INTO v_prod FROM productos WHERE id = p_producto_id;
    SELECT nombre INTO v_sede FROM sedes WHERE id = p_sede_id;

    -- Día laboral en hora Colombia, no UTC: si se corta en UTC, todo lo que
    -- pasa después de las 7pm cae en el "día siguiente" y el agrupado miente.
    v_fecha := (now() AT TIME ZONE 'America/Bogota')::date;
    v_key := 'conversion_insumo:' || p_sede_id || ':' || v_fecha::text;

    INSERT INTO notificaciones (tipo, titulo, mensaje, data, para_rol, created_by,
                                dedupe_key, updated_at)
    VALUES (
      'conversion_insumo',
      'Conversiones a insumo',
      format('Hoy en %s: 1 conversión a insumo (%s ud).',
             COALESCE(v_sede, p_sede_id), p_cantidad),
      jsonb_build_object('sede_id', p_sede_id, 'sede', v_sede,
                         'fecha', v_fecha::text, 'eventos', 1, 'unidades', p_cantidad),
      'Admin', v_uid, v_key, now()
    )
    -- El predicado repite el del índice parcial: ON CONFLICT no puede inferir
    -- un índice parcial sin él.
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE
      SET data = notificaciones.data || jsonb_build_object(
                   'eventos',  COALESCE((notificaciones.data->>'eventos')::int, 0) + 1,
                   'unidades', COALESCE((notificaciones.data->>'unidades')::int, 0) + p_cantidad),
          mensaje = format('Hoy en %s: %s conversiones a insumo (%s ud).',
                     COALESCE(v_sede, p_sede_id),
                     COALESCE((notificaciones.data->>'eventos')::int, 0) + 1,
                     COALESCE((notificaciones.data->>'unidades')::int, 0) + p_cantidad),
          -- Deliberado: si entran conversiones después de que el Admin revisó,
          -- el badge vuelve. Es lo pedido.
          leida = false,
          updated_at = now();
  END IF;

  RETURN jsonb_build_object('producto_id', p_producto_id, 'sede_id', p_sede_id,
    'cantidad_venta', v_venta - p_cantidad, 'cantidad_insumo', v_insumo + p_cantidad,
    'notificado_admin', v_notificar);
END $function$;
```

- [ ] **Step 2: Aplicar la migración**

Aplicar con `apply_migration`, nombre `campanas_02_conversion_agrupada`.

- [ ] **Step 3: Probar el agrupado con dos conversiones seguidas**

Usa el producto de pruebas. La función notifica solo si el rol no es Admin, así que
la prueba directa por SQL simula la fila que produciría; la prueba end to end la hace
el dueño desde la app con una vendedora.

```sql
-- Simula lo que hace la función: dos eventos el mismo día y sede.
DO $$
DECLARE v_key text := 'conversion_insumo:TEST-SEDE:' || (now() at time zone 'America/Bogota')::date;
BEGIN
  FOR i IN 1..2 LOOP
    INSERT INTO notificaciones (tipo, titulo, mensaje, data, para_rol, created_by, dedupe_key, updated_at)
    VALUES ('conversion_insumo','Conversiones a insumo','Hoy en TEST: 1 conversión a insumo (3 ud).',
            jsonb_build_object('sede_id','TEST-SEDE','fecha',(now() at time zone 'America/Bogota')::date::text,
                               'eventos',1,'unidades',3),
            'Admin', NULL, v_key, now())
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE
      SET data = notificaciones.data || jsonb_build_object(
                   'eventos',  COALESCE((notificaciones.data->>'eventos')::int,0) + 1,
                   'unidades', COALESCE((notificaciones.data->>'unidades')::int,0) + 3),
          mensaje = format('Hoy en TEST: %s conversiones a insumo (%s ud).',
                     COALESCE((notificaciones.data->>'eventos')::int,0) + 1,
                     COALESCE((notificaciones.data->>'unidades')::int,0) + 3),
          leida = false, updated_at = now();
  END LOOP;
END $$;

select count(*) filas, max(data->>'eventos') eventos, max(data->>'unidades') unidades, max(mensaje) mensaje
  from notificaciones where dedupe_key like 'conversion_insumo:TEST-SEDE:%';
```

Esperado: `filas=1`, `eventos=2`, `unidades=6`,
`mensaje='Hoy en TEST: 2 conversiones a insumo (6 ud).'`

- [ ] **Step 4: Limpiar la fila de prueba**

```sql
delete from notificaciones where dedupe_key like 'conversion_insumo:TEST-SEDE:%';
select count(*) debe_ser_cero from notificaciones where dedupe_key like 'conversion_insumo:TEST-SEDE:%';
```

Esperado: `debe_ser_cero=0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260818000002_campanas_02_conversion_agrupada.sql
git commit -m "feat(notificaciones): agrupar conversiones a insumo por dia y sede"
```

---

## Task 3: Vista `v_faltantes_con_demanda`

**Files:**

- Create: `supabase/migrations/20260818000003_campanas_03_vista_faltantes.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- Campanas del header, parte 3: lo que esa sede sí vende y hoy está en cero.
-- Cubre el punto ciego de v_sugerencias_reorden: 2.792 SKUs no tienen
-- stock_minimo configurado, así que esa vista es ciega a ellos. Esta mide
-- plata que se deja de vender, no cumplimiento de un parámetro.

CREATE OR REPLACE VIEW public.v_faltantes_con_demanda
WITH (security_invoker = true) AS
WITH demanda AS (
  SELECT v.sede_id,
         dv.producto_id,
         count(DISTINCT v.id)::int AS ventas_90d,
         sum(dv.cantidad)::int     AS unidades_90d,
         max(v.created_at)         AS ultima_venta
    FROM detalle_venta dv
    JOIN ventas v ON v.id = dv.venta_id
   WHERE v.created_at > now() - interval '90 days'
     AND NOT v.anulada
     AND dv.producto_id IS NOT NULL   -- las líneas de servicio no llevan producto
   GROUP BY 1, 2
)
SELECT i.producto_id,
       p.referencia,
       p.nombre,
       p.clasificacion,
       i.sede_id,
       s.nombre AS sede_nombre,
       d.ventas_90d,
       d.unidades_90d,
       d.ultima_venta
  FROM inventario i
  JOIN productos p ON p.id = i.producto_id
  JOIN demanda   d ON d.producto_id = i.producto_id AND d.sede_id = i.sede_id
  LEFT JOIN sedes s ON s.id = i.sede_id
 WHERE p.activo
   AND i.cantidad = 0;

COMMENT ON VIEW public.v_faltantes_con_demanda IS
  'Productos en cero en una sede que esa misma sede vendió en los últimos 90 días. Segunda pestaña del botón de Reposición.';
```

- [ ] **Step 2: Aplicar la migración**

Aplicar con `apply_migration`, nombre `campanas_03_vista_faltantes`.

- [ ] **Step 3: Verificar cifras y reparto por sede**

```sql
select (select count(*) from v_faltantes_con_demanda) total,
       (select count(*) from v_sugerencias_reorden)   reorden_sigue_igual;
select sede_id, count(*) from v_faltantes_con_demanda group by 1 order by 2 desc;
```

Esperado: `total=219`, `reorden_sigue_igual=76`. El reparto por sede debe tener las
cuatro sedes reales (`BODEGA`, `CHV`, `CV`, `L3`) y ninguna otra.

- [ ] **Step 4: Verificar que ninguna fila tiene stock**

La vista no debe listar nada con existencias; si lo hace, el `JOIN` está mal.

```sql
select count(*) debe_ser_cero
  from v_faltantes_con_demanda f
  join inventario i on i.producto_id = f.producto_id and i.sede_id = f.sede_id
 where i.cantidad <> 0;
```

Esperado: `debe_ser_cero=0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260818000003_campanas_03_vista_faltantes.sql
git commit -m "feat(inventario): vista v_faltantes_con_demanda"
```

---

# BLOQUE 2 — Campana A pasa a ser Reposición

## Task 4: Hook `useReposicionCount`

Solo datos. Los dos shells lo llaman una vez y reparten el número al botón y al
bottom nav, para no abrir dos suscripciones de realtime por la misma cifra.

**Files:**

- Create: `src/hooks/useReposicionCount.js`

- [ ] **Step 1: Escribir el hook**

```js
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";

/**
 * Conteo de líneas de reposición sugerida (`v_sugerencias_reorden`).
 *
 * Reemplaza al viejo conteo de `estado_stock IN ('Bajo','Agotado')`, que daba
 * 2.868 de los cuales 2.853 eran ceros legítimos de sedes que nunca han tenido
 * el producto. Esto da ~76, que sí es trabajo que alguien puede atender.
 *
 * La RLS de `inventario` es `USING (true)`, así que la vista NO se limita sola
 * a la sede del usuario aunque sea security_invoker: el filtro va explícito.
 */
export function useReposicionCount(perfil) {
  const [count, setCount] = useState(0);
  const timerRef = useRef(null);

  const fetchCount = useCallback(async () => {
    if (!perfil?.id) return;
    let q = supabase
      .from("v_sugerencias_reorden")
      .select("producto_id", { count: "exact", head: true });

    if (perfil.rol !== "Admin" && perfil.sede_id) {
      q = q.eq("sede_id", perfil.sede_id);
    }

    const { count: c, error } = await q;
    // Si falla, conservar el último conteo conocido en vez de caer a 0: un 0
    // falso se lee como "todo en orden" y es el peor error posible en un badge.
    if (!error) setCount(c ?? 0);
  }, [perfil?.id, perfil?.rol, perfil?.sede_id]);

  useEffect(() => {
    if (!perfil?.id) return;
    fetchCount();

    // Debounce de cola: la suscripción es sobre TODA la tabla `inventario`, así
    // que una venta de 20 líneas disparaba 20 recuentos sobre ~2.900 filas en
    // cada dispositivo conectado. Con esto, una venta produce un recuento.
    const programar = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(fetchCount, 3000);
    };

    const channel = supabase
      .channel("reposicion-count")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventario" },
        programar,
      )
      .subscribe();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      supabase.removeChannel(channel);
    };
  }, [perfil?.id, fetchCount]);

  return count;
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run lint`
Expected: sin errores nuevos en `src/hooks/useReposicionCount.js`.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useReposicionCount.js
git commit -m "feat(reposicion): hook de conteo con debounce"
```

---

## Task 5: Componente `ReposicionButton`

Solo UI. Recibe el conteo por prop y carga las dos pestañas cuando se abre el panel.

Sobre tokens: el header usa la paleta de shell (`var(--n-0)`, `var(--warn-500)`), no
la de páginas (`hsl(var(--card))`). Se sigue el precedente de `NotificacionesBell`,
que ya vive en ese contexto.

**Files:**

- Create: `src/components/layout/ReposicionButton.jsx`

- [ ] **Step 1: Escribir el componente**

```jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { PackageX } from "lucide-react";
import { supabase } from "../../lib/supabase";

/**
 * Botón de Reposición: qué hay que comprar.
 *
 * NO es una campana, a propósito. Antes había dos campanas idénticas pegadas en
 * el header y nadie las distinguía; la solución es que una deje de ser campana,
 * no cambiarla por otra campana con un punto.
 *
 * Recibe `count` por prop: el shell llama a useReposicionCount una sola vez y
 * lo reparte entre este botón y el bottom nav.
 */
const TABS = [
  { key: "reponer", label: "Reponer" },
  { key: "faltantes", label: "Se vende y no hay" },
];

export default function ReposicionButton({ count, perfil, mobile = false }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("reponer");
  const [datos, setDatos] = useState({ reponer: null, faltantes: null });
  const [totalFaltantes, setTotalFaltantes] = useState(null);
  const ref = useRef(null);

  const esAdmin = perfil?.rol === "Admin";
  const sede = perfil?.sede_id;

  const cargar = useCallback(
    async (cual) => {
      const porSede = (q) => (!esAdmin && sede ? q.eq("sede_id", sede) : q);

      if (cual === "reponer") {
        const { data, error } = await porSede(
          supabase
            .from("v_sugerencias_reorden")
            .select(
              "producto_id, referencia, nombre, clasificacion, sede_id, sede_nombre, cantidad_sugerida",
            )
            .order("clasificacion", { ascending: true })
            .order("cantidad_sugerida", { ascending: false })
            .limit(8),
        );
        if (!error) setDatos((d) => ({ ...d, reponer: data ?? [] }));
        return;
      }

      const { data, error } = await porSede(
        supabase
          .from("v_faltantes_con_demanda")
          .select(
            "producto_id, referencia, nombre, sede_id, sede_nombre, ventas_90d, unidades_90d",
          )
          .order("ventas_90d", { ascending: false })
          .limit(8),
      );
      if (!error) setDatos((d) => ({ ...d, faltantes: data ?? [] }));

      const { count: c, error: e2 } = await porSede(
        supabase
          .from("v_faltantes_con_demanda")
          .select("producto_id", { count: "exact", head: true }),
      );
      if (!e2) setTotalFaltantes(c ?? 0);
    },
    [esAdmin, sede],
  );

  useEffect(() => {
    if (!open) return;
    if (datos[tab] === null) cargar(tab);
  }, [open, tab, datos, cargar]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const verTodo = () => {
    setOpen(false);
    if (esAdmin) {
      navigate(tab === "reponer" ? "/admin/reorden" : "/admin/alertas");
    } else {
      navigate("/ops/inventario?estado=Agotado");
    }
  };

  const filas = datos[tab];
  const size = mobile ? "h-10 w-10" : "h-9 w-9";
  const icon = mobile ? "h-[18px] w-[18px]" : "h-4 w-4";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`focus-ring relative grid ${size} place-items-center rounded-md text-white/85 hover:bg-white/10`}
        aria-label={
          count > 0
            ? `${count} ${count === 1 ? "producto" : "productos"} por reponer`
            : "Nada por reponer"
        }
        title={
          count > 0
            ? `${count} ${count === 1 ? "producto" : "productos"} por reponer`
            : "Nada por reponer"
        }
      >
        <PackageX className={icon} strokeWidth={1.75} />
        {count > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 grid min-h-[16px] min-w-[16px] place-items-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ backgroundColor: "var(--warn-500)" }}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-[340px] overflow-hidden rounded-xl border shadow-lg"
          style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-200)" }}
        >
          <div
            className="flex border-b"
            style={{ borderColor: "var(--n-150)" }}
          >
            {TABS.map((t) => {
              const activo = t.key === tab;
              const n = t.key === "reponer" ? count : totalFaltantes;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className="flex-1 px-3 py-2 text-xs font-semibold"
                  style={{
                    color: activo ? "var(--p-700)" : "var(--n-500)",
                    borderBottom: activo
                      ? "2px solid var(--p-700)"
                      : "2px solid transparent",
                  }}
                >
                  {t.label}
                  {n !== null && n !== undefined ? ` (${n})` : ""}
                </button>
              );
            })}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {filas === null ? (
              <p
                className="px-3 py-6 text-center text-sm"
                style={{ color: "var(--n-500)" }}
              >
                Cargando…
              </p>
            ) : filas.length === 0 ? (
              <p
                className="px-3 py-6 text-center text-sm"
                style={{ color: "var(--n-500)" }}
              >
                {tab === "reponer"
                  ? "Nada por reponer"
                  : "Nada agotado que se esté vendiendo"}
              </p>
            ) : (
              filas.map((f) => (
                <button
                  key={`${f.producto_id}-${f.sede_id}`}
                  onClick={() => {
                    setOpen(false);
                    navigate(`/ops/inventario/${f.producto_id}`);
                  }}
                  className="block w-full border-b px-3 py-2.5 text-left last:border-b-0"
                  style={{
                    borderColor: "var(--n-100)",
                    backgroundColor: "var(--n-0)",
                  }}
                >
                  <p
                    className="truncate text-[13px] font-semibold"
                    style={{ color: "var(--n-950)" }}
                  >
                    {f.nombre}
                  </p>
                  <p className="text-xs" style={{ color: "var(--n-700)" }}>
                    {f.referencia} · {f.sede_nombre ?? f.sede_id} ·{" "}
                    {tab === "reponer"
                      ? `pedir ${f.cantidad_sugerida}`
                      : `${f.ventas_90d} ventas en 90 días`}
                  </p>
                </button>
              ))
            )}
          </div>

          <button
            onClick={verTodo}
            className="w-full border-t px-3 py-2.5 text-center text-xs font-medium"
            style={{ borderColor: "var(--n-150)", color: "var(--p-700)" }}
          >
            Ver todo
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run lint && npm run build`
Expected: build exitoso, sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/ReposicionButton.jsx
git commit -m "feat(reposicion): boton PackageX con panel de dos pestanas"
```

---

## Task 6: Cablear Reposición en `AdminShell`

**Files:**

- Modify: `src/components/layout/AdminShell.jsx`

- [ ] **Step 1: Borrar el hook viejo y usar el nuevo**

Borrar entero `useAlertasCountAdmin` (líneas 27-65, desde el comentario
`/* ── Hook: conteo de alertas de stock ...` hasta su `}` de cierre) y el import de
`Bell` si queda sin uso en el archivo. Añadir arriba:

```jsx
import { useReposicionCount } from "../../hooks/useReposicionCount";
import ReposicionButton from "./ReposicionButton";
```

Cambiar en el cuerpo de `AdminShell` (línea 515):

```jsx
const alertCount = useAlertasCountAdmin(perfil);
```

por:

```jsx
const reposicionCount = useReposicionCount(perfil);
```

- [ ] **Step 2: Reemplazar el Link de campana del header de escritorio**

`HeaderAdmin` recibe `perfil`, `initials` y `onLogout`, sin conteo. Por eso en PC el
botón no dice nada hasta que le dan clic. Cambiar la firma (línea 129):

```jsx
function HeaderAdmin({ perfil, initials, onLogout, reposicionCount }) {
```

Y reemplazar el bloque del `<Link to="/admin/alertas">` con la campana (líneas
153-160) por:

```jsx
<ReposicionButton count={reposicionCount} perfil={perfil} />
```

- [ ] **Step 3: Pasar el conteo al header de escritorio**

En la llamada a `<HeaderAdmin>` (línea 548) agregar la prop:

```jsx
<HeaderAdmin
  perfil={perfil}
  initials={initials}
  onLogout={handleLogout}
  reposicionCount={reposicionCount}
/>
```

- [ ] **Step 4: Cambiar el botón del header móvil**

En `MobileHeaderAdmin`, cambiar la firma para recibir `perfil` y el conteo nuevo:

```jsx
function MobileHeaderAdmin({ perfil, initials, reposicionCount, onMenu }) {
```

Reemplazar el `<button onClick={onBell}>` completo (líneas 214-232) por:

```jsx
<ReposicionButton count={reposicionCount} perfil={perfil} mobile />
```

Y actualizar la llamada (línea 556):

```jsx
<MobileHeaderAdmin
  perfil={perfil}
  initials={initials}
  reposicionCount={reposicionCount}
  onMenu={() => setMoreOpen(true)}
/>
```

La prop `onBell` desaparece: el botón ya no navega a ciegas, abre su panel.

- [ ] **Step 5: Actualizar el badge del bottom nav**

En `BottomNavAdmin` cambiar la prop `alertCount` por `reposicionCount` en la firma
(línea 455) y en las tres referencias del cuerpo (líneas 483, 488), y en la llamada
(línea 573). El badge del tab "Alertas" pasa a mostrar el mismo número de reposición
que el botón del header: mostrar 2.868 en cualquier parte era el defecto.

Cambiar también el color del badge para que coincida, de
`backgroundColor: "var(--dang-500)"` a `backgroundColor: "var(--warn-500)"`.

- [ ] **Step 6: Verificar que no quedó nada colgando**

Run: `grep -n "alertCount\|useAlertasCountAdmin\|onBell" src/components/layout/AdminShell.jsx`
Expected: sin resultados.

Run: `npm run lint && npm run build`
Expected: build exitoso.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/AdminShell.jsx
git commit -m "feat(admin): boton de Reposicion en header y bottom nav"
```

---

## Task 7: Cablear Reposición en `AppShell`

**Files:**

- Modify: `src/components/layout/AppShell.jsx`

- [ ] **Step 1: Borrar el hook viejo y usar el nuevo**

Borrar entero `useAlertasCount` (líneas 743-786) y el import de `Bell` si queda sin
uso. Añadir:

```jsx
import { useReposicionCount } from "../../hooks/useReposicionCount";
import ReposicionButton from "./ReposicionButton";
```

Cambiar (línea 795):

```jsx
const alertCount = useAlertasCount(perfil);
```

por:

```jsx
const reposicionCount = useReposicionCount(perfil);
```

- [ ] **Step 2: Reemplazar el botón del header de escritorio**

En `HeaderOps`, cambiar la firma (línea 236):

```jsx
function HeaderOps({ perfil, rol, initials, reposicionCount, onLogout }) {
```

Reemplazar el bloque completo del botón de campana con su comentario
`{/* Alertas de stock → inventario */}` (líneas 254-274) por:

```jsx
<ReposicionButton count={reposicionCount} perfil={perfil} />
```

La prop `onSearch` desaparece de este componente: su único uso era ese botón, y
estaba mal nombrada porque no buscaba nada, navegaba al inventario completo sin
aplicar el filtro que el badge prometía.

- [ ] **Step 3: Reemplazar el botón del header móvil**

En `MobileHeader`, cambiar la firma (línea 307):

```jsx
function MobileHeader({ perfil, initials, reposicionCount, onMenu }) {
```

Reemplazar el `<button onClick={onBell}>` completo (líneas 341-359) por:

```jsx
<ReposicionButton count={reposicionCount} perfil={perfil} mobile />
```

- [ ] **Step 4: Actualizar las llamadas**

```jsx
        <HeaderOps
          perfil={perfil}
          rol={rol}
          initials={initials}
          reposicionCount={reposicionCount}
          onLogout={handleLogout}
        />

        <MobileHeader
          perfil={perfil}
          initials={initials}
          reposicionCount={reposicionCount}
          onMenu={() => setMoreOpen(true)}
        />
```

Borrar también `const goToInventario = () => navigate("/ops/inventario");` (línea 826) si no queda ningún otro uso.

- [ ] **Step 5: Verificar que no quedó nada colgando**

Run: `grep -n "alertCount\|useAlertasCount\|onBell\|onSearch\|goToInventario" src/components/layout/AppShell.jsx`
Expected: sin resultados.

Run: `npm run lint && npm run build`
Expected: build exitoso.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/AppShell.jsx
git commit -m "feat(ops): boton de Reposicion en headers de operaciones"
```

---

## Task 8: `Inventario.jsx` acepta `?estado=`

El "Ver todo" de las vendedoras apunta a `/ops/inventario?estado=Agotado`. Hoy la
página solo lee `?q=`.

La página no tiene un filtro propio de estado, pero no hay que inventarlo: el store
ya expone `filtroEstado` (un `string[]`) y `setFiltros`, y la query ya hace
`.in("estado_stock", s.filtroEstado)` (`src/stores/inventarioStore.js:175`). Solo hay
que sembrarlo desde la URL, igual que ya se hace con `?q=`.

**Files:**

- Modify: `src/pages/ops/Inventario.jsx:62-68`

- [ ] **Step 1: Añadir la lista blanca de estados**

Junto a las demás constantes del módulo, fuera del componente:

```jsx
/** Valores REALES del enum `estado_stock`, los únicos que se aceptan por URL. */
const ESTADOS_URL = ["OK", "Bajo", "Agotado", "Sobrestock"];
```

- [ ] **Step 2: Sembrar el filtro en el efecto de montaje que ya existe**

El archivo ya tiene este efecto (líneas 62-68):

```jsx
// #33: si llega ?q=… del buscador global, lo aplica una vez al montar.
const [searchParams] = useSearchParams();
const qParam = searchParams.get("q");
useEffect(() => {
  if (qParam) setBusqueda(qParam);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

Reemplazarlo por:

```jsx
// #33: si llega ?q=… del buscador global, lo aplica una vez al montar.
// ?estado=… llega del botón de Reposición: el "Ver todo" de una vendedora
// debe caer en la lista ya filtrada, no en los 2.900 SKUs completos.
const [searchParams] = useSearchParams();
const qParam = searchParams.get("q");
const estadoParam = searchParams.get("estado");
useEffect(() => {
  if (qParam) setBusqueda(qParam);
  // Lista blanca: un ?estado= arbitrario no debe llegar crudo a la query.
  if (ESTADOS_URL.includes(estadoParam)) {
    setFiltros({ filtroEstado: [estadoParam] });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

- [ ] **Step 3: Exponer `setFiltros` en el componente**

`useInventario()` ya lo devuelve (`src/hooks/useInventario.js:91`). Verificar que el
componente lo esté desestructurando; si solo saca `setBusqueda`, añadir `setFiltros`
a esa desestructuración.

Run: `grep -n "setFiltros" src/pages/ops/Inventario.jsx`
Expected: aparece tanto en la desestructuración de `useInventario()` como en el
efecto nuevo.

- [ ] **Step 4: Verificar a mano**

Run: `npm run dev`
Abrir `http://localhost:5173/ops/inventario?estado=Agotado`
Expected: la página abre con el filtro de estado ya puesto en "Agotado" y la lista
muestra solo agotados. Abrir `/ops/inventario` sin params debe seguir mostrando todo.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ops/Inventario.jsx
git commit -m "feat(inventario): filtro de estado desde la URL"
```

---

# BLOQUE 3 — Campana B, correcciones

## Task 9: Mover y reescribir `NotificacionesBell`

**Files:**

- Create: `src/components/layout/NotificacionesBell.jsx`
- Delete: `src/components/admin/NotificacionesBell.jsx`

- [ ] **Step 1: Crear el componente nuevo**

```jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatDate } from "../../lib/utils";

/**
 * Campana de notificaciones in-app (tabla `notificaciones`).
 *
 * Vive en layout/ y no en admin/ porque la usan los dos shells: hasta ahora
 * solo se montaba en AdminShell, así que las 236 notificaciones de traspaso
 * dirigidas a Vendedor y Bodeguero nunca tuvieron dónde mostrarse.
 *
 * El badge se cuenta en servidor: contar los no leídos de las 30 filas
 * cargadas daba siempre 30 cuando el real era 763.
 */

/** A dónde lleva cada tipo de aviso, usando el `data` jsonb que ya viene lleno. */
function rutaDe(n) {
  const d = n?.data ?? {};
  switch (n?.tipo) {
    case "traspaso_en_camino":
      return d.traspaso_id ? `/ops/traspasos/${d.traspaso_id}` : null;
    case "ensamble_creado":
      return d.ensamble_id ? `/ops/ensambles/${d.ensamble_id}` : null;
    case "conversion_insumo":
      return d.sede_id && d.fecha
        ? `/admin/auditoria?tipo=conversion_a_insumo&sede=${encodeURIComponent(d.sede_id)}&desde=${d.fecha}&hasta=${d.fecha}`
        : null;
    case "costo_revisar":
      return d.producto_id ? `/ops/inventario/${d.producto_id}` : null;
    default:
      return null;
  }
}

const COLS = "id, tipo, titulo, mensaje, data, leida, created_at, updated_at";

export default function NotificacionesBell({ mobile = false }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Conteo en servidor, separado de las 30 filas del panel.
  const cargarConteo = useCallback(async () => {
    const { count, error } = await supabase
      .from("notificaciones")
      .select("id", { count: "exact", head: true })
      .eq("leida", false);
    // Si falla, conservar el último conteo en vez de mentir con 0.
    if (!error) setNoLeidas(count ?? 0);
  }, []);

  const cargarLista = useCallback(async () => {
    const { data, error } = await supabase
      .from("notificaciones")
      .select(COLS)
      // updated_at y no created_at: un aviso agrupado que se actualiza debe
      // subir a la cabeza de la lista, y su created_at no cambia.
      .order("updated_at", { ascending: false })
      .limit(30);
    if (!error) setItems(data ?? []);
  }, []);

  useEffect(() => {
    cargarConteo();
    cargarLista();

    // Escucha INSERT y UPDATE: el agrupado de conversiones actualiza una fila
    // existente en vez de insertar, así que solo con INSERT no se vería.
    const channel = supabase
      .channel("notificaciones-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notificaciones" },
        () => {
          cargarConteo();
          cargarLista();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [cargarConteo, cargarLista]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const abrir = async () => {
    const next = !open;
    setOpen(next);
    if (next) await cargarLista();
  };

  const alHacerClic = async (n) => {
    const destino = rutaDe(n);
    if (!n.leida) {
      setItems((rows) =>
        rows.map((r) => (r.id === n.id ? { ...r, leida: true } : r)),
      );
      setNoLeidas((c) => Math.max(0, c - 1));
      await supabase
        .from("notificaciones")
        .update({ leida: true })
        .eq("id", n.id);
    }
    // Si el aviso no trae la clave esperada se queda marcado leído y no se
    // navega, en vez de mandar a una ruta muerta.
    if (destino) {
      setOpen(false);
      navigate(destino);
    }
  };

  const marcarTodas = async () => {
    if (noLeidas === 0) return;
    setItems((rows) => rows.map((n) => ({ ...n, leida: true })));
    setNoLeidas(0);
    // Sin lista de ids: así barre las 763, no solo las 30 cargadas. La RLS ya
    // limita el alcance a para_rol = get_my_rol() o created_by = auth.uid().
    await supabase
      .from("notificaciones")
      .update({ leida: true })
      .eq("leida", false);
    await cargarConteo();
  };

  const size = mobile ? "h-10 w-10" : "h-9 w-9";
  const icon = mobile ? "h-[18px] w-[18px]" : "h-4 w-4";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={abrir}
        className={`focus-ring relative grid ${size} place-items-center rounded-md text-white/85 hover:bg-white/10`}
        aria-label={
          noLeidas > 0
            ? `${noLeidas} notificaciones sin leer`
            : "Notificaciones"
        }
        title="Notificaciones"
      >
        <Bell className={icon} strokeWidth={1.75} />
        {noLeidas > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 grid min-h-[16px] min-w-[16px] place-items-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ backgroundColor: "var(--dang-500)" }}
          >
            {noLeidas > 99 ? "99+" : noLeidas}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-[340px] overflow-hidden rounded-xl border shadow-lg"
          style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-200)" }}
        >
          <div
            className="flex items-center justify-between border-b px-3 py-2"
            style={{ borderColor: "var(--n-150)" }}
          >
            <span
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--n-500)" }}
            >
              Notificaciones
            </span>
            {noLeidas > 0 && (
              <button
                onClick={marcarTodas}
                className="text-xs font-medium"
                style={{ color: "var(--p-700)" }}
              >
                Marcar todas leídas
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p
                className="px-3 py-6 text-center text-sm"
                style={{ color: "var(--n-500)" }}
              >
                Sin notificaciones
              </p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => alHacerClic(n)}
                  className="block w-full border-b px-3 py-2.5 text-left last:border-b-0"
                  style={{
                    borderColor: "var(--n-100)",
                    backgroundColor: n.leida
                      ? "var(--n-0)"
                      : "var(--info-50, #eff6ff)",
                  }}
                >
                  <div className="flex items-start gap-2">
                    {!n.leida && (
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: "var(--info-500, #0ea5c9)" }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[13px] font-semibold"
                        style={{ color: "var(--n-950)" }}
                      >
                        {n.titulo}
                      </p>
                      <p className="text-xs" style={{ color: "var(--n-700)" }}>
                        {n.mensaje}
                      </p>
                      <p
                        className="mt-0.5 text-[10.5px]"
                        style={{ color: "var(--n-500)" }}
                      >
                        {formatDate(n.updated_at ?? n.created_at)}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Borrar el componente viejo**

```bash
git rm src/components/admin/NotificacionesBell.jsx
```

- [ ] **Step 3: Verificar que compila**

Run: `npm run lint && npm run build`
Expected: falla el build con un error de import en `AdminShell.jsx`, que todavía
apunta a `../admin/NotificacionesBell`. Se arregla en la tarea siguiente.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/NotificacionesBell.jsx
git commit -m "feat(notificaciones): campana reescrita, conteo en servidor y navegacion"
```

---

## Task 10: Montar la campana donde están sus destinatarios

**Files:**

- Modify: `src/components/layout/AdminShell.jsx`
- Modify: `src/components/layout/AppShell.jsx`

- [ ] **Step 1: Arreglar el import en AdminShell**

Cambiar (línea 21):

```jsx
import NotificacionesBell from "../admin/NotificacionesBell";
```

por:

```jsx
import NotificacionesBell from "./NotificacionesBell";
```

- [ ] **Step 2: Montarla en el header móvil de admin**

Dentro de `MobileHeaderAdmin`, justo antes del `<ReposicionButton>` que quedó de la
Task 6, añadir:

```jsx
<NotificacionesBell mobile />
```

- [ ] **Step 3: Montarla en los dos headers de AppShell**

Añadir el import en `AppShell.jsx`:

```jsx
import NotificacionesBell from "./NotificacionesBell";
```

En `HeaderOps`, justo antes del `<ReposicionButton>`:

```jsx
<NotificacionesBell />
```

En `MobileHeader`, justo antes del `<ReposicionButton>`:

```jsx
<NotificacionesBell mobile />
```

- [ ] **Step 4: Verificar que compila y que los dos iconos conviven**

Run: `npm run lint && npm run build`
Expected: build exitoso.

Run: `npm run dev`
Expected: en el header se ven dos botones claramente distintos, una campana `Bell`
con badge rojo y un paquete `PackageX` con badge naranja. En una ventana angosta
(móvil) también aparecen los dos y no se encima ninguno.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AdminShell.jsx src/components/layout/AppShell.jsx
git commit -m "feat(notificaciones): montar la campana en operaciones y en movil"
```

---

## Task 11: `Auditoria.jsx` lee los filtros de la URL

Es el destino del clic en el aviso agrupado de conversiones. Hoy no lee query params.

**Files:**

- Modify: `src/pages/admin/Auditoria.jsx:1-2` (import) y `55-60` (estados)

- [ ] **Step 1: Importar el hook de params**

El archivo ya importa de `react-router-dom` (línea 2). Añadir `useSearchParams` a esa
importación existente.

- [ ] **Step 2: Añadir el validador de fecha junto a las constantes del módulo**

Fuera del componente, cerca de `TIPOS` y `PAGE_SIZE`:

```jsx
/** Solo se acepta YYYY-MM-DD: un ?desde= arbitrario no llega crudo a la query. */
const esFecha = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
```

- [ ] **Step 3: Sembrar los cuatro filtros desde la URL**

Los estados actuales son exactamente estos (líneas 55-60):

```jsx
const [tipo, setTipo] = useState("Todos");
const [sedeId, setSedeId] = useState("");
const [usuarioId, setUsuarioId] = useState("");
const [search, setSearch] = useState("");
const [fechaDesde, setFechaDesde] = useState("");
const [fechaHasta, setFechaHasta] = useState("");
```

Reemplazarlos por:

```jsx
// Deep-link desde la campana de notificaciones: el aviso agrupado de
// conversiones a insumo abre esta página ya filtrada por su día y sede.
const [searchParams] = useSearchParams();
const tipoParam = searchParams.get("tipo");
const sedeParam = searchParams.get("sede");
const desdeParam = searchParams.get("desde");
const hastaParam = searchParams.get("hasta");

// TIPOS es la lista blanca que ya existe en el archivo (línea 32).
const [tipo, setTipo] = useState(
  TIPOS.includes(tipoParam) ? tipoParam : "Todos",
);
const [sedeId, setSedeId] = useState(sedeParam ?? "");
const [usuarioId, setUsuarioId] = useState("");
const [search, setSearch] = useState("");
const [fechaDesde, setFechaDesde] = useState(
  esFecha(desdeParam) ? desdeParam : "",
);
const [fechaHasta, setFechaHasta] = useState(
  esFecha(hastaParam) ? hastaParam : "",
);
```

`sedeId` no lleva lista blanca porque el selector de sedes se llena desde la tabla
`sedes` y un id inexistente simplemente no devuelve filas, sin romper nada. `TIPOS`
ya incluye `"Todos"`, así que `TIPOS.includes(null)` da `false` y cae al defecto.

- [ ] **Step 4: Abrir el panel de filtros si vino algo por URL**

Si no, el usuario aterriza con filtros puestos que no ve. El estado
`showFiltros` ya existe (línea 61):

```jsx
const [showFiltros, setShowFiltros] = useState(
  Boolean(tipoParam || sedeParam || desdeParam || hastaParam),
);
```

- [ ] **Step 5: Probar el deep-link a mano**

Run: `npm run dev`
Abrir:
`http://localhost:5173/admin/auditoria?tipo=conversion_a_insumo&sede=BODEGA&desde=2026-08-18&hasta=2026-08-18`

Expected: la página abre con el selector de tipo en "Conversión a insumo", la sede en
BODEGA y el rango de fechas puesto en ese día. Abrir `/admin/auditoria` sin params
debe seguir mostrando los valores por defecto de siempre.

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/Auditoria.jsx
git commit -m "feat(auditoria): inicializar filtros desde la URL"
```

---

# BLOQUE 4 — Datos y cierre

## Task 12: Marcar leídas las conversiones históricas

**PARAR AQUÍ.** Esto toca datos de producción y el spec lo marca como pendiente del
OK explícito del dueño. Pedirlo antes de ejecutar el paso 2. Si dice que no, saltar
la tarea entera: todo lo demás funciona igual, solo que el badge arranca en 763.

**Files:** ninguno. Es un `UPDATE` puntual, no una migración: es limpieza de datos de
una sola vez, no un cambio de esquema que otro entorno deba repetir.

- [ ] **Step 1: Medir antes**

```sql
select count(*) filter (where not leida and tipo='conversion_insumo') conversiones_sin_leer,
       count(*) filter (where not leida) total_sin_leer
  from notificaciones where para_rol = 'Admin';
```

Esperado: `conversiones_sin_leer=741`, `total_sin_leer=763`.

- [ ] **Step 2: Aplicar, solo con el OK del dueño**

```sql
update notificaciones
   set leida = true
 where tipo = 'conversion_insumo'
   and dedupe_key is null      -- solo las históricas, nunca el aviso agrupado de hoy
   and not leida;
```

- [ ] **Step 3: Verificar**

```sql
select count(*) filter (where not leida and tipo='conversion_insumo') conversiones_sin_leer,
       count(*) filter (where not leida) total_sin_leer
  from notificaciones where para_rol = 'Admin';
select count(*) traspasos_intactos from notificaciones
 where tipo = 'traspaso_en_camino' and not leida;
```

Esperado: `conversiones_sin_leer=0`, `total_sin_leer=22`, `traspasos_intactos=236`.

Las de traspaso se dejan sin leer a propósito: son las que nunca se pudieron ver y
ahora sí tienen dónde mostrarse.

---

## Task 13: Verificación final

- [ ] **Step 1: Repasar que no quedó código muerto**

```bash
grep -rn "useAlertasCount\|alertCount\|BellDot\|components/admin/NotificacionesBell" src/
```

Expected: sin resultados.

- [ ] **Step 2: Lint y build limpios**

Run: `npm run lint && npm run build`
Expected: ambos exitosos, sin warnings nuevos.

- [ ] **Step 3: Verificación de base de datos completa**

```sql
select
  (select count(*) from v_sugerencias_reorden)      reponer,
  (select count(*) from v_faltantes_con_demanda)    faltantes,
  (select count(*) from pg_publication_tables
     where pubname='supabase_realtime' and tablename='notificaciones') realtime_ok,
  (select count(*) from information_schema.column_privileges
    where table_name='notificaciones' and grantee='authenticated'
      and privilege_type='UPDATE') columnas_actualizables;
```

Esperado: `reponer=76`, `faltantes=219`, `realtime_ok=1`, `columnas_actualizables=1`.

- [ ] **Step 4: Prueba manual, la lista que corre el dueño**

Con sesión de Admin (Maritza):

1. El header muestra una campana y un paquete, distintos a simple vista.
2. El paquete tiene badge naranja en 76; el clic abre el panel con dos pestañas.
3. "Ver todo" desde "Reponer" lleva a `/admin/reorden`.
4. La campana muestra el total real de no leídos, no 30.
5. "Marcar todas leídas" lo deja en 0 y sigue en 0 al recargar.
6. Un clic en un aviso de traspaso abre ese traspaso.

Con sesión de una vendedora (por ejemplo Bladimir, CHV): 7. Ve los dos botones; el de reposición muestra ~20, solo de su sede. 8. Ve por fin sus avisos de traspaso, que antes no tenían dónde salir. 9. "Ver todo" la lleva al inventario ya filtrado en agotados.

Prueba de agrupado en vivo, dos personas o dos ventanas: 10. Una vendedora convierte un `INVENTARIO DE PRUEBA (999)` a insumo. En la ventana
del Admin aparece un aviso "Hoy en …: 1 conversión a insumo". 11. Convierte otro. El mismo aviso pasa a "2 conversiones" sin recargar y sin crear
una fila nueva.

- [ ] **Step 5: Commit final si hubo ajustes**

```bash
git add -A
git commit -m "chore(campanas): ajustes de verificacion final"
```

---

## Notas de alcance

No se toca `/admin/alertas` ni `/admin/reorden` por dentro; siguen igual y con su
valor propio. No se cambian permisos ni roles. No se toca auth ni el candado
append-only de `movimientos`. No se reconfiguran los 2.792 `stock_minimo` faltantes:
la segunda pestaña existe precisamente para no depender de ese trabajo.
