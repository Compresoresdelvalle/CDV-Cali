-- s7 Traspasos: higiene de grants — retira REFERENCES y TRIGGER residuales del GRANT ALL original.
-- authenticated/anon quedan solo con SELECT sobre traspasos y detalle_traspaso.
REVOKE REFERENCES, TRIGGER ON traspasos, detalle_traspaso FROM authenticated, anon;
