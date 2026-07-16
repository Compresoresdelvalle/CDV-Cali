import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeftCircle } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { safeError, formatCOP } from "../../lib/utils";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import ProductoForm from "../../components/forms/ProductoForm";

/**
 * Editar un producto existente (solo Admin — protegido por ruta + RLS prod_modify).
 * Reutiliza ProductoForm con `initial`. Permite editar vendible, ensamblable,
 * stand/posición y demás campos que antes solo se podían fijar al crear.
 */
export default function ProductoEditar() {
  const { productoId } = useParams();
  const navigate = useNavigate();
  const [producto, setProducto] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const { confirm, ConfirmDialog } = useConfirm();

  useEffect(() => {
    let alive = true;
    supabase
      .from("productos")
      .select("*")
      .eq("id", productoId)
      .single()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error)
          setErrorMsg(safeError(error, "No se pudo cargar el producto"));
        else setProducto(data);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [productoId]);

  const onSubmit = async (payload) => {
    // INV-04/07 (ux): este form completo puede cambiar el precio con un UPDATE
    // directo, sin el modal que sí exige el flujo dedicado "Editar precio".
    // Pedimos la misma confirmación cuando el precio realmente cambió.
    const precioViejo = Number(producto.precio_venta ?? 0);
    const precioNuevo = Number(payload.precio_venta ?? 0);
    if (precioNuevo !== precioViejo) {
      const ok = await confirm({
        titulo: "Cambiar precio de venta",
        mensaje: `El precio pasará de ${formatCOP(precioViejo)} a ${formatCOP(
          precioNuevo,
        )}. Aplicará a cotizaciones y ventas futuras. ¿Confirmar?`,
        confirmLabel: "Guardar cambios",
      });
      if (!ok) return;
    }
    setSubmitting(true);
    setErrorMsg("");
    try {
      // `proveedor_inicial` no es columna de productos (solo aplica al crear).
      const { proveedor_inicial: _omit, ...campos } = payload;
      void _omit;
      const { error } = await supabase
        .from("productos")
        .update(campos)
        .eq("id", productoId);
      if (error) throw error;
      navigate(`/ops/inventario/${productoId}`);
    } catch (err) {
      setErrorMsg(safeError(err, "Error al guardar los cambios"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading)
    return (
      <p className="p-6 text-sm" style={{ color: "var(--n-500)" }}>
        Cargando…
      </p>
    );
  if (!producto)
    return (
      <p className="p-6 text-sm" style={{ color: "var(--dang-700)" }}>
        {errorMsg || "Producto no encontrado"}
      </p>
    );

  return (
    <div className="mx-auto w-full max-w-[820px] px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      <button
        onClick={() => navigate(`/ops/inventario/${productoId}`)}
        className="back-btn mb-3 inline-flex items-center gap-1.5"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver al producto
      </button>
      <h1 className="ph-client mb-4" style={{ marginBottom: 16 }}>
        Editar producto
      </h1>
      <ProductoForm
        initial={producto}
        onSubmit={onSubmit}
        onCancel={() => navigate(`/ops/inventario/${productoId}`)}
        submitLabel="Guardar cambios"
        submitting={submitting}
        errorMsg={errorMsg}
      />
      <ConfirmDialog />
    </div>
  );
}
