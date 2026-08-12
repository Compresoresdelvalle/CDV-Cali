import { useAuthStore } from "../../stores/authStore";
import Cierres from "../admin/Cierres";
import CierreCajaVendedor from "./CierreCajaVendedor";

/**
 * Ruta /ops/cierre según el rol:
 *  - Vendedor  → vista enfocada, SOLO su sede, en vivo, read-only.
 *  - Admin/Bodega → la pantalla de Cierres completa (Bodega en solo-lectura;
 *    Admin normalmente sella desde /admin/cierres).
 * La sede de la vendedora la fuerza el backend (fn_preview_cierre), no la UI.
 */
export default function CierreOps() {
  const rol = useAuthStore((s) => s.perfil?.rol);
  return rol === "Vendedor" ? <CierreCajaVendedor /> : <Cierres />;
}
