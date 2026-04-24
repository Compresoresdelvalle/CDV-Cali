# Permisos por Rol — Compresores del Valle

## Matriz completa

| Módulo                    | Admin    | Bodeguero    | Vendedor             | Técnico      |
| ------------------------- | -------- | ------------ | -------------------- | ------------ |
| Inventario (todas sedes)  | ✅       | ✅           | ❌                   | ❌           |
| Inventario (solo su sede) | —        | —            | ✅                   | ❌           |
| Ventas                    | ✅       | ❌           | ✅                   | ❌           |
| Compras                   | ✅       | ✅           | ❌                   | ❌           |
| Traspasos + Picking       | ✅       | ✅           | Solo lectura su sede | ❌           |
| Órdenes de Servicio       | ✅       | ❌           | ❌                   | ✅           |
| Ensambles BOM             | ✅       | ✅           | ❌                   | ✅           |
| Cotizaciones              | ✅       | ❌           | ✅                   | ❌           |
| Herramientas              | ✅       | ✅           | ✅                   | ✅           |
| Devoluciones              | ✅       | ✅           | ❌                   | ❌           |
| Productos (catálogo)      | ✅ Edita | Solo lectura | Solo lectura         | Solo lectura |
| Panel Admin completo      | ✅       | ❌           | ❌                   | ❌           |
| Gestión de usuarios       | ✅       | ❌           | ❌                   | ❌           |

## Acciones especiales

| Acción                    | Quién puede                                     |
| ------------------------- | ----------------------------------------------- |
| Anular una venta          | Solo Admin                                      |
| Descuento > 10%           | Solo usuarios con `puede_descuento_alto = true` |
| Editar precio de producto | Solo Admin                                      |
| Crear/desactivar usuario  | Solo Admin                                      |
| Aprobar devolución        | Solo Admin                                      |
| Verificar traspaso        | Admin + Bodeguero (diferente al picker)         |

## Usuarios del sistema

| Nombre          | PIN  | Rol       | Sede          | Email Auth               |
| --------------- | ---- | --------- | ------------- | ------------------------ |
| Carlos Dueño    | 0001 | Admin     | BOD-PRINCIPAL | carlos@compresores.local |
| Pedro Bodeguero | 1234 | Bodeguero | BOD-PRINCIPAL | pedro@compresores.local  |
| María Vendedora | 5678 | Vendedor  | ALM-01        | maria@compresores.local  |
| Juan Vendedor   | 9012 | Vendedor  | ALM-02        | juan@compresores.local   |
| Ana Vendedora   | 3456 | Vendedor  | ALM-03        | ana@compresores.local    |
| Luis Técnico    | 7890 | Técnico   | BOD-PRINCIPAL | luis@compresores.local   |
