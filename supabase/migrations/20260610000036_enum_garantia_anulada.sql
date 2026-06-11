-- MEDIO (auditoría 2026-06-09, M10): preparación para la reversa/anulación de
-- garantías. Se agrega el valor 'anulada' a los enums de estado de garantía. Debe ir
-- en su propia migración: ALTER TYPE ... ADD VALUE no puede USARSE en la misma
-- transacción en que se crea (la función fn_anular_garantia_* va en otra migración).

alter type public.estado_garantia_venta  add value if not exists 'anulada';
alter type public.estado_garantia_compra add value if not exists 'anulada';
