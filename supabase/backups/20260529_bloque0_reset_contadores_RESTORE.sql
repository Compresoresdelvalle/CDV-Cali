-- =====================================================================
-- RESPALDO / RESTAURACIÓN — Bloque 0 #1 (Reset de contadores)
-- Generado: 2026-05-29
-- Proyecto: Compresores del Valle (PRODUCCIÓN)
--
-- Este archivo REVIERTE la migración 20260529000001_bloque0_reset_contadores.sql
-- Restaura los números (numero) originales de cada documento y los valores
-- de secuencia tal como estaban ANTES de la renumeración.
--
-- USO (solo si hay que revertir):
--   Ejecutar este script completo contra la base de datos de producción.
-- =====================================================================

BEGIN;

-- ---------- VENTAS (restaurar 72..77) ----------
UPDATE ventas SET numero = 72 WHERE id = '615d9077-144d-4186-83ac-613e8f714010';
UPDATE ventas SET numero = 73 WHERE id = 'b6d90ed2-1696-4141-9634-33cf02756d25';
UPDATE ventas SET numero = 74 WHERE id = '84d6472f-295f-45a2-a674-5c80dba1d3a5';
UPDATE ventas SET numero = 75 WHERE id = '12292ddf-8cb2-43ef-b476-46b00877e86d';
UPDATE ventas SET numero = 76 WHERE id = '0c545f34-5a10-441e-8dab-e0964da7fcce';
UPDATE ventas SET numero = 77 WHERE id = '156c0d76-00ce-4592-991e-0df17830dea0';

-- ---------- COTIZACIONES (restaurar 459) ----------
UPDATE cotizaciones SET numero = 459 WHERE id = '471b6768-2b3d-4cc4-8030-cc3e73d3e6a9';

-- ---------- ORDENES_SERVICIO (restaurar 236, 237) ----------
UPDATE ordenes_servicio SET numero = 236 WHERE id = '2cb2f29b-35e2-407f-8fa0-709bdd2bd9e2';
UPDATE ordenes_servicio SET numero = 237 WHERE id = 'a4d1de94-e756-489e-9689-2d48e1bc81c6';

-- ---------- DEVOLUCIONES (restaurar 29, 30) ----------
UPDATE devoluciones SET numero = 29 WHERE id = '49e8af58-c2b9-42e8-ba2b-8d1efd7b5145';
UPDATE devoluciones SET numero = 30 WHERE id = '570aa642-10e8-45a1-8c64-663115849f85';

-- NOTA: cierres NO se renumeró (tabla inmutable), por lo tanto no se restaura.

-- ---------- COMPRAS (restaurar 82..103) ----------
UPDATE compras SET numero = 82  WHERE id = 'e33ccc2d-736a-43f5-91cb-643a7f36009a';
UPDATE compras SET numero = 83  WHERE id = '22e48ec7-2a62-4036-b76b-2a6c4bf2317a';
UPDATE compras SET numero = 84  WHERE id = '91f026df-c59f-4ec8-a432-3ed32f252665';
UPDATE compras SET numero = 85  WHERE id = '2f619afe-31c4-451b-9630-8b18da8d9425';
UPDATE compras SET numero = 86  WHERE id = '92dd7211-a50c-4f36-ba9a-823dfeb7ea9e';
UPDATE compras SET numero = 87  WHERE id = '787fd735-ac11-4ab1-90f1-b4f9e59d405f';
UPDATE compras SET numero = 88  WHERE id = '303df320-b66d-401e-a6a5-e5ee2085015c';
UPDATE compras SET numero = 89  WHERE id = '6d0470e1-fbaa-451e-b83d-818d5bf254ef';
UPDATE compras SET numero = 90  WHERE id = 'a8a23aa5-46d0-41bd-9866-03411a98fbb1';
UPDATE compras SET numero = 91  WHERE id = '5d10e047-6d8b-4610-b97c-1f69923f5878';
UPDATE compras SET numero = 92  WHERE id = '895dc6be-5706-4ae1-b752-66f8209b8195';
UPDATE compras SET numero = 93  WHERE id = '30eeea6c-a3a4-466c-8297-02e5acd36940';
UPDATE compras SET numero = 94  WHERE id = '84e6525e-4d5e-4998-b29c-0bcc760b0041';
UPDATE compras SET numero = 95  WHERE id = 'ac99f4f5-3700-43d5-94d0-98e7f2119c4f';
UPDATE compras SET numero = 96  WHERE id = 'd4aaf21a-9cd4-487b-b9aa-9c1038ab2d70';
UPDATE compras SET numero = 97  WHERE id = 'adece745-2846-49f7-a94b-1afe8a1fb51b';
UPDATE compras SET numero = 98  WHERE id = '1affd9b0-c4dd-4990-b96d-062107a6ced8';
UPDATE compras SET numero = 99  WHERE id = '05e2848d-2ca7-43a8-983b-53e85626ee87';
UPDATE compras SET numero = 100 WHERE id = 'd0bdd639-a9c4-4754-a61e-d4febb9232a6';
UPDATE compras SET numero = 101 WHERE id = '830cfdd4-f092-4f79-8533-5ede0c1850a5';
UPDATE compras SET numero = 102 WHERE id = 'e8ffbe6b-0e25-4c36-8ba5-99b30e316152';
UPDATE compras SET numero = 103 WHERE id = 'ba708e8c-aee3-4131-8313-e90f0792193b';

