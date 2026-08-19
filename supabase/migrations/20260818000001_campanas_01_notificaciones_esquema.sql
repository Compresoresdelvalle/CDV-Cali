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
-- deben chocar entre sí. Es además el predicado que exige el ON CONFLICT
-- de la migración siguiente para poder inferir este índice.
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
-- no tiene RLS por columna, así que hoy un usuario autenticado podría modificar
-- `data` o el dedupe_key nuevo por REST. Los grants por columna sí lo impiden.
-- Las funciones SECURITY DEFINER corren como postgres y no se ven afectadas.
REVOKE UPDATE ON public.notificaciones FROM authenticated;
REVOKE UPDATE ON public.notificaciones FROM anon;
GRANT  UPDATE (leida) ON public.notificaciones TO authenticated;
