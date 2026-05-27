import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";

import { useAuthStore } from "./stores/authStore";
import {
  subscribeParametros,
  unsubscribeParametros,
} from "./hooks/useParametro";
import Login from "./pages/Login";
import RoleGuard from "./components/layout/RoleGuard";
import AppShell from "./components/layout/AppShell";
import AdminShell from "./components/layout/AdminShell";
import Inventario from "./pages/ops/Inventario";
import Productos from "./pages/ops/Productos";
import ProductoDetalle from "./pages/ops/ProductoDetalle";
import ProductoNuevo from "./pages/ops/ProductoNuevo";
import VentaHistorial from "./pages/ops/VentaHistorial";
import VentaNueva from "./pages/ops/VentaNueva";
import VentaDetalle from "./pages/ops/VentaDetalle";
import CotizacionHistorial from "./pages/ops/CotizacionHistorial";
import CotizacionNueva from "./pages/ops/CotizacionNueva";
import CotizacionDetalle from "./pages/ops/CotizacionDetalle";
import CotizacionEditar from "./pages/ops/CotizacionEditar";
import Dashboard from "./pages/ops/Dashboard";
import CompraHistorial from "./pages/ops/CompraHistorial";
import CompraNueva from "./pages/ops/CompraNueva";
import CompraDetalle from "./pages/ops/CompraDetalle";
import GarantiasIndex from "./pages/ops/Garantias";
import GarantiaCompraDetalle from "./pages/ops/Garantias/GarantiaCompraDetalle";
import GarantiaVentaDetalle from "./pages/ops/Garantias/GarantiaVentaDetalle";
import NotasCredito from "./pages/admin/NotasCredito";
import DevolucionHistorial from "./pages/ops/DevolucionHistorial";
import DevolucionNueva from "./pages/ops/DevolucionNueva";
import TraspasoHistorial from "./pages/ops/TraspasoHistorial";
import TraspasoNuevo from "./pages/ops/TraspasoNuevo";
import TraspasoDetalle from "./pages/ops/TraspasoDetalle";
import PickingPage from "./pages/ops/PickingPage";
import VerificacionTraspaso from "./pages/ops/VerificacionTraspaso";
import RecepcionTraspaso from "./pages/ops/RecepcionTraspaso";
import Herramientas from "./pages/ops/Herramientas";
import OrdenHistorial from "./pages/ops/OrdenHistorial";
import OrdenNueva from "./pages/ops/OrdenNueva";
import OrdenDetalle from "./pages/ops/OrdenDetalle";
import EnsambleHistorial from "./pages/ops/EnsambleHistorial";
import EnsambleNuevo from "./pages/ops/EnsambleNuevo";
import ReciboHistorial from "./pages/ops/Recibos/ReciboHistorial";
import ReciboNuevo from "./pages/ops/Recibos/ReciboNuevo";
import ReciboDetalle from "./pages/ops/Recibos/ReciboDetalle";
import AdminDashboard from "./pages/admin/Dashboard";
import Cierres from "./pages/admin/Cierres";
import Alertas from "./pages/admin/Alertas";
import Reorden from "./pages/admin/Reorden";
import Top10 from "./pages/admin/Top10";
import Configuracion from "./pages/admin/Configuracion";
import AnalisisABC from "./pages/admin/AnalisisABC";
import Auditoria from "./pages/admin/Auditoria";
import Usuarios from "./pages/admin/Usuarios";
import Conteo from "./pages/admin/Conteo";

// Placeholder genérico para módulos aún no implementados
function Placeholder({ name }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="text-6xl mb-4">🚧</div>
      <h2
        className="text-2xl font-bold mb-2"
        style={{ color: "hsl(var(--foreground))" }}
      >
        {name}
      </h2>
      <p style={{ color: "hsl(var(--muted-foreground))" }}>
        Módulo en desarrollo — próximas fases
      </p>
    </div>
  );
}

