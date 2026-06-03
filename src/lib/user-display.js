export function usuarioDisplayName(usuario) {
  if (usuario?.rol === "Admin") return "Admin";
  return usuario?.nombre ?? "";
}
