import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import ProductoForm from "../../components/forms/ProductoForm";

/**
 * Página de creación de producto (Fase 12).
 *
 * Reemplaza el `<Placeholder name="Nuevo Producto" />` que existía desde
 * Fase 3. Llama a la RPC `fn_crear_producto` que valida rol Admin/Bodeguero,
 * crea el producto e inserta filas de inventario en todas las sedes
 * activas con cantidad 0.
 */
export default function ProductoNuevo() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const onSubmit = async (payload) => {
    setSubmitting(true);
    setErrorMsg("");
    try {
      const { data, error } = await supabase.rpc("fn_crear_producto", {
        p_payload: payload,
      });
      if (error) throw error;
      navigate(`/ops/inventario/${data}`);
    } catch (err) {
      setErrorMsg(safeError(err, "Error al crear producto"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Nuevo producto"
        description="Crear ítem en el catálogo. Stock inicial: 0 en todas las sedes."
        actions={
          <button
            onClick={() => navigate("/ops/inventario")}
            className="h-9 px-3 rounded-lg border text-sm font-medium cursor-pointer"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
              backgroundColor: "hsl(var(--card))",
            }}
          >
            ← Volver
          </button>
        }
      />
      <ProductoForm
        onSubmit={onSubmit}
        onCancel={() => navigate("/ops/inventario")}
        submitting={submitting}
        errorMsg={errorMsg}
        submitLabel="Crear producto"
      />
    </div>
  );
}