export default function App() {
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    const cleanupPromise = init();
    return () => {
      cleanupPromise.then((unsub) => {
        if (typeof unsub === "function") unsub();
      });
    };
  }, [init]);

  // Suscripción Realtime a parametros_sistema (Fase 9): cuando un Admin cambia
  // un parámetro en otra tab/dispositivo, invalida la caché local.
  useEffect(() => {
    subscribeParametros();
    return () => unsubscribeParametros();
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        {/* Login público */}
        <Route path="/login" element={<Login />} />

        {/* ── App de Operaciones ── */}
        <Route
          path="/ops"
          element={
            <RoleGuard roles={["Admin", "Bodeguero", "Vendedor", "Tecnico"]}>
              <AppShell />
            </RoleGuard>
          }
        >
          <Route index element={<Dashboard />} />

          {/* Inventario — lista */}
          <Route
            path="inventario"
            element={
              <RoleGuard roles={["Admin", "Bodeguero", "Vendedor"]}>
                <Inventario />
              </RoleGuard>
            }
          />
          {/* Inventario — nuevo producto (Fase 12) */}
          <Route
            path="inventario/nuevo"
            element={
              <RoleGuard roles={["Admin", "Bodeguero"]}>
                <ProductoNuevo />
              </RoleGuard>
            }
          />
          {/* Inventario — detalle de producto */}
          <Route
            path="inventario/:productoId"
            element={
              <RoleGuard roles={["Admin", "Bodeguero", "Vendedor"]}>
                <ProductoDetalle />
              </RoleGuard>
            }
          />
          <Route
            path="ventas"
            element={
              <RoleGuard roles={["Admin", "Vendedor"]}>
                <VentaHistorial />
              </RoleGuard>
            }
          />
          <Route
            path="ventas/nueva"
            element={
              <RoleGuard roles={["Admin", "Vendedor"]}>
                <VentaNueva />
              </RoleGuard>
            }
          />
          <Route
            path="ventas/:id"
            element={
              <RoleGuard roles={["Admin", "Vendedor"]}>
                <VentaDetalle />
              </RoleGuard>
            }
          />
          <Route
            path="compras"
            element={
              <RoleGuard roles={["Admin", "Bodeguero"]}>
                <CompraHistorial />
              </RoleGuard>
            }
          />
          <Route
            path="compras/nueva"
            element={
              <RoleGuard roles={["Admin", "Bodeguero"]}>
                <CompraNueva />
              </RoleGuard>
            }
          />
          {/* Compras — detalle (Fase 13) */}
          <Route
            path="compras/:id"
            element={
              <RoleGuard roles={["Admin", "Bodeguero"]}>
                <CompraDetalle />
              </RoleGuard>
            }
          />
          {/* Garantías — Fase 13 */}
          <Route
            path="garantias"
            element={
              <RoleGuard roles={["Admin", "Bodeguero", "Vendedor", "Tecnico"]}>
                <GarantiasIndex />
              </RoleGuard>
            }
          />
          <Route
            path="garantias/compra/:id"
            element={
              <RoleGuard roles={["Admin", "Bodeguero"]}>
                <GarantiaCompraDetalle />
              </RoleGuard>
            }
          />
          <Route
            path="garantias/venta/:id"
            element={
              <RoleGuard roles={["Admin", "Vendedor", "Tecnico"]}>
                <GarantiaVentaDetalle />
              </RoleGuard>
            }
          />
          {/* Traspasos — Fase 6 */}
          <Route
            path="traspasos"
            element={
              <RoleGuard roles={["Admin", "Bodeguero", "Vendedor"]}>
                <TraspasoHistorial />
              </RoleGuard>
            }
          />
          <Route
            path="traspasos/nuevo"
            element={
              <RoleGuard roles={["Admin", "Bodeguero"]}>
                <TraspasoNuevo />
              </RoleGuard>
            }
          />
          <Route
            path="traspasos/:id"
            element={
              <RoleGuard roles={["Admin", "Bodeguero", "Vendedor"]}>
                <TraspasoDetalle />
              </RoleGuard>
            }
          />
          <Route
            path="traspasos/:id/picking"
            element={
              <RoleGuard roles={["Admin", "Bodeguero"]}>
                <PickingPage />
              </RoleGuard>
            }
          />
          <Route
            path="traspasos/:id/verificar"
            element={
              <RoleGuard roles={["Admin", "Bodeguero"]}>
                <VerificacionTraspaso />
              </RoleGuard>
            }
          />
          <Route
            path="traspasos/:id/recibir"
            element={
              <RoleGuard roles={["Admin", "Bodeguero", "Vendedor"]}>
                <RecepcionTraspaso />
              </RoleGuard>
            }
          />
          <Route
            path="ordenes"
            element={
              <RoleGuard roles={["Admin", "Tecnico", "Bodeguero"]}>
                <OrdenHistorial />
              </RoleGuard>
            }
          />
          <Route
            path="ordenes/nueva"
            element={
              <RoleGuard roles={["Admin", "Tecnico"]}>
                <OrdenNueva />
              </RoleGuard>
            }
          />
          <Route
            path="ordenes/:id"
            element={
              <RoleGuard roles={["Admin", "Tecnico", "Bodeguero"]}>
                <OrdenDetalle />
              </RoleGuard>
            }
          />
          <Route
            path="ensambles"
            element={
              <RoleGuard roles={["Admin", "Bodeguero", "Tecnico"]}>
                <EnsambleHistorial />
              </RoleGuard>
            }
          />
          <Route
            path="ensambles/nuevo"
            element={
              <RoleGuard roles={["Admin", "Bodeguero", "Tecnico"]}>
                <EnsambleNuevo />
              </RoleGuard>
            }
          />
          <Route
            path="cotizaciones"
            element={
              <RoleGuard roles={["Admin", "Vendedor"]}>
                <CotizacionHistorial />
              </RoleGuard>
            }
          />
          <Route
            path="cotizaciones/nueva"
            element={
              <RoleGuard roles={["Admin", "Vendedor"]}>
                <CotizacionNueva />
              </RoleGuard>
            }
          />
          <Route
            path="cotizaciones/:id"
            element={
              <RoleGuard roles={["Admin", "Vendedor"]}>
                <CotizacionDetalle />
              </RoleGuard>
            }
          />
          <Route
            path="cotizaciones/:id/editar"
            element={
              <RoleGuard roles={["Admin", "Vendedor"]}>
                <CotizacionEditar />
              </RoleGuard>
            }
          />
          <Route
            path="herramientas"
            element={
              <RoleGuard roles={["Admin", "Bodeguero", "Vendedor", "Tecnico"]}>
                <Herramientas />
              </RoleGuard>
            }
          />
          <Route
            path="devoluciones"
            element={
              <RoleGuard roles={["Admin", "Bodeguero"]}>
                <DevolucionHistorial />
              </RoleGuard>
            }
          />
          <Route
            path="devoluciones/nueva"
            element={
              <RoleGuard roles={["Admin", "Bodeguero"]}>
                <DevolucionNueva />
              </RoleGuard>
            }
          />
          {/* Recibos — Fase 14 */}
          <Route
            path="recibos"
            element={
              <RoleGuard roles={["Admin", "Vendedor"]}>
                <ReciboHistorial />
              </RoleGuard>
            }
          />
          <Route
            path="recibos/nuevo"
            element={
              <RoleGuard roles={["Admin", "Vendedor"]}>
                <ReciboNuevo />
              </RoleGuard>
            }
          />
          <Route
            path="recibos/:id"
            element={
              <RoleGuard roles={["Admin", "Vendedor"]}>
                <ReciboDetalle />
              </RoleGuard>
            }
          />
          <Route
            path="productos"
            element={
              <RoleGuard roles={["Admin", "Bodeguero", "Vendedor"]}>
                <Productos />
              </RoleGuard>
            }
          />
        </Route>

        {/* ── Panel Admin ── */}
        <Route
          path="/admin"
          element={
            <RoleGuard roles={["Admin"]}>
              <AdminShell />
            </RoleGuard>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="cierres" element={<Cierres />} />
          <Route path="alertas" element={<Alertas />} />
          <Route path="conteo" element={<Conteo />} />
          <Route path="abc" element={<AnalisisABC />} />
          <Route path="reorden" element={<Reorden />} />
          <Route path="auditoria" element={<Auditoria />} />
          <Route path="usuarios" element={<Usuarios />} />
          <Route path="top10" element={<Top10 />} />
          <Route path="configuracion" element={<Configuracion />} />
          <Route path="notas-credito" element={<NotasCredito />} />
        </Route>

        {/* Fallback → login */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
