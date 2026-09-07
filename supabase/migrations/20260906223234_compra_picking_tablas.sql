-- Bitacora del conteo de recepcion.
--
-- No es burocracia: cuando dentro de un mes pregunten por que una compra bajo
-- $60.000, la respuesta tiene que tener nombre y fecha. `metodo_conteo` guarda
-- COMO se conto cada linea, que es lo que despues permite distinguir un conteo
-- real de uno de tramite.

CREATE TABLE IF NOT EXISTS public.compra_picking (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id       uuid NOT NULL UNIQUE REFERENCES public.compras(id),
  usuario_id      uuid NOT NULL REFERENCES public.usuarios(id),
  fecha           timestamptz NOT NULL DEFAULT now(),
  omitido         boolean NOT NULL DEFAULT false,
  lineas_total    integer NOT NULL DEFAULT 0,
  lineas_contadas integer NOT NULL DEFAULT 0,
  notas           text
);

CREATE TABLE IF NOT EXISTS public.compra_picking_detalle (
  id                bigserial PRIMARY KEY,
  picking_id        uuid NOT NULL REFERENCES public.compra_picking(id) ON DELETE CASCADE,
  -- Sin FK a proposito: fn_recibir_compra BORRA la linea que reciba en cero,
  -- y la bitacora del conteo tiene que sobrevivir a eso. Es justo el caso que
  -- despues hay que poder explicar.
  detalle_compra_id uuid NOT NULL,
  producto_id       uuid NOT NULL REFERENCES public.productos(id),
  pedido            integer NOT NULL,
  llegaron          integer NOT NULL,
  danadas           integer NOT NULL DEFAULT 0,
  faltante_accion   text,
  sobrante_accion   text,
  metodo_conteo     text NOT NULL DEFAULT 'manual',
  CONSTRAINT chk_picking_cantidades CHECK (
    llegaron >= 0 AND danadas >= 0 AND danadas <= llegaron AND pedido >= 0
  ),
  CONSTRAINT chk_picking_faltante CHECK (
    faltante_accion IS NULL OR faltante_accion IN ('ajustar','reclamar')
  ),
  CONSTRAINT chk_picking_sobrante CHECK (
    sobrante_accion IS NULL OR sobrante_accion IN ('entra','entra_y_reporta')
  ),
  CONSTRAINT chk_picking_metodo CHECK (
    metodo_conteo IN ('manual','escaner','completo','nada')
  )
);

CREATE INDEX IF NOT EXISTS idx_picking_detalle_picking
  ON public.compra_picking_detalle(picking_id);

ALTER TABLE public.compra_picking          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compra_picking_detalle  ENABLE ROW LEVEL SECURITY;

-- Lectura: Admin ve todo; los demas ven el picking de las compras de su sede.
-- Escritura: NINGUNA politica, a proposito. Solo entra por la RPC
-- SECURITY DEFINER, igual que la recepcion misma.
CREATE POLICY picking_select ON public.compra_picking FOR SELECT
  USING (
    (SELECT get_my_rol()) = 'Admin'
    OR EXISTS (SELECT 1 FROM compras c
                WHERE c.id = compra_picking.compra_id
                  AND c.sede_destino_id = (SELECT get_my_sede_id()))
  );

CREATE POLICY picking_det_select ON public.compra_picking_detalle FOR SELECT
  USING (
    (SELECT get_my_rol()) = 'Admin'
    OR EXISTS (SELECT 1 FROM compra_picking cp JOIN compras c ON c.id = cp.compra_id
                WHERE cp.id = compra_picking_detalle.picking_id
                  AND c.sede_destino_id = (SELECT get_my_sede_id()))
  );

REVOKE INSERT, UPDATE, DELETE ON public.compra_picking         FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.compra_picking_detalle FROM anon, authenticated;
GRANT SELECT ON public.compra_picking         TO authenticated;
GRANT SELECT ON public.compra_picking_detalle TO authenticated;
