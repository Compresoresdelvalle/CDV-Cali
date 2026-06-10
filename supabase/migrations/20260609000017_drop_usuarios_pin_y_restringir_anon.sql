-- CRÍTICO (auditoría 2026-06-09 #2): la política anon_read_login daba al rol
-- `anon` SELECT sobre TODAS las columnas de `usuarios` (filtrando solo
-- activo=true), incluida `pin` en texto plano (4 dígitos). Como el login usa
-- signInWithPassword (la verdad de auth vive en auth.users con bcrypt) y el
-- email del Admin está en el bundle público, cualquiera con la anon key podía
-- leer el PIN del Admin y suplantarlo.
--
-- Verificado antes de eliminar:
--   * usuarios.pin coincide con auth.users.encrypted_password en 12/12 (100%
--     redundante para auth).
--   * NINGÚN código (frontend, edge functions) ni función de BD lee/escribe
--     usuarios.pin (el login usa el input local + signInWithPassword).
--
-- Fix: (1) eliminar la columna pin (quita el secreto en texto plano del reposo);
--      (2) endurecer los grants de anon a solo-lectura de las columnas del login.
-- La rotación de los PIN (en auth.users) se gestiona aparte con el cliente.

-- 1) Eliminar la columna pin (redundante con auth.users).
alter table public.usuarios drop column if exists pin;

-- 2) anon: solo SELECT de las columnas que necesita la pantalla de login.
revoke all on table public.usuarios from anon;
grant select (id, nombre, rol, sede_id, activo) on table public.usuarios to anon;
