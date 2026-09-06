import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../stores/authStore";
import { safeError } from "../../lib/utils";
import BarraRango from "../../components/panel/BarraRango";
import Seccion from "../../components/panel/Seccion";
import Cascada from "../../components/panel/Cascada";
import Perdidas from "../../components/panel/Perdidas";
import PanelDetalle from "../../components/panel/PanelDetalle";
import { rangoDeAtajo, etiquetaRango } from "../../lib/panel-rango";

const CLAVE_RANGO = "cdv.panel.rango";

/**
 * Panel de decisiones.
 *
 * A diferencia del Dashboard —que responde "qué necesita atención hoy"— este
 * responde "cómo va el negocio". El rango manda sobre todas las secciones: es
 * la diferencia principal contra el panel viejo, donde el selector de periodo
 * solo cambiaba una tarjeta porque las RPC no recibían ni un parámetro.
 *
 * Cada sección pide sus datos por su cuenta: si una RPC falla, las demás siguen
 * mostrando. El panel viejo tenía una sola RPC que al fallar se llevaba por
 * delante todas las secciones avanzadas a la vez, y en silencio.
 */
export default function Panel() {
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";

  // El rango elegido sobrevive entre visitas: volver y tener que reponerlo cada
  // vez es de las cosas que más cansan de un panel.
  const [{ rango, atajo }, setSeleccion] = useState(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem(CLAVE_RANGO) ?? "null");
      if (guardado?.rango?.desde && guardado?.rango?.hasta) return guardado;
    } catch {
      /* si no se puede leer (modo privado, dato viejo), se arranca en este mes */
    }
    return { rango: rangoDeAtajo("mes"), atajo: "mes" };
  });

  const [sede, setSede] = useState("");
  const [sedes, setSedes] = useState([]);
  // Se sella al montar para que el "hace X" tenga contra qué medir desde el
  // primer render, sin un efecto que encadene un render de más.
  const [actualizado, setActualizado] = useState(() => new Date());
  const [recarga, setRecarga] = useState(0);

  // Cada sección guarda PARA QUÉ filtros trae lo que trae. Así "cargando" se
  // deriva comparando contra los filtros actuales, en vez de setearlo dentro
  // del efecto —que encadena un render de más en cada cambio de rango.
  const clave = `${rango.desde}|${rango.hasta}|${sede}|${recarga}`;
  const [resultado, setResultado] = useState({ clave: null });
  const [perdidas, setPerdidas] = useState({ clave: null });
  const [detalle, setDetalle] = useState(null);

  useEffect(() => {
    let vivo = true;
    supabase
      .from("sedes")
      .select("id, nombre")
      .eq("activa", true)
      .order("nombre")
      .then(({ data }) => {
        if (vivo) setSedes(data ?? []);
      });
    return () => {
      vivo = false;
    };
  }, []);

  // Cada sección con su propio efecto: así una que falle no arrastra a la otra.
  useEffect(() => {
    if (!esAdmin) return;
    let vivo = true;
    supabase
      .rpc("fn_panel_resultado", {
        p_desde: rango.desde,
        p_hasta: rango.hasta,
        p_sede: sede || null,
      })
      .then(({ data, error }) => {
        if (!vivo) return;
        setResultado(
          error
            ? {
                clave,
                error: safeError(error, "No se pudo calcular el resultado"),
              }
            : { clave, datos: data },
        );
        setActualizado(new Date());
      });
    return () => {
      vivo = false;
    };
  }, [esAdmin, rango.desde, rango.hasta, sede, recarga, clave]);

  useEffect(() => {
    if (!esAdmin) return;
    let vivo = true;
    supabase
      .rpc("fn_panel_perdidas", {
        p_desde: rango.desde,
        p_hasta: rango.hasta,
        p_sede: sede || null,
      })
      .then(({ data, error }) => {
        if (!vivo) return;
        setPerdidas(
          error
            ? {
                clave,
                error: safeError(error, "No se pudieron cargar las pérdidas"),
              }
            : { clave, datos: data },
        );
      });
    return () => {
      vivo = false;
    };
  }, [esAdmin, rango.desde, rango.hasta, sede, recarga, clave]);

  const cambiarRango = useCallback((nuevo, id) => {
    const sel = { rango: nuevo, atajo: id };
    setSeleccion(sel);
    try {
      localStorage.setItem(CLAVE_RANGO, JSON.stringify(sel));
    } catch {
      /* modo privado: se pierde el recuerdo, no pasa nada más */
    }
  }, []);

  // NO hay auto-refresco cada 60 s: en un panel con rango histórico no tiene
  // sentido, y era justo lo que hacía parecer inútil el botón del panel viejo
  // (los números no cambiaban porque acababan de refrescarse solos).
  const refrescar = useCallback(() => setRecarga((r) => r + 1), []);

  const abrirDetalle = useCallback(
    (concepto, titulo) => {
      setDetalle({ concepto, titulo, cargando: true, filas: [] });
      supabase
        .rpc("fn_panel_perdidas_detalle", {
          p_concepto: concepto,
          p_desde: rango.desde,
          p_hasta: rango.hasta,
          p_sede: sede || null,
        })
        .then(({ data, error }) =>
          setDetalle((d) =>
            // Si mientras cargaba se abrió otro concepto, no se pisa.
            d?.concepto !== concepto
              ? d
              : {
                  ...d,
                  cargando: false,
                  filas: data ?? [],
                  error: error
                    ? safeError(error, "No se pudo cargar el detalle")
                    : null,
                },
          ),
        );
    },
    [rango.desde, rango.hasta, sede],
  );

  // Está cargando mientras lo que hay en pantalla no corresponda a los
  // filtros de ahora.
  const cargaResultado = resultado.clave !== clave;
  const cargaPerdidas = perdidas.clave !== clave;
  const cargando = cargaResultado || cargaPerdidas;

  return (
    <div
      className="animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <BarraRango
        rango={rango}
        atajo={atajo}
        onCambio={cambiarRango}
        sede={sede}
        sedes={sedes}
        onSede={setSede}
        actualizado={actualizado}
        cargando={cargando}
        onRefrescar={refrescar}
      />

      <div className="space-y-4 p-4 sm:p-6">
        <Seccion
          titulo="Resultado del periodo"
          sinPermiso={!esAdmin}
          cargando={cargaResultado}
          error={resultado.error}
          onReintentar={refrescar}
          filasEsqueleto={5}
        >
          {resultado.datos && <Cascada datos={resultado.datos} />}
        </Seccion>

        <Seccion
          titulo="En qué se pierde"
          sinPermiso={!esAdmin}
          cargando={cargaPerdidas}
          error={perdidas.error}
          onReintentar={refrescar}
          filasEsqueleto={6}
        >
          {perdidas.datos && (
            <Perdidas datos={perdidas.datos} onAbrir={abrirDetalle} />
          )}
        </Seccion>

        <Seccion
          titulo="Cómo se compone la venta"
          vacio
          mensajeVacio="Se construye en la fase D."
        />
      </div>

      <PanelDetalle
        abierto={Boolean(detalle)}
        titulo={detalle?.titulo ?? ""}
        subtitulo={etiquetaRango(rango)}
        filas={detalle?.filas ?? []}
        cargando={detalle?.cargando}
        error={detalle?.error}
        onCerrar={() => setDetalle(null)}
      />
    </div>
  );
}
