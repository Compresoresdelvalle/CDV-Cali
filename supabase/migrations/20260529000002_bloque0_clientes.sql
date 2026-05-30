-- =====================================================================
-- BLOQUE 0 #2 — Tabla de clientes reutilizable (Fase A: base de datos)
-- Fecha: 2026-05-29
--
-- Crea una tabla `clientes` reutilizable + autocompletado vía fn_upsert_cliente,
-- y agrega columnas cliente_id (aditivas, nullable) a los documentos que usan
-- cliente, conservando los campos de texto actuales (snapshot del documento).
--
-- Decisiones:
--   - Campos: nombre, identificacion (NIT/cédula), telefono, email, direccion.
--   - identificacion: OPCIONAL, pero ÚNICA cuando se ingresa (cliente activo).
--   - Permisos: todos los autenticados crean y seleccionan; solo Admin edita/
--     desactiva (soft delete vía activo). No se permite DELETE físico.
--
-- 100% aditivo y reversible. No modifica funciones de ventas existentes.
-- =====================================================================

-- ---------- TABLA ----------
CREATE TABLE IF NOT EXISTS public.clientes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         text NOT NULL,
  identificacion text,
  telefono       text,
  email          text,
  direccion      text,
  activo         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid DEFAULT auth.uid()
);

-- Identificación única solo entre clientes activos y cuando viene informada.
CREATE UNIQUE INDEX IF NOT EXISTS ux_clientes_identificacion
  ON public.clientes (identificacion)
  WHERE identificacion IS NOT NULL AND activo;

-- Búsqueda por nombre (case-insensitive).
CREATE INDEX IF NOT EXISTS ix_clientes_nombre_lower
  ON public.clientes (lower(nombre));

-- ---------- updated_at automático ----------
CREATE OR REPLACE FUNCTION public.fn_clientes_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clientes_updated_at ON public.clientes;
CREATE TRIGGER trg_clientes_updated_at
  BEFORE UPDATE ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.fn_clientes_set_updated_at();

-- ---------- PERMISOS + RLS ----------
GRANT SELECT, INSERT, UPDATE ON public.clientes TO authenticated;

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clientes_select ON public.clientes;
CREATE POLICY clientes_select ON public.clientes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS clientes_insert ON public.clientes;
CREATE POLICY clientes_insert ON public.clientes
  FOR INSERT TO authenticated WITH CHECK (true);

-- Editar / desactivar: solo Admin.
DROP POLICY IF EXISTS clientes_update ON public.clientes;
CREATE POLICY clientes_update ON public.clientes
  FOR UPDATE TO authenticated
  USING (get_my_rol() = 'Admin')
  WITH CHECK (get_my_rol() = 'Admin');

-- ---------- ENLACE EN DOCUMENTOS (aditivo, nullable) ----------
ALTER TABLE public.ventas            ADD COLUMN IF NOT EXISTS cliente_id uuid REFERENCES public.clientes(id);
ALTER TABLE public.cotizaciones      ADD COLUMN IF NOT EXISTS cliente_id uuid REFERENCES public.clientes(id);
ALTER TABLE public.ordenes_servicio  ADD COLUMN IF NOT EXISTS cliente_id uuid REFERENCES public.clientes(id);
ALTER TABLE public.recibos           ADD COLUMN IF NOT EXISTS cliente_id uuid REFERENCES public.clientes(id);

-- ---------- RPC: buscar/crear cliente (autocompletado) ----------
-- Si se pasa identificación y ya existe un cliente activo con ella, lo reutiliza;
-- si no, crea uno nuevo. SECURITY INVOKER => respeta RLS (insert permitido a todos).
CREATE OR REPLACE FUNCTION public.fn_upsert_cliente(
  p_nombre         text,
  p_identificacion text DEFAULT NULL,
  p_telefono       text DEFAULT NULL,
  p_email          text DEFAULT NULL,
  p_direccion      text DEFAULT NULL
) RETURNS public.clientes
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_cliente public.clientes;
  v_nombre  text := NULLIF(btrim(p_nombre), '');
  v_ident   text := NULLIF(btrim(p_identificacion), '');
BEGIN
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'El nombre del cliente es obligatorio';
  END IF;

  IF v_ident IS NOT NULL THEN
    SELECT * INTO v_cliente
      FROM public.clientes
      WHERE identificacion = v_ident AND activo
      LIMIT 1;
    IF FOUND THEN
      RETURN v_cliente;
    END IF;
  END IF;

  INSERT INTO public.clientes (nombre, identificacion, telefono, email, direccion)
  VALUES (
    v_nombre,
    v_ident,
    NULLIF(btrim(p_telefono), ''),
    NULLIF(btrim(p_email), ''),
    NULLIF(btrim(p_direccion), '')
  )
  RETURNING * INTO v_cliente;

  RETURN v_cliente;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_upsert_cliente(text, text, text, text, text) TO authenticated;
