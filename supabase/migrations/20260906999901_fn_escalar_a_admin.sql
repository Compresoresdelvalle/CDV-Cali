-- Escalamiento al Admin desde cualquier pantalla operativa.
--
-- El tope de 2 avisos vive AQUI y no en el frontend: en la pantalla bastaria
-- recargar para reiniciar el contador y el spam volveria. Se cuenta contra
-- dedupe_key, que agrupa todos los avisos del mismo documento.
--
-- Reusa la tabla `notificaciones` tal cual. No hay tabla nueva: `para_rol`,
-- `leida` y `dedupe_key` ya existen y el hook useNotificaciones ya carga las no
-- leidas al montar, que es lo que hace que el aviso sea lo primero que ve el
-- Admin al abrir la app aunque no estuviera conectado.

CREATE OR REPLACE FUNCTION public.fn_escalar_a_admin(
  p_origen    text,
  p_origen_id uuid,
  p_motivo    text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_rol        text;
  v_nombre     text;
  v_sede       text;
  v_dedupe     text;
  v_enviados   int;
  v_ultimo     timestamptz;
  v_admin      text;
  v_numero     int;
  v_titulo     text;
  v_ruta       text;
  v_tope       constant int := 2;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT u.rol::text, u.nombre, u.sede_id INTO v_rol, v_nombre, v_sede
    FROM usuarios u WHERE u.id = v_uid;
  IF v_rol IS NULL THEN
    RAISE EXCEPTION 'Sesion no valida. Vuelve a iniciar sesion.';
  END IF;
  IF v_rol = 'Admin' THEN
    RAISE EXCEPTION 'Ya eres el administrador: no hay a quien escalarle esto.';
  END IF;
  IF p_origen IS NULL OR p_origen NOT IN ('compra') THEN
    RAISE EXCEPTION 'Origen no soportado: %', COALESCE(p_origen, 'ninguno');
  END IF;
  IF p_origen_id IS NULL THEN
    RAISE EXCEPTION 'Falta el documento sobre el que se avisa.';
  END IF;
  IF length(TRIM(COALESCE(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'Escribe brevemente que esta pasando (minimo 5 letras), o el aviso no le sirve de nada a quien lo recibe.';
  END IF;

  v_dedupe := 'escalamiento:' || p_origen || ':' || p_origen_id::text;

  SELECT count(*), max(created_at) INTO v_enviados, v_ultimo
    FROM notificaciones WHERE dedupe_key = v_dedupe;

  SELECT u.nombre INTO v_admin
    FROM usuarios u WHERE u.rol::text = 'Admin' AND u.activo LIMIT 1;

  IF v_enviados >= v_tope THEN
    RAISE EXCEPTION 'Ya le avisaste % veces a % por esto (la ultima hace %). Si es urgente, buscala directamente: el sistema no va a insistir mas.',
      v_enviados, COALESCE(v_admin, 'Administracion'),
      COALESCE(age(now(), v_ultimo)::text, 'un momento');
  END IF;

  SELECT c.numero INTO v_numero FROM compras c WHERE c.id = p_origen_id;
  IF v_numero IS NULL THEN
    RAISE EXCEPTION 'Esa compra no existe.';
  END IF;
  v_titulo := format('%s necesita ayuda con la compra #%s', v_nombre, v_numero);
  v_ruta   := '/ops/compras/' || p_origen_id::text;

  INSERT INTO notificaciones (tipo, titulo, mensaje, data, para_rol, created_by, dedupe_key)
  VALUES ('escalamiento', v_titulo, TRIM(p_motivo),
          jsonb_build_object('origen', p_origen, 'origen_id', p_origen_id,
                             'numero', v_numero, 'sede_id', v_sede,
                             'usuario_nombre', v_nombre, 'ruta', v_ruta),
          'Admin', v_uid, v_dedupe);

  RETURN jsonb_build_object(
    'avisos_enviados', v_enviados + 1,
    'restantes',       v_tope - (v_enviados + 1),
    'admin_nombre',    COALESCE(v_admin, 'Administracion'),
    'ultimo_aviso',    now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_escalar_a_admin(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_escalar_a_admin(text, uuid, text) TO authenticated;
