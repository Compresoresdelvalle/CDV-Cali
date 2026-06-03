// Nombre visible de un usuario. Devuelve el nombre real guardado en la tabla
// `usuarios` para TODOS los roles (incluido Admin). Antes el Admin se
// enmascaraba siempre como "Admin"; ahora se muestra el nombre real para que
// renombrar usuarios desde el panel se refleje en el Login y en toda la app.
// Los permisos/rutas NO dependen de este texto (van por `rol`), así que esto
// es puramente de presentación.
export function usuarioDisplayName(usuario) {
  return usuario?.nombre?.trim() || "";
}
