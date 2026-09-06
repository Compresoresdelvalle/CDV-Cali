import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../stores/authStore";
import BarraRango from "../../components/panel/BarraRango";
import Seccion from "../../components/panel/Seccion";
import { rangoDeAtajo } from "../../lib/panel-rango";

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
 * mostrando.
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
  // Se sella al montar para que el 'hace X' tenga contra qué medir desde el
  // primer render, sin un efecto que encadene un render de más.
  const [actualizado, setActualizado] = useState(() => new Date());
  const [cargando, setCargando] = useState(false);
  // Sube en cada "Actualizar". Las secciones de las fases siguientes lo llevan
  // en sus dependencias para volver a pedir; en la fase A todavía no hay
  // ninguna que lo escuche, y el contrato ya queda fijo.
  const [recarga, setRecarga] = useState(0);

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
  //
  // En la fase A no hay secciones que carguen, así que el ciclo es instantáneo.
  // En la fase C se reemplaza por una cuenta de secciones pendientes.
  const refrescar = useCallback(() => {
    setCargando(true);
    setRecarga((r) => r + 1);
    setActualizado(new Date());
    setCargando(false);
  }, []);

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
          vacio={esAdmin}
          mensajeVacio="Se construye en la fase C."
        />
        <Seccion
          titulo="En qué se pierde"
          sinPermiso={!esAdmin}
          vacio={esAdmin}
          mensajeVacio="Se construye en la fase C."
        />
        <Seccion
          titulo="Cómo se compone la venta"
          vacio
          mensajeVacio="Se construye en la fase D."
        />
      </div>

      {/* `recarga` lo consumen las secciones desde la fase C: va en su lista de
          dependencias para que "Actualizar" las vuelva a pedir. */}
      <span hidden data-recarga={recarga} />
    </div>
  );
}
