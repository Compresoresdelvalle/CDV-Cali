import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftCircle } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../stores/authStore";
import { avisarOk, avisarError } from "../../lib/notify";
import ProductoForm from "../../components/forms/ProductoForm";

/**
 * Página de creación de producto (Fase 12 · re-vestido Lovable F4c).
 *
 * Llama a la RPC `fn_crear_producto` que valida rol Admin/Bodeguero,
 * crea el producto e inserta filas de inventario en todas las sedes
 * activas con cantidad 0.
 */
export default function ProductoNuevo() {
  const navigate = useNavigate();
  const esAdmin = useAuthStore((s) => s.perfil?.rol) === "Admin";
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (payload) => {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("fn_crear_producto", {
        p_payload: payload,
      });
      if (error) throw error;
      avisarOk("Producto creado.");
      navigate(`/ops/inventario/${data}`);
    } catch (err) {
      avisarError(err, "Error al crear producto");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[860px] px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      <button
        onClick={() => navigate("/ops/inventario")}
        className="back-btn mb-3 inline-flex items-center gap-1.5"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver a Inventario
      </button>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ color: "var(--n-300)" }}
          >
            Operaciones · Catálogo
          </p>
          <h1
            className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.018em]"
            style={{ color: "var(--n-950)" }}
          >
            Nuevo producto
          </h1>
          <p className="mt-1.5 text-[13px]" style={{ color: "var(--n-500)" }}>
            Crear ítem en el catálogo. Stock inicial: 0 en todas las sedes.
          </p>
        </div>
        <button
          onClick={() => navigate("/ops/inventario")}
          className="btn btn-out"
          style={{ height: 48 }}
        >
          Cancelar
        </button>
      </div>

      <div className="mt-[18px]">
        <ProductoForm
          onSubmit={onSubmit}
          onCancel={() => navigate("/ops/inventario")}
          submitting={submitting}
          submitLabel="Crear producto"
          puedeEditarCosto={esAdmin}
        />
      </div>
    </div>
  );
}
