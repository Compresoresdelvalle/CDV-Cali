-- Devolución de cliente con reembolso: columnas nuevas.
--  destino_stock : 'vendible' (vuelve a stock) | 'chatarra' (defectuoso, no vendible) | 'no_reingresa'
--  reembolso     : monto + método + cuenta (etiqueta texto, como ventas/compras). El
--                  egreso queda con la fecha de la devolución (hoy) y su sede.
ALTER TABLE devoluciones
  ADD COLUMN IF NOT EXISTS destino_stock text NOT NULL DEFAULT 'vendible',
  ADD COLUMN IF NOT EXISTS monto_reembolso numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metodo_reembolso text,
  ADD COLUMN IF NOT EXISTS cuenta_reembolso text,
  ADD COLUMN IF NOT EXISTS chatarra_producto_id uuid REFERENCES productos(id);

ALTER TABLE devoluciones
  DROP CONSTRAINT IF EXISTS devoluciones_destino_stock_check,
  ADD CONSTRAINT devoluciones_destino_stock_check
    CHECK (destino_stock IN ('vendible','chatarra','no_reingresa')),
  DROP CONSTRAINT IF EXISTS devoluciones_monto_reembolso_check,
  ADD CONSTRAINT devoluciones_monto_reembolso_check CHECK (monto_reembolso >= 0);
