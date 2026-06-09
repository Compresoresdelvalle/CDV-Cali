-- Bloque 0 — Crear 5 usuarios nuevos (4 técnicos + 1 bodeguero), todos en BODEGA.
-- Se crean directamente: cuenta de auth (email + PIN como password bcrypt),
-- identidad 'email' (necesaria para signInWithPassword) y perfil en
-- public.usuarios. PIN = password. Idempotente (NOT EXISTS por email).
--
-- | Email                            | PIN  | Nombre   | Rol       |
-- | servteccompresores@hotmail.com   | 1409 | Paolo    | Tecnico   |
-- | servtec1compresores@hotmail.com  | 2824 | Carlos A | Tecnico   |
-- | servtec2compresores@hotmail.com  | 4657 | Dario    | Tecnico   |
-- | servtec3compresores@hotmail.com  | 5012 | Fabián A | Tecnico   |
-- | bodegacompresores@hotmail.com    | 5506 | Bodega2  | Bodeguero |

-- 1) Cuentas de autenticación (email + PIN bcrypt). Estructura replicada de un
--    usuario existente que ya inicia sesión.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous
)
select
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  v.email,
  extensions.crypt(v.pin, extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"email_verified":true}'::jsonb,
  false, false
from (values
  ('servteccompresores@hotmail.com',  '1409'),
  ('servtec1compresores@hotmail.com', '2824'),
  ('servtec2compresores@hotmail.com', '4657'),
  ('servtec3compresores@hotmail.com', '5012'),
  ('bodegacompresores@hotmail.com',   '5506')
) v(email, pin)
where not exists (select 1 from auth.users u where u.email = v.email);

-- 2) Identidad 'email' por usuario (GoTrue la requiere para login por password).
insert into auth.identities (
  provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  u.id::text, u.id,
  jsonb_build_object(
    'sub', u.id::text, 'email', u.email,
    'email_verified', true, 'phone_verified', false
  ),
  'email', now(), now(), now()
from auth.users u
where u.email in (
  'servteccompresores@hotmail.com', 'servtec1compresores@hotmail.com',
  'servtec2compresores@hotmail.com', 'servtec3compresores@hotmail.com',
  'bodegacompresores@hotmail.com'
)
and not exists (
  select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
);

-- 3) Perfil operativo (rol, sede, PIN visible para el panel de Admin).
insert into public.usuarios (id, nombre, pin, rol, sede_id, activo)
select u.id, m.nombre, m.pin, m.rol::rol_usuario, 'BODEGA', true
from auth.users u
join (values
  ('servteccompresores@hotmail.com',  'Paolo',    '1409', 'Tecnico'),
  ('servtec1compresores@hotmail.com', 'Carlos A', '2824', 'Tecnico'),
  ('servtec2compresores@hotmail.com', 'Dario',    '4657', 'Tecnico'),
  ('servtec3compresores@hotmail.com', 'Fabián A', '5012', 'Tecnico'),
  ('bodegacompresores@hotmail.com',   'Bodega2',  '5506', 'Bodeguero')
) m(email, nombre, pin, rol) on m.email = u.email
where not exists (select 1 from public.usuarios pu where pu.id = u.id);
