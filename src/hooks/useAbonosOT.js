import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { safeError } from "../lib/utils";
import { rangoBogota } from "../lib/filtros";
import { resumenAbonos } from "../lib/abonos-ot";

/**
 * Abonos de OT entre dos días de calendario de Bogotá ('YYYY-MM-DD'), solo
 * lectura. `sedeId` filtra por la sede de la OT (la misma que usa el cierre);
 * null = todas. `refresco` es un contador: subirlo vuelve a consultar (el
 * botón "Actualizar" del cierre).
 *
 * El rango se manda como instantes con offset -05:00 sobre `abonos.fecha`, sin
 * castear la columna: así el día es el de Colombia y no el de UTC.
 */
export function useAbonosOT({
  desdeDia,
  hastaDia,
  sedeId = null,
  refresco = 0,
}) {
  // El resultado se guarda con la clave de la consulta que lo produjo; "está
  // cargando" es simplemente que la clave guardada no es la que se pide. Así no
  // hay que tocar el estado de forma síncrona dentro del efecto.
  const clave =
    desdeDia && hastaDia
      ? `${desdeDia}|${hastaDia}|${sedeId ?? ""}|${refresco}`
      : "";
  const [estado, setEstado] = useState({ clave: "", error: "", resumen: null });

  useEffect(() => {
    if (!clave) return undefined;
    let activo = true;
    (async () => {
      const rango = rangoBogota(desdeDia, hastaDia);
      // Se arma completo antes de ejecutar: un `await` sobre un builder a medio
      // armar lo dispara y rompe el encadenamiento.
      let q = supabase
        .from("abonos")
        .select(
          "id, fecha, monto, metodo_pago, cuenta_bancaria, orden_id, orden:orden_id!inner(numero, cliente_nombre, sede_id, estado), registrador:registrado_por(nombre)",
        )
        .gte("fecha", rango.desde)
        .lte("fecha", rango.hasta)
        .order("fecha", { ascending: true });
      if (sedeId) q = q.eq("orden.sede_id", sedeId);
      const { data, error } = await q;
      if (!activo) return;
      if (error) {
        setEstado({
          clave,
          resumen: null,
          error: safeError(
            error,
            "No se pudieron cargar los abonos de OT. Revisa la conexión y vuelve a intentar.",
          ),
        });
        return;
      }
      setEstado({ clave, error: "", resumen: resumenAbonos(data ?? []) });
    })();
    return () => {
      activo = false;
    };
  }, [clave, desdeDia, hastaDia, sedeId]);

  if (!clave) return { cargando: false, error: "", resumen: null };
  const vigente = estado.clave === clave;
  return {
    cargando: !vigente,
    error: vigente ? estado.error : "",
    resumen: vigente ? estado.resumen : null,
  };
}
