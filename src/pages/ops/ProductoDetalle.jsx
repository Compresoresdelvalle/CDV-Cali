import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeftCircle,
  Package,
  Store,
  QrCode,
  Tag,
  ClipboardList,
  History,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../stores/authStore";
import StatusBadge from "../../components/ui/StatusBadge";
import QRGenerator from "../../components/qr/QRGenerator";
import QRPrintLabel from "../../components/qr/QRPrintLabel";
import TipoProductoBadge from "../../components/inventario/TipoProductoBadge";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import UbicacionChip from "../../components/ui/UbicacionChip";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import { avisarOk, avisarError } from "../../lib/notify";
import { ubicacionLabel } from "../../lib/inventario-ui";
import { usuarioDisplayName } from "../../lib/user-display";

export default function ProductoDetalle() {
  const { productoId } = useParams();
  const navigate = useNavigate();
  const authLoading = useAuthStore((s) => s.loading);
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";
  // S4-04: el RPC fn_convertir_a_insumo autoriza a estos 4 roles (y notifica al
  // Admin cuando lo usa otro rol). '→ a venta' (fn_revertir_insumo_a_venta) sí
  // es solo Admin. Antes ambos botones estaban ocultos a todos menos Admin.
  const puedeConvertirInsumo = [
    "Admin",
    "Bodeguero",
    "Tecnico",
    "Vendedor",
  ].includes(perfil?.rol);

  const [producto, setProducto] = useState(null);
  const [inventario, setInventario] = useState([]);
  const [movimientos, setMovimientos] = useState([]);
  // Bloque D1: catálogo de ubicaciones activas (para el select de asignación)
  // y estado de guardado por fila de inventario.
  const [ubicacionesActivas, setUbicacionesActivas] = useState([]);
  const [guardandoUbicacionId, setGuardandoUbicacionId] = useState(null);
  const puedeAsignarUbicacion =
    perfil?.rol === "Admin" || perfil?.rol === "Bodeguero";
  const [proveedores, setProveedores] = useState([]); // F12: historial proveedores
  const [historialPrecios, setHistorialPrecios] = useState([]); // auditoría costo/precio
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── Edición de precio (solo Admin) ───────────────────────────────────
  const [editandoPrecio, setEditandoPrecio] = useState(false);
  const [nuevoPrecio, setNuevoPrecio] = useState("");
  const [guardandoPrecio, setGuardandoPrecio] = useState(false);
  const [errorPrecio, setErrorPrecio] = useState("");
  const guardandoPrecioRef = useRef(false);

  // ── Edición de costo promedio (solo Admin) ───────────────────────────
  const [editandoCosto, setEditandoCosto] = useState(false);
  const [nuevoCosto, setNuevoCosto] = useState("");
  const [guardandoCosto, setGuardandoCosto] = useState(false);
  const [errorCosto, setErrorCosto] = useState("");
  const guardandoCostoRef = useRef(false);
  // Costo unitario de materiales del último ensamble completado de este
  // producto. El ensamble NO aplica el costo solo (es decisión del Admin),
  // pero sí lo calcula y lo dejamos como valor sugerido para no escribir a
  // ciegas cuando el costo promedio quedó en 0.
  const [costoSugerido, setCostoSugerido] = useState(null);

  // ── Conversión venta <-> insumo (solo Admin) ─────────────────────────
  const [convInv, setConvInv] = useState(null); // fila de inventario en conversión
  const [convDir, setConvDir] = useState("a_insumo"); // "a_insumo" | "a_venta"
  const [convCantidad, setConvCantidad] = useState("");
  const [guardandoConv, setGuardandoConv] = useState(false);
  const [errorConv, setErrorConv] = useState("");
  const guardandoConvRef = useRef(false);

  const { confirm, ConfirmDialog } = useConfirm();

  useEffect(() => {
    if (!productoId || authLoading) return;
    let cancelled = false;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // S4-01: costo_promedio es información de costo → solo Admin lo pide.
        // Antes viajaba al navegador para cualquier rol (el ocultamiento era
        // solo visual). Los no-Admin ya no lo reciben en la respuesta.
        const { data: prod, error: prodErr } = await supabase
          .from("productos")
          .select(
            "id, referencia, codigo_interno, codigo_proveedor, tipo, nombre, categoria, subcategoria, marca, modelo, descripcion, precio_venta, stock_minimo, stock_maximo, unidad_medida, activo, vendible, stand, posicion, en_piso" +
              (esAdmin ? ", costo_promedio" : ""),
          )
          .eq("id", productoId)
          .single();

        if (prodErr || !prod) throw new Error("Producto no encontrado");

        const { data: inv } = await supabase
          .from("inventario")
          .select(
            "id, cantidad, cantidad_insumo, estado_stock, ubicacion_id, sede:sedes(id, nombre)",
          )
          .eq("producto_id", productoId)
          .order("sede_id");

        const { data: movs } = await supabase
          .from("movimientos")
          .select(
            "id, fecha, tipo, cantidad, stock_anterior, stock_posterior, observaciones, sede_id",
          )
          .eq("producto_id", productoId)
          .order("fecha", { ascending: false })
          .limit(10);

        // Bloque D1: catálogo de ubicaciones activas para el select de
        // asignación (por sede). Tabla pequeña, se trae completa.
        const { data: ubics } = await supabase
          .from("ubicaciones")
          .select("id, sede_id, descripcion, prioridad_picking")
          .eq("activa", true)
          .order("prioridad_picking", { ascending: true, nullsFirst: false });

        // F12: historial de proveedores (último primero)
        const { data: provs } = await supabase
          .from("productos_proveedores")
          // FRONTEND-01: el último costo es información de costo → solo Admin lo recibe.
          .select(
            esAdmin
              ? "proveedor, ultima_compra_at, ultimo_costo"
              : "proveedor, ultima_compra_at",
          )
          .eq("producto_id", productoId)
          .order("ultima_compra_at", { ascending: false, nullsFirst: false });

        // Auditoría de cambios de costo/precio (solo Admin; la RLS lo restringe).
        // usuario_id no tiene FK a usuarios, así que se resuelve el nombre aparte.
        let histRows = [];
        if (esAdmin) {
          const { data: hist } = await supabase
            .from("productos_precio_costo_log")
            .select(
              "id, campo, valor_anterior, valor_nuevo, usuario_id, created_at",
            )
            .eq("producto_id", productoId)
            .order("created_at", { ascending: false })
            .limit(30);
          histRows = hist ?? [];
          const uids = [
            ...new Set(histRows.map((h) => h.usuario_id).filter(Boolean)),
          ];
          if (uids.length) {
            const { data: us } = await supabase
              .from("usuarios")
              .select("id, nombre")
              .in("id", uids);
            const nameById = Object.fromEntries(
              (us ?? []).map((u) => [u.id, usuarioDisplayName(u)]),
            );
            histRows = histRows.map((h) => ({
              ...h,
              usuario_nombre: h.usuario_id
                ? (nameById[h.usuario_id] ?? null)
                : null,
            }));
          }
        }

        // Costo sugerido del último ensamble completado (solo Admin ve costos).
        // Sirve para precargar el modal "Editar costo" cuando el promedio es 0.
        let sugerido = null;
        if (esAdmin) {
          const { data: ens } = await supabase
            .from("ensambles")
            .select("costo_total, cantidad_producida, fecha")
            .eq("producto_resultado_id", productoId)
            .eq("completado", true)
            .gt("costo_total", 0)
            .order("fecha", { ascending: false })
            .limit(1);
          const row = ens?.[0];
          if (row && Number(row.cantidad_producida) > 0) {
            sugerido = Math.round(
              Number(row.costo_total) / Number(row.cantidad_producida),
            );
          }
        }

        if (!cancelled) {
          setProducto(prod);
          setInventario(inv ?? []);
          setMovimientos(movs ?? []);
          setCostoSugerido(sugerido);
          setProveedores(provs ?? []);
          setHistorialPrecios(histRows);
          setUbicacionesActivas(ubics ?? []);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(safeError(e, "Error al cargar el producto"));
          setLoading(false);
        }
      }
    };

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [productoId, authLoading, esAdmin]);

  const abrirEditarPrecio = () => {
    if (!producto) return;
    setNuevoPrecio(String(producto.precio_venta ?? ""));
    setErrorPrecio("");
    setEditandoPrecio(true);
  };

  const guardarPrecio = async () => {
    if (!producto) return;
    setErrorPrecio("");
    const precio = Number(nuevoPrecio);
    if (!Number.isFinite(precio) || precio < 0) {
      setErrorPrecio("El precio debe ser un número mayor o igual a 0");
      return;
    }
    if (precio === Number(producto.precio_venta)) {
      setEditandoPrecio(false);
      return; // sin cambio
    }
    const ok = await confirm({
      titulo: "Confirmar cambio de precio",
      mensaje: `Se cambiará el precio de "${producto.nombre}" de ${formatCOP(
        producto.precio_venta,
      )} a ${formatCOP(precio)}. El nuevo precio aplicará a todas las cotizaciones y ventas futuras. ¿Confirmar?`,
      confirmLabel: "Sí, cambiar precio",
    });
    if (!ok) return;
    if (guardandoPrecioRef.current) return;
    guardandoPrecioRef.current = true;
    setGuardandoPrecio(true);
    try {
      const { error: rpcErr } = await supabase.rpc(
        "fn_editar_precio_producto",
        {
          p_producto_id: producto.id,
          p_precio_venta: precio,
        },
      );
      if (rpcErr) throw rpcErr;
      setProducto((p) => (p ? { ...p, precio_venta: precio } : p));
      setEditandoPrecio(false);
      avisarOk("Precio actualizado.");
    } catch (err) {
      avisarError(err, "Error al actualizar el precio");
    } finally {
      setGuardandoPrecio(false);
      guardandoPrecioRef.current = false;
    }
  };

  const abrirEditarCosto = () => {
    if (!producto) return;
    // Si el costo promedio está en 0 y hay un costo sugerido del último
    // ensamble, precargamos ese valor (el Admin solo confirma o ajusta).
    const actual = Number(producto.costo_promedio ?? 0);
    const inicial =
      actual === 0 && costoSugerido != null
        ? String(costoSugerido)
        : String(producto.costo_promedio ?? "");
    setNuevoCosto(inicial);
    setErrorCosto("");
    setEditandoCosto(true);
  };

  const guardarCosto = async () => {
    if (!producto) return;
    setErrorCosto("");
    const costo = Number(nuevoCosto);
    if (!Number.isFinite(costo) || costo < 0) {
      setErrorCosto("El costo debe ser un número mayor o igual a 0");
      return;
    }
    if (costo === Number(producto.costo_promedio)) {
      setEditandoCosto(false);
      return; // sin cambio
    }
    const ok = await confirm({
      titulo: "Confirmar cambio de costo",
      mensaje: `Se cambiará el costo promedio de "${producto.nombre}" de ${formatCOP(
        producto.costo_promedio,
      )} a ${formatCOP(
        costo,
      )}. Úsalo para ajustarlo al costo de la última compra (no afecta ventas pasadas). ¿Confirmar?`,
      confirmLabel: "Sí, cambiar costo",
    });
    if (!ok) return;
    if (guardandoCostoRef.current) return;
    guardandoCostoRef.current = true;
    setGuardandoCosto(true);
    try {
      const { error: rpcErr } = await supabase.rpc("fn_editar_costo_producto", {
        p_producto_id: producto.id,
        p_costo: costo,
      });
      if (rpcErr) throw rpcErr;
      setProducto((p) => (p ? { ...p, costo_promedio: costo } : p));
      setEditandoCosto(false);
      avisarOk("Costo actualizado.");
    } catch (err) {
      avisarError(err, "Error al actualizar el costo");
    } finally {
      setGuardandoCosto(false);
      guardandoCostoRef.current = false;
    }
  };

  const abrirConversion = (inv, dir) => {
    setConvInv(inv);
    setConvDir(dir);
    setConvCantidad("");
    setErrorConv("");
  };

  const guardarConversion = async () => {
    if (!convInv || !producto) return;
    setErrorConv("");
    const cant = Number(convCantidad);
    const max =
      convDir === "a_insumo"
        ? convInv.cantidad
        : (convInv.cantidad_insumo ?? 0);
    if (!Number.isInteger(cant) || cant <= 0) {
      setErrorConv("La cantidad debe ser un entero mayor a 0");
      return;
    }
    if (cant > max) {
      setErrorConv(`Máximo disponible: ${max}`);
      return;
    }
    if (guardandoConvRef.current) return;
    guardandoConvRef.current = true;
    setGuardandoConv(true);
    try {
      const fn =
        convDir === "a_insumo"
          ? "fn_convertir_a_insumo"
          : "fn_revertir_insumo_a_venta";
      const { error: rpcErr } = await supabase.rpc(fn, {
        p_producto_id: producto.id,
        p_sede_id: convInv.sede?.id,
        p_cantidad: cant,
      });
      if (rpcErr) throw rpcErr;
      setInventario((rows) =>
        rows.map((r) => {
          if (r.id !== convInv.id) return r;
          return convDir === "a_insumo"
            ? {
                ...r,
                cantidad: r.cantidad - cant,
                cantidad_insumo: (r.cantidad_insumo ?? 0) + cant,
              }
            : {
                ...r,
                cantidad: r.cantidad + cant,
                cantidad_insumo: (r.cantidad_insumo ?? 0) - cant,
              };
        }),
      );
      avisarOk(
        convDir === "a_insumo"
          ? "Stock convertido a insumo."
          : "Stock devuelto a venta.",
      );
      setConvInv(null);
    } catch (err) {
      avisarError(err, "Error al convertir stock");
    } finally {
      setGuardandoConv(false);
      guardandoConvRef.current = false;
    }
  };

  // Bloque D1 — asignar/quitar la ubicación física de un producto en una
  // sede. No bloquea nada más de la pantalla; feedback inline por fila.
  const asignarUbicacion = async (inv, nuevaUbicacionId) => {
    if (!producto) return;
    setGuardandoUbicacionId(inv.id);
    try {
      const { error: rpcErr } = await supabase.rpc("fn_asignar_ubicacion", {
        p_producto_id: producto.id,
        p_sede_id: inv.sede?.id,
        p_ubicacion_id: nuevaUbicacionId || null,
      });
      if (rpcErr) throw rpcErr;
      setInventario((rows) =>
        rows.map((r) =>
          r.id === inv.id
            ? { ...r, ubicacion_id: nuevaUbicacionId || null }
            : r,
        ),
      );
      avisarOk(
        nuevaUbicacionId ? "Ubicación asignada." : "Ubicación eliminada.",
      );
    } catch (err) {
      avisarError(err, "No se pudo asignar la ubicación");
    } finally {
      setGuardandoUbicacionId(null);
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onBack={() => navigate(-1)} />;
  if (!producto) return null;

  const stockTotal = inventario.reduce((sum, i) => sum + i.cantidad, 0);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      <button
        onClick={() => navigate(-1)}
        className="back-btn mb-3 inline-flex items-center gap-1.5"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver
      </button>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div
        className="flex flex-col items-start gap-4 border-b pb-4 md:flex-row md:gap-6"
        style={{ borderColor: "var(--n-150)" }}
      >
        <div className="min-w-0 flex-1">
          <div className="ph-eyebrow">Producto</div>
          <div className="ph-client">{producto.nombre}</div>
          <div className="ph-sub">
            <span className="font-mono" style={{ color: "var(--n-900)" }}>
              {[producto.codigo_interno, producto.codigo_proveedor]
                .filter(Boolean)
                .join(" · ") || producto.referencia}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <TipoProductoBadge tipo={producto.tipo} />
            {producto.categoria && <Chip>{producto.categoria}</Chip>}
            {producto.marca && <Chip variant="accent">{producto.marca}</Chip>}
            {producto.modelo && <Chip>{producto.modelo}</Chip>}
            {!producto.activo && (
              <StatusBadge status="anulada">Inactivo</StatusBadge>
            )}
            {!producto.vendible && (
              <span
                className="rounded-md px-2 py-0.5 text-xs font-semibold"
                style={{
                  backgroundColor: "var(--warn-50)",
                  color: "var(--warn-700)",
                }}
              >
                Insumo · no se vende
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <div className="flex flex-col items-start md:items-end">
            <span className="ph-total-lbl">Stock total</span>
            <span className="ph-total tabular-nums">{stockTotal}</span>
          </div>
          {esAdmin && (
            <button
              onClick={() => navigate(`/ops/inventario/${producto.id}/editar`)}
              className="rounded-lg border px-3 py-2 text-xs font-medium"
              style={{
                borderColor: "var(--n-200)",
                color: "var(--p-700)",
                backgroundColor: "var(--n-0)",
              }}
            >
              ✏️ Editar producto
            </button>
          )}
        </div>
      </div>

      {/* ── Precios ────────────────────────────────────────────────── */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Precio venta" value={formatCOP(producto.precio_venta)}>
          {esAdmin && (
            <button
              onClick={abrirEditarPrecio}
              className="mt-2 cursor-pointer text-xs font-medium"
              style={{ color: "var(--p-700)" }}
            >
              ✏️ Editar precio
            </button>
          )}
        </Stat>
        {esAdmin && (
          <Stat
            label="Costo promedio"
            value={formatCOP(producto.costo_promedio)}
          >
            <button
              onClick={abrirEditarCosto}
              className="mt-2 cursor-pointer text-xs font-medium"
              style={{ color: "var(--p-700)" }}
            >
              ✏️ Editar costo
            </button>
          </Stat>
        )}
        <Stat label="Stock mínimo" value={producto.stock_minimo} small />
        <Stat label="Stock máximo" value={producto.stock_maximo ?? "—"} small />
        {/* stand/posición es un dato físico solo de BODEGA (S4-05 ux). */}
        <Stat
          label="Ubicación (BODEGA)"
          value={ubicacionLabel(producto)}
          small
        />
      </div>

      {producto.descripcion && (
        <p
          className="mt-3 text-[13px] leading-relaxed"
          style={{ color: "var(--n-500)" }}
        >
          {producto.descripcion}
        </p>
      )}

      {/* ── Bloques ────────────────────────────────────────────────── */}
      <div className="mt-4 flex flex-col gap-3">
        {/* Stock por sede */}
        <div className="iblock">
          <div className="ib-head">
            <div className="ib-ico">
              <Store className="h-3.5 w-3.5" strokeWidth={2} />
            </div>
            <div className="ib-title">Stock por sede</div>
            <div className="ib-aux">{inventario.length} sedes</div>
          </div>
          {inventario.length === 0 ? (
            <p className="px-4 py-3 text-sm" style={{ color: "var(--n-500)" }}>
              Sin registros de inventario
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="prod-tbl">
                <tbody>
                  {inventario.map((inv) => {
                    const opcionesSede = ubicacionesActivas.filter(
                      (u) => u.sede_id === inv.sede?.id,
                    );
                    return (
                      <tr key={inv.id}>
                        <td>
                          <div className="p-nm">{inv.sede?.nombre}</div>
                          <div className="p-meta">
                            {inv.sede?.id === "BODEGA"
                              ? ubicacionLabel(producto, "Sin ubicación")
                              : null}
                          </div>
                          {puedeAsignarUbicacion ? (
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <select
                                value={inv.ubicacion_id ?? ""}
                                onChange={(e) =>
                                  asignarUbicacion(inv, e.target.value)
                                }
                                disabled={guardandoUbicacionId === inv.id}
                                className="h-8 rounded-md border bg-transparent px-1.5 text-[11.5px] outline-none disabled:opacity-60"
                                style={{ borderColor: "var(--n-200)" }}
                                aria-label={`Ubicación en ${inv.sede?.nombre ?? "sede"}`}
                              >
                                <option value="">Sin ubicación</option>
                                {opcionesSede.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.id} — {u.descripcion}
                                  </option>
                                ))}
                              </select>
                              {guardandoUbicacionId === inv.id && (
                                <span
                                  className="text-[10.5px]"
                                  style={{ color: "var(--n-500)" }}
                                >
                                  Guardando…
                                </span>
                              )}
                            </div>
                          ) : (
                            <UbicacionChip
                              codigo={inv.ubicacion_id}
                              className="mt-1.5"
                              conMapa
                            />
                          )}
                        </td>
                        <td style={{ width: 120 }}>
                          <StatusBadge status={inv.estado_stock} />
                        </td>
                        <td className="p-sub" style={{ width: 110 }}>
                          <div>Venta: {inv.cantidad}</div>
                          <div style={{ color: "var(--n-500)" }}>
                            Insumo: {inv.cantidad_insumo ?? 0}
                          </div>
                        </td>
                        {puedeConvertirInsumo && (
                          <td style={{ width: 110 }}>
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={() => abrirConversion(inv, "a_insumo")}
                                disabled={inv.cantidad <= 0}
                                className="cursor-pointer text-left text-xs font-medium disabled:cursor-default disabled:opacity-40"
                                style={{ color: "var(--p-700)" }}
                              >
                                → a insumo
                              </button>
                              {/* Revertir insumo → venta es solo Admin (S4-04). */}
                              {esAdmin && (
                                <button
                                  onClick={() =>
                                    abrirConversion(inv, "a_venta")
                                  }
                                  disabled={(inv.cantidad_insumo ?? 0) <= 0}
                                  className="cursor-pointer text-left text-xs font-medium disabled:cursor-default disabled:opacity-40"
                                  style={{ color: "var(--n-500)" }}
                                >
                                  → a venta
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Código QR */}
        <div className="iblock">
          <div className="ib-head">
            <div className="ib-ico info">
              <QrCode className="h-3.5 w-3.5" strokeWidth={2} />
            </div>
            <div className="ib-title">Código QR</div>
          </div>
          <div className="flex flex-col items-center gap-6 px-4 py-4 sm:flex-row">
            <div
              className="rounded-xl border p-4"
              style={{
                backgroundColor: "#fff",
                borderColor: "var(--n-200)",
              }}
            >
              <QRGenerator value={producto.referencia} size={160} />
            </div>
            <div className="flex flex-col items-center gap-3 sm:items-start">
              <div>
                <p
                  className="font-mono text-[10px] uppercase tracking-[0.08em]"
                  style={{ color: "var(--n-300)" }}
                >
                  Referencia
                </p>
                <p
                  className="mt-0.5 font-mono text-lg font-semibold"
                  style={{ color: "var(--n-900)" }}
                >
                  {producto.referencia}
                </p>
              </div>
              <p
                className="text-center text-xs sm:text-left"
                style={{ color: "var(--n-500)" }}
              >
                Escanea con la app para ver el detalle del producto.
              </p>
              <QRPrintLabel
                referencia={producto.referencia}
                nombre={producto.nombre}
              />
            </div>
          </div>
        </div>

        {/* Proveedores (F12) */}
        <div className="iblock">
          <div className="ib-head">
            <div className="ib-ico">
              <Tag className="h-3.5 w-3.5" strokeWidth={2} />
            </div>
            <div className="ib-title">Proveedores</div>
            {proveedores.length > 0 && (
              <div className="ib-aux">{proveedores.length}</div>
            )}
          </div>
          {proveedores.length === 0 ? (
            <p className="px-4 py-3 text-sm" style={{ color: "var(--n-500)" }}>
              Aún no hay compras registradas. Al recibir la primera compra
              quedará aquí el proveedor.
            </p>
          ) : (
            <ul>
              {proveedores.map((p, idx) => (
                <li
                  key={p.proveedor}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                  style={{
                    borderTop: idx === 0 ? "none" : "1px solid var(--n-100)",
                  }}
                >
                  <div className="min-w-0">
                    <p
                      className="flex items-center gap-2 text-sm font-semibold"
                      style={{ color: "var(--n-900)" }}
                    >
                      {idx === 0 && (
                        <span
                          className="pill pill-success"
                          style={{ height: 18 }}
                        >
                          <span className="dot" />
                          Último
                        </span>
                      )}
                      {p.proveedor}
                    </p>
                    {p.ultima_compra_at && (
                      <p className="text-xs" style={{ color: "var(--n-500)" }}>
                        Última compra: {formatDate(p.ultima_compra_at)}
                      </p>
                    )}
                  </div>
                  {esAdmin && p.ultimo_costo != null && (
                    <span
                      className="font-mono text-sm tabular-nums"
                      style={{ color: "var(--n-500)" }}
                    >
                      {formatCOP(p.ultimo_costo)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Últimos movimientos */}
        <div className="iblock">
          <div className="ib-head">
            <div className="ib-ico">
              <ClipboardList className="h-3.5 w-3.5" strokeWidth={2} />
            </div>
            <div className="ib-title">Últimos 10 movimientos</div>
            <div className="ib-aux">{movimientos.length}</div>
          </div>
          {movimientos.length === 0 ? (
            <p className="px-4 py-3 text-sm" style={{ color: "var(--n-500)" }}>
              Sin movimientos registrados
            </p>
          ) : (
            <ul>
              {movimientos.map((mov, idx) => (
                <li
                  key={mov.id}
                  className="flex items-start gap-3 px-4 py-3"
                  style={{
                    borderTop: idx === 0 ? "none" : "1px solid var(--n-100)",
                  }}
                >
                  <MovimientoIcon tipo={mov.tipo} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="text-sm font-semibold capitalize"
                        style={{ color: "var(--n-900)" }}
                      >
                        {(mov.tipo ?? "").toLowerCase().replace("_", " ")}
                      </span>
                      <span
                        className="font-mono text-sm font-bold tabular-nums"
                        style={{
                          color:
                            mov.cantidad >= 0
                              ? "var(--succ-700)"
                              : "var(--dang-700)",
                        }}
                      >
                        {mov.cantidad >= 0 ? "+" : ""}
                        {mov.cantidad}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span
                        className="font-mono text-[11px]"
                        style={{ color: "var(--n-500)" }}
                      >
                        {mov.sede_id}
                      </span>
                      <span style={{ color: "var(--n-200)" }}>·</span>
                      <span
                        className="font-mono text-[11px] tabular-nums"
                        style={{ color: "var(--n-500)" }}
                      >
                        {mov.stock_anterior} → {mov.stock_posterior}
                      </span>
                    </div>
                    {mov.observaciones && (
                      <p
                        className="mt-1 truncate text-[11px] italic"
                        style={{ color: "var(--n-500)" }}
                      >
                        {mov.observaciones}
                      </p>
                    )}
                    <p
                      className="mt-0.5 font-mono text-[10px]"
                      style={{ color: "var(--n-300)" }}
                    >
                      {formatDate(mov.fecha)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Historial de costo y precio (solo Admin) */}
        {esAdmin && (
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <History className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Historial de costo y precio</div>
              {historialPrecios.length > 0 && (
                <div className="ib-aux">{historialPrecios.length}</div>
              )}
            </div>
            {historialPrecios.length === 0 ? (
              <p
                className="px-4 py-3 text-sm"
                style={{ color: "var(--n-500)" }}
              >
                Sin cambios de costo o precio registrados.
              </p>
            ) : (
              <ul>
                {historialPrecios.map((h, idx) => (
                  <li
                    key={h.id}
                    className="flex items-start justify-between gap-3 px-4 py-3"
                    style={{
                      borderTop: idx === 0 ? "none" : "1px solid var(--n-100)",
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                          style={
                            h.campo === "precio_venta"
                              ? {
                                  backgroundColor: "var(--p-50)",
                                  color: "var(--p-700)",
                                }
                              : {
                                  backgroundColor: "var(--warn-50)",
                                  color: "var(--warn-700)",
                                }
                          }
                        >
                          {h.campo === "precio_venta" ? "Precio" : "Costo"}
                        </span>
                        <span
                          className="font-mono text-sm tabular-nums"
                          style={{ color: "var(--n-900)" }}
                        >
                          {formatCOP(h.valor_anterior ?? 0)} →{" "}
                          {formatCOP(h.valor_nuevo ?? 0)}
                        </span>
                      </div>
                      <p
                        className="mt-0.5 text-[11px]"
                        style={{ color: "var(--n-500)" }}
                      >
                        {h.usuario_nombre ?? "—"}
                      </p>
                    </div>
                    <span
                      className="shrink-0 font-mono text-[10px]"
                      style={{ color: "var(--n-300)" }}
                    >
                      {formatDate(h.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ── Modal: editar precio (solo Admin) ── */}
      {esAdmin && editandoPrecio && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => !guardandoPrecio && setEditandoPrecio(false)}
        >
          <div
            className="w-full max-w-md space-y-3 rounded-xl border p-5"
            style={{
              backgroundColor: "var(--n-0)",
              borderColor: "var(--n-200)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className="text-lg font-semibold"
              style={{ color: "var(--n-950)" }}
            >
              Editar precio de venta
            </h3>
            <p className="text-xs" style={{ color: "var(--n-500)" }}>
              <strong>{producto.nombre}</strong> · precio actual:{" "}
              {formatCOP(producto.precio_venta)}
            </p>
            {errorPrecio && (
              <div
                role="alert"
                className="rounded-lg border px-3 py-2 text-xs"
                style={{
                  backgroundColor: "var(--dang-50)",
                  borderColor: "var(--dang-200)",
                  color: "var(--dang-700)",
                }}
              >
                {errorPrecio}
              </div>
            )}
            <div>
              <label className="text-xs" style={{ color: "var(--n-500)" }}>
                Nuevo precio (COP)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={nuevoPrecio}
                onChange={(e) => setNuevoPrecio(e.target.value)}
                disabled={guardandoPrecio}
                autoFocus
                className="mt-1 min-h-[44px] w-full rounded-lg border px-3 py-2 text-sm"
                style={{
                  backgroundColor: "var(--n-0)",
                  borderColor: "var(--n-200)",
                  color: "var(--n-900)",
                }}
              />
              {Number(nuevoPrecio) > 0 && (
                <p className="mt-1 text-xs" style={{ color: "var(--n-500)" }}>
                  Vista previa: {formatCOP(Number(nuevoPrecio))}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditandoPrecio(false)}
                disabled={guardandoPrecio}
                className="min-h-[44px] rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
                style={{
                  borderColor: "var(--n-200)",
                  color: "var(--n-500)",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={guardarPrecio}
                disabled={guardandoPrecio}
                className="min-h-[44px] rounded-lg px-5 py-2 text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: "var(--p-700)", color: "#fff" }}
              >
                {guardandoPrecio ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: editar costo promedio (solo Admin) ── */}
      {esAdmin && editandoCosto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => !guardandoCosto && setEditandoCosto(false)}
        >
          <div
            className="w-full max-w-md space-y-3 rounded-xl border p-5"
            style={{
              backgroundColor: "var(--n-0)",
              borderColor: "var(--n-200)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className="text-lg font-semibold"
              style={{ color: "var(--n-950)" }}
            >
              Editar costo promedio
            </h3>
            <p className="text-xs" style={{ color: "var(--n-500)" }}>
              <strong>{producto.nombre}</strong> · costo actual:{" "}
              {formatCOP(producto.costo_promedio)}
            </p>
            <p className="text-xs" style={{ color: "var(--n-500)" }}>
              Ajústalo al costo de la última compra para no distorsionar el
              promedio. No modifica ventas ni movimientos pasados.
            </p>
            {costoSugerido != null && (
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
                style={{
                  backgroundColor: "var(--info-50, #eff6ff)",
                  borderColor: "var(--info-200, #bfdbfe)",
                  color: "var(--info-700, #1d4ed8)",
                }}
              >
                <span>
                  Costo de materiales del último ensamble:{" "}
                  <strong>{formatCOP(costoSugerido)}</strong> por unidad.
                </span>
                <button
                  type="button"
                  onClick={() => setNuevoCosto(String(costoSugerido))}
                  className="rounded-md px-2 py-1 font-medium"
                  style={{
                    backgroundColor: "var(--info-600, #2563eb)",
                    color: "#fff",
                  }}
                >
                  Usar este valor
                </button>
              </div>
            )}
            {errorCosto && (
              <div
                role="alert"
                className="rounded-lg border px-3 py-2 text-xs"
                style={{
                  backgroundColor: "var(--dang-50)",
                  borderColor: "var(--dang-200)",
                  color: "var(--dang-700)",
                }}
              >
                {errorCosto}
              </div>
            )}
            <div>
              <label className="text-xs" style={{ color: "var(--n-500)" }}>
                Nuevo costo (COP)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={nuevoCosto}
                onChange={(e) => setNuevoCosto(e.target.value)}
                disabled={guardandoCosto}
                autoFocus
                className="mt-1 min-h-[44px] w-full rounded-lg border px-3 py-2 text-sm"
                style={{
                  backgroundColor: "var(--n-0)",
                  borderColor: "var(--n-200)",
                  color: "var(--n-900)",
                }}
              />
              {Number(nuevoCosto) > 0 && (
                <p className="mt-1 text-xs" style={{ color: "var(--n-500)" }}>
                  Vista previa: {formatCOP(Number(nuevoCosto))}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditandoCosto(false)}
                disabled={guardandoCosto}
                className="min-h-[44px] rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
                style={{
                  borderColor: "var(--n-200)",
                  color: "var(--n-500)",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={guardarCosto}
                disabled={guardandoCosto}
                className="min-h-[44px] rounded-lg px-5 py-2 text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: "var(--p-700)", color: "#fff" }}
              >
                {guardandoCosto ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: convertir stock venta <-> insumo ──
          '→ a insumo' lo pueden usar 4 roles; '→ a venta' solo Admin (S4-04).
          El botón que abre cada dirección ya está gateado por rol arriba. */}
      {puedeConvertirInsumo && convInv && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => !guardandoConv && setConvInv(null)}
        >
          <div
            className="w-full max-w-md space-y-3 rounded-xl border p-5"
            style={{
              backgroundColor: "var(--n-0)",
              borderColor: "var(--n-200)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className="text-lg font-semibold"
              style={{ color: "var(--n-950)" }}
            >
              {convDir === "a_insumo"
                ? "Convertir venta → insumo"
                : "Devolver insumo → venta"}
            </h3>
            <p className="text-xs" style={{ color: "var(--n-500)" }}>
              <strong>{producto.nombre}</strong> · {convInv.sede?.nombre} ·
              venta: {convInv.cantidad} / insumo: {convInv.cantidad_insumo ?? 0}
            </p>
            {errorConv && (
              <div
                role="alert"
                className="rounded-lg border px-3 py-2 text-xs"
                style={{
                  backgroundColor: "var(--dang-50)",
                  borderColor: "var(--dang-200)",
                  color: "var(--dang-700)",
                }}
              >
                {errorConv}
              </div>
            )}
            <div>
              <label className="text-xs" style={{ color: "var(--n-500)" }}>
                Cantidad a {convDir === "a_insumo" ? "convertir" : "devolver"}{" "}
                (máx.{" "}
                {convDir === "a_insumo"
                  ? convInv.cantidad
                  : (convInv.cantidad_insumo ?? 0)}
                )
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={convCantidad}
                onChange={(e) => setConvCantidad(e.target.value)}
                disabled={guardandoConv}
                autoFocus
                className="mt-1 min-h-[44px] w-full rounded-lg border px-3 py-2 text-sm"
                style={{
                  backgroundColor: "var(--n-0)",
                  borderColor: "var(--n-200)",
                  color: "var(--n-900)",
                }}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setConvInv(null)}
                disabled={guardandoConv}
                className="min-h-[44px] rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
                style={{ borderColor: "var(--n-200)", color: "var(--n-500)" }}
              >
                Cancelar
              </button>
              <button
                onClick={guardarConversion}
                disabled={guardandoConv}
                className="min-h-[44px] rounded-lg px-5 py-2 text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: "var(--p-700)", color: "#fff" }}
              >
                {guardandoConv ? "Guardando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog />
    </div>
  );
}

/* ── Helpers ── */

function Stat({ label, value, small, children }) {
  return (
    <div
      className="rounded-[10px] border px-4 py-3.5"
      style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
    >
      <p
        className="font-mono text-[10px] uppercase tracking-[0.08em]"
        style={{ color: "var(--n-300)" }}
      >
        {label}
      </p>
      <p
        className={`mt-0.5 font-bold tabular-nums ${small ? "text-sm" : "text-base"}`}
        style={{ color: "var(--n-950)" }}
      >
        {value}
      </p>
      {children}
    </div>
  );
}

function Chip({ children, variant = "default" }) {
  const styles =
    variant === "accent"
      ? {
          backgroundColor: "var(--p-50)",
          color: "var(--p-700)",
          borderColor: "var(--p-200)",
        }
      : {
          backgroundColor: "var(--n-50)",
          color: "var(--n-700)",
          borderColor: "var(--n-200)",
        };
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[10px] font-medium"
      style={styles}
    >
      {children}
    </span>
  );
}

function MovimientoIcon({ tipo }) {
  const colores = {
    COMPRA: { bg: "var(--succ-50)", color: "var(--succ-700)", symbol: "↓" },
    VENTA: { bg: "var(--dang-50)", color: "var(--dang-700)", symbol: "↑" },
    TRASPASO: { bg: "var(--info-50)", color: "var(--info-700)", symbol: "⇄" },
    AJUSTE: { bg: "var(--warn-50)", color: "var(--warn-700)", symbol: "≈" },
    DEVOLUCION: { bg: "var(--p-50)", color: "var(--p-700)", symbol: "↩" },
    ENSAMBLE: { bg: "var(--info-50)", color: "var(--info-700)", symbol: "⚙" },
    default: { bg: "var(--n-100)", color: "var(--n-500)", symbol: "•" },
  };
  const cfg = colores[tipo] ?? colores.default;
  return (
    <div
      className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}
    >
      {cfg.symbol}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-5 sm:px-7 sm:py-6 animate-pulse">
      <div
        className="h-8 w-1/2 rounded-lg"
        style={{ backgroundColor: "var(--n-100)" }}
      />
      <div
        className="mt-4 h-40 rounded-[10px] border"
        style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
      />
      <div
        className="mt-3 h-32 rounded-[10px] border"
        style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
      />
      <div
        className="mt-3 h-56 rounded-[10px] border"
        style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
      />
    </div>
  );
}

function ErrorState({ message, onBack }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-8 text-center">
      <div
        className="hrm-tool-ico xl mb-4"
        style={{ width: 64, height: 64 }}
        aria-hidden
      >
        <Package className="h-7 w-7" strokeWidth={1.5} />
      </div>
      <p className="font-bold" style={{ color: "var(--n-950)" }}>
        No se pudo cargar el producto
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--n-500)" }}>
        {message}
      </p>
      <button
        onClick={onBack}
        className="btn btn-pri mt-6 justify-center"
        style={{ height: 48 }}
      >
        Volver
      </button>
    </div>
  );
}
