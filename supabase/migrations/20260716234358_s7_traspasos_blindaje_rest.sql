-- s7 Traspasos: blindaje REST. Toda escritura pasa por las RPCs SECURITY DEFINER (owner postgres).
-- Se revoca escritura directa a authenticated/anon; SELECT permanece (RLS ya lo gobierna).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON traspasos, detalle_traspaso FROM authenticated, anon;
