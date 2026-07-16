-- S4-18: bloquear escritura directa por REST a `inventario`.
-- El frontend nunca escribe inventario directo (todo pasa por RPCs SECURITY DEFINER,
-- que bypasean RLS por ser owner). Se elimina la única política que autorizaba
-- INSERT/UPDATE/DELETE directo (inv_modify_block, cmd=ALL para Admin).
-- La lectura sigue cubierta por inv_select (SELECT, qual=true).
DROP POLICY inv_modify_block ON public.inventario;
