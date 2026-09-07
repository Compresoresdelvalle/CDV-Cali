-- Retenciones: seis columnas de captura y una derivada por tabla.
--
-- Se guarda el PORCENTAJE y el VALOR. El porcentaje solo para poder mostrar de
-- donde salio el numero; el valor es el dato bueno. Si manana la ley cambia la
-- tarifa, los documentos viejos conservan lo que se les aplico de verdad.
--
-- Los cuatro valores son GENERATED STORED, no calculados por codigo: dependen
-- unicamente de columnas de la misma fila, asi que no pueden desincronizarse ni
-- por un bug de la RPC ni por un UPDATE a mano. Eso cubre gratis la venta que
-- genera una OT y la que genera un cambio de producto.
--
-- retenciones_total no puede referirse a las otras tres (Postgres prohibe que
-- una columna generada lea otra generada), asi que repite la expresion. Es
-- verboso a proposito: la alternativa era que pudieran discrepar.
--
-- Las columnas de `compras` nacen aqui aunque la fase 2 sea la que las use, para
-- no partir la migracion del esquema en dos.
--
-- Todas nacen en 0: las ventas, OT y compras que ya existen quedan con retencion
-- cero y su comportamiento no cambia. Verificado midiendo antes y despues:
-- ventas 440.956.783 / OT 87.002.433 / compras 281.751.230,81 sin mover un peso.

-- ventas ------------------------------------------------------------------
ALTER TABLE public.ventas
  ADD COLUMN retefuente_pct numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN reteica_pct    numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN reteiva_pct    numeric(6,3) NOT NULL DEFAULT 0,
  ADD CONSTRAINT ventas_retefuente_pct_rango CHECK (retefuente_pct >= 0 AND retefuente_pct <= 100),
  ADD CONSTRAINT ventas_reteica_pct_rango    CHECK (reteica_pct    >= 0 AND reteica_pct    <= 100),
  ADD CONSTRAINT ventas_reteiva_pct_rango    CHECK (reteiva_pct    >= 0 AND reteiva_pct    <= 100);

ALTER TABLE public.ventas
  ADD COLUMN retefuente_valor numeric(12,2) GENERATED ALWAYS AS (
    round(public._fn_base_retencion_venta(subtotal, descuento_valor, descuento_pct)
          * retefuente_pct / 100)) STORED,
  ADD COLUMN reteica_valor numeric(12,2) GENERATED ALWAYS AS (
    round(public._fn_base_retencion_venta(subtotal, descuento_valor, descuento_pct)
          * reteica_pct / 100)) STORED,
  ADD COLUMN reteiva_valor numeric(12,2) GENERATED ALWAYS AS (
    round(public._fn_iva_venta(subtotal, descuento_valor, descuento_pct, iva_pct)
          * reteiva_pct / 100)) STORED,
  ADD COLUMN retenciones_total numeric(12,2) GENERATED ALWAYS AS (
      round(public._fn_base_retencion_venta(subtotal, descuento_valor, descuento_pct) * retefuente_pct / 100)
    + round(public._fn_base_retencion_venta(subtotal, descuento_valor, descuento_pct) * reteica_pct / 100)
    + round(public._fn_iva_venta(subtotal, descuento_valor, descuento_pct, iva_pct) * reteiva_pct / 100)
  ) STORED;

-- ordenes_servicio --------------------------------------------------------
ALTER TABLE public.ordenes_servicio
  ADD COLUMN retefuente_pct numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN reteica_pct    numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN reteiva_pct    numeric(6,3) NOT NULL DEFAULT 0,
  ADD CONSTRAINT ot_retefuente_pct_rango CHECK (retefuente_pct >= 0 AND retefuente_pct <= 100),
  ADD CONSTRAINT ot_reteica_pct_rango    CHECK (reteica_pct    >= 0 AND reteica_pct    <= 100),
  ADD CONSTRAINT ot_reteiva_pct_rango    CHECK (reteiva_pct    >= 0 AND reteiva_pct    <= 100);

ALTER TABLE public.ordenes_servicio
  ADD COLUMN retefuente_valor numeric(12,2) GENERATED ALWAYS AS (
    round(public._fn_base_retencion_ot(estado_autorizacion, costo_mano_obra, valor_repuestos,
                                       valor_revision, descuento_valor) * retefuente_pct / 100)) STORED,
  ADD COLUMN reteica_valor numeric(12,2) GENERATED ALWAYS AS (
    round(public._fn_base_retencion_ot(estado_autorizacion, costo_mano_obra, valor_repuestos,
                                       valor_revision, descuento_valor) * reteica_pct / 100)) STORED,
  ADD COLUMN reteiva_valor numeric(12,2) GENERATED ALWAYS AS (
    round(round(public._fn_base_retencion_ot(estado_autorizacion, costo_mano_obra, valor_repuestos,
                                             valor_revision, descuento_valor) * iva_pct / 100)
          * reteiva_pct / 100)) STORED,
  ADD COLUMN retenciones_total numeric(12,2) GENERATED ALWAYS AS (
      round(public._fn_base_retencion_ot(estado_autorizacion, costo_mano_obra, valor_repuestos,
                                         valor_revision, descuento_valor) * retefuente_pct / 100)
    + round(public._fn_base_retencion_ot(estado_autorizacion, costo_mano_obra, valor_repuestos,
                                         valor_revision, descuento_valor) * reteica_pct / 100)
    + round(round(public._fn_base_retencion_ot(estado_autorizacion, costo_mano_obra, valor_repuestos,
                                               valor_revision, descuento_valor) * iva_pct / 100)
            * reteiva_pct / 100)
  ) STORED;

-- compras (fase 2; nacen aqui y quedan en 0) ------------------------------
ALTER TABLE public.compras
  ADD COLUMN retefuente_pct numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN reteica_pct    numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN reteiva_pct    numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN retefuente_valor numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN reteica_valor    numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN reteiva_valor    numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN retenciones_total numeric(12,2) GENERATED ALWAYS AS (
    retefuente_valor + reteica_valor + reteiva_valor) STORED,
  ADD CONSTRAINT compras_retefuente_pct_rango CHECK (retefuente_pct >= 0 AND retefuente_pct <= 100),
  ADD CONSTRAINT compras_reteica_pct_rango    CHECK (reteica_pct    >= 0 AND reteica_pct    <= 100),
  ADD CONSTRAINT compras_reteiva_pct_rango    CHECK (reteiva_pct    >= 0 AND reteiva_pct    <= 100);

COMMENT ON COLUMN public.ventas.retenciones_total IS
  'Suma de las tres retenciones. Es lo que el cliente NO paga porque lo consigna a la DIAN o al municipio. La factura (total, IVA, subtotal) no cambia.';
COMMENT ON COLUMN public.ordenes_servicio.retenciones_total IS
  'Suma de las tres retenciones de la OT. El saldo cobrable es total - retenciones_total.';
COMMENT ON COLUMN public.compras.retenciones_total IS
  'Fase 2: la empresa como agente retenedor. Hoy siempre 0.';
