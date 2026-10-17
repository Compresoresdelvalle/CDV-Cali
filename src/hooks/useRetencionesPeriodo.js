import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { safeError } from "../lib/utils";
import { rangoBogota } from "../lib/filtros";
import { normalizarDoc } from "../lib/retenciones-informe";

const RET_COLS =
  "retefuente_pct, reteica_pct, reteiva_pct, retefuente_valor, reteica_valor, reteiva_valor, retenciones_total";

/**
 * Documentos CON retención entre dos días de Bogotá ('YYYY-MM-DD'), solo
 * lectura. Mismos filtros que el cierre: ventas directas no anuladas, OT
 * entregadas (por `fecha_entrega`) y compras no canceladas. `sedeId` null =
 * todas las que la RLS deje ver.
 *
 * El cierre (`fn_preview_cierre`) no devuelve las retenciones, por eso se
 * consultan aparte: esto SOLO se muestra, no cambia ningún total.
 *
 * @returns {{cargando:boolean, error:string, nosRetuvieron:object[]|null, retuvimos:object[]|null}}
 */
export function useRetencionesPeriodo({
  desdeDia,
  hastaDia,
  sedeId = null,
  refresco = 0,
}) {
  // Mismo patrón que useAbonosOT: el resultado lleva la clave de su consulta.
  const clave =
    desdeDia && hastaDia
      ? `${desdeDia}|${hastaDia}|${sedeId ?? ""}|${refresco}`
      : "";
  const [estado, setEstado] = useState({
    clave: "",
    error: "",
    nosRetuvieron: null,
    retuvimos: null,
  });

  useEffect(() => {
    if (!clave) return undefined;
    let activo = true;
    (async () => {
      const r = rangoBogota(desdeDia, hastaDia);

      let qVentas = supabase
        .from("ventas")
        .select(
          `id, numero, fecha, cliente_nombre, sede_id, total, subtotal, descuento_valor, descuento_pct, iva_pct, ${RET_COLS}`,
        )
        .eq("anulada", false)
        .eq("origen", "directa")
        .gt("retenciones_total", 0)
        .gte("fecha", r.desde)
        .lte("fecha", r.hasta);
      let qOT = supabase
        .from("ordenes_servicio")
        .select(
          `id, numero, fecha_entrega, cliente_nombre, sede_id, total, estado_autorizacion, costo_mano_obra, valor_repuestos, valor_revision, descuento_valor, iva_pct, ${RET_COLS}`,
        )
        .eq("estado", "entregada")
        .gt("retenciones_total", 0)
        .gte("fecha_entrega", r.desde)
        .lte("fecha_entrega", r.hasta);
      let qCompras = supabase
        .from("compras")
        .select(
          `id, numero, fecha, proveedor, sede_destino_id, total, subtotal, descuento_valor, iva, ${RET_COLS}`,
        )
        .neq("estado", "cancelada")
        .gt("retenciones_total", 0)
        .gte("fecha", r.desde)
        .lte("fecha", r.hasta);
      if (sedeId) {
        qVentas = qVentas.eq("sede_id", sedeId);
        qOT = qOT.eq("sede_id", sedeId);
        qCompras = qCompras.eq("sede_destino_id", sedeId);
      }

      const [v, o, c] = await Promise.all([qVentas, qOT, qCompras]);
      if (!activo) return;
      const err = v.error || o.error || c.error;
      if (err) {
        setEstado({
          clave,
          nosRetuvieron: null,
          retuvimos: null,
          error: safeError(
            err,
            "No se pudieron cargar las retenciones del periodo. Los totales del cierre no cambian; vuelve a intentar.",
          ),
        });
        return;
      }
      const porFecha = (a, b) => String(a.fecha).localeCompare(String(b.fecha));
      setEstado({
        clave,
        error: "",
        nosRetuvieron: [
          ...(v.data ?? []).map((x) => normalizarDoc(x, "venta")),
          ...(o.data ?? []).map((x) => normalizarDoc(x, "ot")),
        ].sort(porFecha),
        retuvimos: (c.data ?? [])
          .map((x) => normalizarDoc(x, "compra"))
          .sort(porFecha),
      });
    })();
    return () => {
      activo = false;
    };
  }, [clave, desdeDia, hastaDia, sedeId]);

  const vigente = clave && estado.clave === clave;
  return {
    cargando: Boolean(clave) && !vigente,
    error: vigente ? estado.error : "",
    nosRetuvieron: vigente ? estado.nosRetuvieron : null,
    retuvimos: vigente ? estado.retuvimos : null,
  };
}