-- ---------- TRASPASOS (restaurar 51..68) ----------
UPDATE traspasos SET numero = 51 WHERE id = '955f3657-3978-4267-9bed-ab5f9f55dac4';
UPDATE traspasos SET numero = 52 WHERE id = '88c6bbc7-3129-47a3-9850-4282c95e7188';
UPDATE traspasos SET numero = 53 WHERE id = '317f4e5b-d030-4fab-b583-8be933dfb723';
UPDATE traspasos SET numero = 54 WHERE id = 'd6a2ba0d-a663-45e8-b023-6c6a6e3c4d5e';
UPDATE traspasos SET numero = 55 WHERE id = '9818d074-9231-4cca-8385-43f72e0212c9';
UPDATE traspasos SET numero = 56 WHERE id = 'cdb6cdd7-6688-4c77-a180-e784c97db434';
UPDATE traspasos SET numero = 57 WHERE id = 'b061327a-bec0-4b16-9ff1-3d8b1f642613';
UPDATE traspasos SET numero = 58 WHERE id = 'b28f2eb0-a68f-4c99-9e8f-3a48a6d02f21';
UPDATE traspasos SET numero = 59 WHERE id = 'f8355b79-2279-447a-8112-1298685390e5';
UPDATE traspasos SET numero = 60 WHERE id = '2435b49a-16da-41d7-b158-1c86510d9141';
UPDATE traspasos SET numero = 61 WHERE id = '259f5b63-c232-42af-be43-fa21092da824';
UPDATE traspasos SET numero = 62 WHERE id = '33ff412f-c3aa-40ed-bf29-43f9745857f2';
UPDATE traspasos SET numero = 63 WHERE id = '48b57334-d5f5-4077-b45c-0dbd77809a7b';
UPDATE traspasos SET numero = 64 WHERE id = '6f4d9d11-99ef-4151-bf0a-88d0ba5c5d0f';
UPDATE traspasos SET numero = 65 WHERE id = '5a765230-ddc5-4b31-96fd-e2a1aca8d251';
UPDATE traspasos SET numero = 66 WHERE id = '8e70d8cf-51a0-4a88-b023-ca4261b63882';
UPDATE traspasos SET numero = 67 WHERE id = '360615a4-f260-43d4-9427-d6f22cc1f205';
UPDATE traspasos SET numero = 68 WHERE id = '8a5dd807-4722-423a-a2e1-97658b04d6b6';

-- ---------- RESTAURAR SECUENCIAS ----------
SELECT setval('ventas_numero_seq',           77,  true);
SELECT setval('cotizaciones_numero_seq',      459, true);
SELECT setval('compras_numero_seq',           103, true);
SELECT setval('traspasos_numero_seq',         68,  true);
SELECT setval('ordenes_servicio_numero_seq',  237, true);
SELECT setval('devoluciones_numero_seq',      30,  true);
SELECT setval('ensambles_numero_seq',         1,   true);
SELECT setval('recibos_numero_seq',           15,  true);
-- cierres_numero_seq: no se modificó, no requiere restauración.

COMMIT;
