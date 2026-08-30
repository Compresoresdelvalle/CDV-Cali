import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftCircle, Search, Wand2, Check } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { sanitizeSearch, safeError } from "../../lib/utils";
import { avisarOk, avisarError } from "../../lib/notify";
import { useAuthStore } from "../../stores/authStore";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import StatusBadge from "../../components/ui/StatusBadge";
import NumeroInput from "../../components/forms/NumeroInput";

const PAGE_SIZE = 50;
// Tope del RPC: cada ítem escribe bitácora y recalcula el estado. Se guarda por
// tandas para que un "seleccionar todo" no deje la petición colgada.
const TANDA = 200;

const FILTROS = [
  { id: "todos", label: "Todos" },
  { id: "sin_config", label: "Sin configurar" },
  { id: "configurados", label: "Configurados" },
  { id: "alerta", label: "En alerta" },
];

/**
 * Mínimos y máximos por sede, en lote.
 *
 * Sin esta pantalla la funcionalidad nace muerta: configurar a mano producto por
 * producto en la ficha es inviable para un catálogo de 2.000 referencias.
 *
 * Vive en `/ops` y no en `/admin` a propósito: el panel Admin es sólo de
 * Maritza, y quien más necesita ajustar los mínimos de su sede son las
 * vendedoras. Cada quien ve y edita su sede; Admin puede elegir cualquiera.
 */
export default function Minimos() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";

  const [sedes, setSedes] = useState([]);
  const [sede, setSede] = useState(perfil?.sede_id ?? "");
  const [filas, setFilas] = useState([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [progreso, setProgreso] = useState(null);
  // Ediciones pendientes: producto_id -> { min, max }. No se guarda al teclear.
  const [borrador, setBorrador] = useState(() => new Map());
  // Sugerencias del asistente por producto, para el botón "usar el sugerido".
  const [sugeridos, setSugeridos] = useState(() => new Map());
  const [cargandoSug, setCargandoSug] = useState(false);

  const mountedRef = useRef(true);
  const reqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    supabase
      .from("sedes")
      .select("id, nombre")
      .eq("activa", true)
      .order("nombre")
      .then(({ data, error }) => {
        if (!mountedRef.current) return;
        if (error) {
          setErrorMsg(safeError(error, "No se pudieron cargar las sedes"));
          return;
        }
        setSedes(data ?? []);
        // Sin sede en el perfil (caso raro), Admin arranca en la primera.
        if (!perfil?.sede_id && esAdmin && data?.length) setSede(data[0].id);
      });
  }, [perfil?.sede_id, esAdmin]);

  // La sede es la del usuario y punto, salvo Admin. El servidor lo valida
  // igual, pero aquí ni siquiera se ofrece cambiarla.
  const sedeEfectiva = esAdmin ? sede : (perfil?.sede_id ?? "");

  const cargar = useCallback(async () => {
    if (!sedeEfectiva) {
      // Un usuario sin sede asignada existe: el propio RPC lo contempla. Sin
      // esto la pantalla se quedaba en "Cargando…" para siempre, sin decir por qué.
      setLoading(false);
      setErrorMsg(
        "Tu usuario no tiene sede asignada, así que no hay mínimos que mostrar. Pídele a Maritza que la configure.",
      );
      return;
    }
    const req = ++reqRef.current;
    setLoading(true);
    setErrorMsg("");
    try {
      // Paginado y filtrado en el servidor: una sede tiene ~1.400 filas de
      // inventario y traerlas todas al cliente sería tirar memoria del celular.
      let q = supabase
        .from("inventario")
        .select(
          `id, producto_id, sede_id, cantidad, cantidad_insumo, estado_stock,
           stock_minimo, stock_maximo,
           producto:productos!inner(id, referencia, nombre, categoria, vendible, activo)`,
          { count: "exact" },
        )
        .eq("sede_id", sedeEfectiva)
        .eq("producto.activo", true);

      if (filtro === "sin_config") q = q.eq("stock_minimo", 0);
      else if (filtro === "configurados") q = q.gt("stock_minimo", 0);
      else if (filtro === "alerta")
        q = q.in("estado_stock", ["Bajo", "Agotado"]).gt("stock_minimo", 0);

      const needle = sanitizeSearch(busqueda.trim());
      if (needle) {
        // El texto se busca sobre el producto embebido, con `!inner` arriba
        // para que el filtro no se ignore en silencio.
        q = q.or(`referencia.ilike.%${needle}%,nombre.ilike.%${needle}%`, {
          referencedTable: "producto",
        });
      }

      const desde = pagina * PAGE_SIZE;
      const { data, error, count } = await q
        .order("producto_id", { ascending: true })
        .range(desde, desde + PAGE_SIZE - 1);

      if (!mountedRef.current || req !== reqRef.current) return;
      if (error) throw error;
      setFilas(data ?? []);
      setTotal(count ?? 0);
    } catch (err) {
      if (!mountedRef.current || req !== reqRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar los mínimos"));
    } finally {
      if (mountedRef.current && req === reqRef.current) setLoading(false);
    }
  }, [sedeEfectiva, filtro, busqueda, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const buscarDebounced = useDebouncedCallback((v) => {
    setPagina(0);
    setBusqueda(v);
  }, 400);

  /** Trae los sugeridos del asistente para esta sede. */
  const traerSugeridos = async () => {
    if (!sedeEfectiva || cargandoSug) return;
    // Se recuerda para qué sede se pidió: el RPC recorre 90 días de movimientos
    // y tarda. Si entretanto se cambia de sede, la respuesta vieja pintaría los
    // sugeridos de una sede sobre los productos de otra, y "usar el sugerido"
    // los escribiría sin avisar.
    const sedePedida = sedeEfectiva;
    setCargandoSug(true);
    try {
      const { data, error } = await supabase.rpc("fn_sugerir_minmax", {
        p_dias: 90,
        p_sede_id: sedeEfectiva,
      });
      // `throw error` y no `new Error(error.message)`: safeError solo muestra el
      // motivo real cuando conserva el code P0001 del RAISE EXCEPTION.
      if (error) throw error;
      if (!mountedRef.current || sedePedida !== sedeEfectiva) return;
      const m = new Map();
      (data ?? []).forEach((s) =>
        m.set(s.producto_id, { min: s.min_sugerido, max: s.max_sugerido }),
      );
      setSugeridos(m);
      avisarOk(
        m.size === 0
          ? "No hay movimiento en 90 días para sugerir mínimos en esta sede."
          : `${m.size} sugerencias calculadas para esta sede.`,
      );
    } catch (err) {
      avisarError(err, "No se pudieron calcular las sugerencias");
    } finally {
      if (mountedRef.current) setCargandoSug(false);
    }
  };

  const valorDe = (f, campo) => {
    const b = borrador.get(f.producto_id);
    if (b) return b[campo];
    return campo === "min" ? (f.stock_minimo ?? 0) : (f.stock_maximo ?? 0);
  };

  // Cada entrada del borrador guarda TAMBIÉN los valores originales de la fila.
  // Sin eso, `pendientes` tendría que cruzar contra `filas` —que es sólo la
  // página visible— y las ediciones hechas en la página 1 desaparecerían al
  // pasar a la 2: la barra diría "0 cambios" y el trabajo se perdería sin aviso.
  const anotar = (prev, f, valores) => {
    const next = new Map(prev);
    const actual = next.get(f.producto_id);
    next.set(f.producto_id, {
      min: actual?.min ?? f.stock_minimo ?? 0,
      max: actual?.max ?? f.stock_maximo ?? 0,
      minOrig: actual?.minOrig ?? f.stock_minimo ?? 0,
      maxOrig: actual?.maxOrig ?? f.stock_maximo ?? 0,
      ...valores,
    });
    return next;
  };

  // NumeroInput acepta decimales (usa parseFloat) pero el RPC recibe INTEGER:
  // un 2.5 revienta la tanda entera con un error crudo de Postgres. Se redondea
  // aqui, que es el ultimo sitio antes de guardar.
  const editar = (f, campo, valor) =>
    setBorrador((prev) =>
      anotar(prev, f, { [campo]: Math.max(0, Math.round(Number(valor) || 0)) }),
    );

  const usarSugerido = (f) => {
    const s = sugeridos.get(f.producto_id);
    if (!s) return;
    setBorrador((prev) => anotar(prev, f, { min: s.min, max: s.max }));
  };

  const usarSugeridosVisibles = () =>
    setBorrador((prev) => {
      let next = prev;
      filas.forEach((f) => {
        const s = sugeridos.get(f.producto_id);
        if (s) next = anotar(next, f, { min: s.min, max: s.max });
      });
      return next;
    });

  // Sólo se manda lo que de verdad cambió: guardar lo que ya estaba escribiría
  // bitácora de un cambio que no existió. Se compara contra los originales que
  // lleva el propio borrador, así que las ediciones sobreviven a la paginación
  // y a los filtros.
  const pendientes = useMemo(() => {
    const out = [];
    for (const [productoId, v] of borrador) {
      if (v.min === v.minOrig && v.max === v.maxOrig) continue;
      out.push({
        producto_id: productoId,
        sede_id: sedeEfectiva,
        min: v.min,
        max: v.max,
      });
    }
    return out;
  }, [borrador, sedeEfectiva]);

  // Estricto: con máximo igual al mínimo el producto no puede quedar nunca en
  // "OK" y la alerta no tiene forma de resolverse.
  const invalidos = pendientes.filter((p) => p.max > 0 && p.max <= p.min);

  const guardar = async () => {
    if (pendientes.length === 0 || guardando) return;
    if (invalidos.length > 0) {
      avisarError(
        new Error(
          `${invalidos.length} producto(s) tienen el máximo igual o por debajo del mínimo. El máximo debe ser mayor, o 0 para dejarlo sin techo.`,
        ),
        "Revisa los valores",
      );
      return;
    }
    setGuardando(true);
    try {
      let hechos = 0;
      for (let i = 0; i < pendientes.length; i += TANDA) {
        const tanda = pendientes.slice(i, i + TANDA);
        const { error } = await supabase.rpc("fn_aplicar_minmax", {
          p_items: tanda,
        });
        if (error) throw error;
        hechos += tanda.length;
        if (mountedRef.current) {
          setProgreso({ hechos, total: pendientes.length });
        }
      }
      avisarOk(
        `${hechos} producto(s) actualizados en ${sedeEfectiva}. Las alertas se ajustan de inmediato.`,
      );
      if (!mountedRef.current) return;
      setBorrador(new Map());
      await cargar();
    } catch (err) {
      avisarError(err, "No se pudo guardar");
    } finally {
      if (mountedRef.current) {
        setGuardando(false);
        setProgreso(null);
      }
    }
  };

  const paginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Cuántas de las filas visibles tienen sugerencia: el botón decía "en los 50
  // visibles" y cambiaba 12.
  const conSugerencia = filas.filter((f) =>
    sugeridos.has(f.producto_id),
  ).length;

  // Tras guardar con el filtro "Sin configurar", las filas configuradas salen
  // del filtro y la última página puede dejar de existir: sin esto quedaba
  // "Página 6 de 5" con la lista vacía, justo después de un guardado correcto.
  useEffect(() => {
    if (pagina > 0 && pagina >= paginas) setPagina(paginas - 1);
  }, [pagina, paginas]);

  return (
    <div className="p-4 sm:p-6 space-y-4 animate-fade-in">
      {/* ── Encabezado ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <button
            onClick={() => navigate("/ops/inventario")}
            className="mb-1 inline-flex items-center gap-1.5 text-[13px]"
            style={{ color: "var(--n-500)" }}
          >
            <ArrowLeftCircle className="h-4 w-4" strokeWidth={1.75} />
            Inventario
          </button>
          <h1
            className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--n-950)" }}
          >
            Mínimos y máximos
          </h1>
          <p className="m-0 mt-1 text-[13px]" style={{ color: "var(--n-500)" }}>
            {esAdmin
              ? "Puedes configurar cualquier sede."
              : `Configuras la sede ${perfil?.sede_id ?? "—"}. Para otra sede, pídeselo a Maritza.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {esAdmin && (
            <select
              value={sede}
              onChange={(e) => {
                setSede(e.target.value);
                setPagina(0);
                setBorrador(new Map());
                setSugeridos(new Map());
              }}
              className="h-12 rounded-lg border bg-transparent px-3 text-sm"
              style={{ borderColor: "var(--n-200)" }}
              aria-label="Sede"
            >
              {sedes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={traerSugeridos}
            disabled={cargandoSug || !sedeEfectiva}
            className="btn btn-out inline-flex items-center gap-1.5 disabled:opacity-60"
            style={{ height: 48 }}
          >
            <Wand2 className="h-4 w-4" strokeWidth={1.75} />
            {cargandoSug ? "Calculando…" : "Sugerir por demanda"}
          </button>
        </div>
      </div>

      {/* Qué significa el 0. Es lo que más se malinterpreta y aquí se ve una
          vez, arriba, en vez de repetirlo en cada fila. */}
      <p
        className="m-0 rounded-lg border px-3 py-2 text-[12px]"
        style={{
          borderColor: "var(--info-border)",
          backgroundColor: "var(--info-50)",
          color: "var(--info-700)",
        }}
      >
        <b>Mínimo 0</b> = esta sede no maneja el producto: no genera alerta ni
        aunque quede en cero. <b>Máximo 0</b> = sin techo.
      </p>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border px-3 py-2 text-sm"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
            color: "var(--dang-700)",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* ── Filtros ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
            style={{ color: "var(--n-300)" }}
            strokeWidth={1.75}
          />
          <input
            defaultValue={busqueda}
            onChange={(e) => buscarDebounced(e.target.value)}
            placeholder="Buscar por referencia o nombre"
            className="h-12 w-full rounded-lg border bg-transparent pl-9 pr-3 text-sm outline-none"
            style={{ borderColor: "var(--n-200)" }}
          />
        </div>
        {FILTROS.map((f) => {
          const on = filtro === f.id;
          return (
            <button
              key={f.id}
              onClick={() => {
                setFiltro(f.id);
                setPagina(0);
              }}
              disabled={guardando}
              className="rounded-lg border px-3 text-[12.5px] font-medium disabled:opacity-50"
              style={{
                height: 48,
                borderColor: on ? "var(--p-500)" : "var(--n-200)",
                backgroundColor: on ? "var(--p-50)" : "transparent",
                color: on ? "var(--p-700)" : "var(--n-500)",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {sugeridos.size > 0 && (
        <button
          onClick={usarSugeridosVisibles}
          className="btn btn-out inline-flex items-center gap-1.5"
          style={{ height: 48 }}
        >
          <Check className="h-4 w-4" strokeWidth={1.75} />
          Usar el sugerido en {conSugerencia} de los visibles
        </button>
      )}

      {/* ── Listado ────────────────────────────────────────────────── */}
      {loading ? (
        <p className="text-sm" style={{ color: "var(--n-500)" }}>
          Cargando…
        </p>
      ) : filas.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--n-500)" }}>
          No hay productos con ese filtro en esta sede.
        </p>
      ) : (
        <>
          {/* Escritorio */}
          <div
            className="hidden overflow-x-auto rounded-xl border md:block"
            style={{ borderColor: "var(--n-200)" }}
          >
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr style={{ backgroundColor: "var(--n-50)" }}>
                  <Th>Producto</Th>
                  <Th right>Existencias</Th>
                  <Th right>Mínimo</Th>
                  <Th right>Máximo</Th>
                  <Th>Estado</Th>
                  <Th>Sugerido</Th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <Fila
                    key={f.id}
                    f={f}
                    valorDe={valorDe}
                    editar={editar}
                    sugerido={sugeridos.get(f.producto_id)}
                    usarSugerido={usarSugerido}
                    guardando={guardando}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Móvil */}
          <ul className="space-y-2.5 md:hidden" role="list">
            {filas.map((f) => {
              const s = sugeridos.get(f.producto_id);
              const min = valorDe(f, "min");
              const max = valorDe(f, "max");
              return (
                <li
                  key={f.id}
                  className="rounded-xl border p-4"
                  style={{
                    borderColor: "var(--n-200)",
                    backgroundColor: "var(--n-0)",
                  }}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p
                        className="m-0 truncate text-sm font-medium"
                        style={{ color: "var(--n-950)" }}
                      >
                        {f.producto?.nombre}
                      </p>
                      <p
                        className="m-0 truncate font-mono text-[11px]"
                        style={{ color: "var(--n-500)" }}
                      >
                        {f.producto?.referencia} ·{" "}
                        {f.producto?.vendible ? f.cantidad : f.cantidad_insumo}{" "}
                        uds
                      </p>
                    </div>
                    <StatusBadge status={f.estado_stock} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span
                        className="mb-1 block text-[11px]"
                        style={{ color: "var(--n-500)" }}
                      >
                        Mínimo
                      </span>
                      <NumeroInput
                        value={min}
                        onChange={(v) => editar(f, "min", v)}
                        min={0}
                        step={1}
                        disabled={guardando}
                        className="h-12 w-full rounded-lg border px-3 text-right font-mono outline-none"
                        style={{ borderColor: "var(--n-200)" }}
                      />
                    </label>
                    <label className="block">
                      <span
                        className="mb-1 block text-[11px]"
                        style={{ color: "var(--n-500)" }}
                      >
                        Máximo
                      </span>
                      <NumeroInput
                        value={max}
                        onChange={(v) => editar(f, "max", v)}
                        min={0}
                        step={1}
                        disabled={guardando}
                        className="h-12 w-full rounded-lg border px-3 text-right font-mono outline-none"
                        style={{ borderColor: "var(--n-200)" }}
                      />
                    </label>
                  </div>
                  {max > 0 && max <= min && (
                    <p
                      className="m-0 mt-1.5 text-[11px] font-medium"
                      style={{ color: "var(--dang-700)" }}
                    >
                      El máximo debe ser mayor que el mínimo (o 0 = sin techo).
                    </p>
                  )}
                  {s && (
                    <button
                      onClick={() => usarSugerido(f)}
                      disabled={guardando}
                      className="mt-2 inline-flex items-center rounded-lg border px-3 text-xs font-medium disabled:opacity-50"
                      style={{
                        minHeight: 48,
                        borderColor: "var(--n-200)",
                        color: "var(--p-700)",
                      }}
                    >
                      Usar sugerido: {s.min} → {s.max}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Paginación */}
          {paginas > 1 && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px]" style={{ color: "var(--n-500)" }}>
                Página {pagina + 1} de {paginas} · {total} productos
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPagina((p) => Math.max(0, p - 1))}
                  disabled={pagina === 0 || guardando}
                  className="btn btn-out disabled:opacity-40"
                  style={{ height: 48 }}
                >
                  Anterior
                </button>
                <button
                  onClick={() => setPagina((p) => Math.min(paginas - 1, p + 1))}
                  disabled={pagina >= paginas - 1 || guardando}
                  className="btn btn-out disabled:opacity-40"
                  style={{ height: 48 }}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Barra de guardado ──────────────────────────────────────── */}
      {pendientes.length > 0 && (
        <div
          className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
          style={{
            borderColor: "var(--n-200)",
            backgroundColor: "var(--n-0)",
            boxShadow: "0 -4px 12px rgba(0,0,0,0.06)",
          }}
        >
          <span className="text-[13px]" style={{ color: "var(--n-700)" }}>
            {progreso
              ? `Guardando ${progreso.hechos} de ${progreso.total}…`
              : `${pendientes.length} cambio(s) sin guardar`}
            {invalidos.length > 0 && (
              <b style={{ color: "var(--dang-700)" }}>
                {" "}
                · {invalidos.length} con el máximo igual o menor que el mínimo
              </b>
            )}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setBorrador(new Map())}
              disabled={guardando}
              className="btn btn-out"
              style={{ height: 48 }}
            >
              Descartar
            </button>
            <button
              onClick={guardar}
              disabled={guardando || invalidos.length > 0}
              className="btn btn-pri disabled:opacity-60"
              style={{ height: 48 }}
            >
              {guardando ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Helpers ── */

function Th({ children, right }) {
  return (
    <th
      className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide ${
        right ? "text-right" : "text-left"
      }`}
      style={{ color: "var(--n-500)" }}
    >
      {children}
    </th>
  );
}

function Fila({ f, valorDe, editar, sugerido, usarSugerido, guardando }) {
  const min = valorDe(f, "min");
  const max = valorDe(f, "max");
  const existencias = f.producto?.vendible ? f.cantidad : f.cantidad_insumo;
  const invalido = max > 0 && max <= min;

  return (
    <tr className="border-t" style={{ borderColor: "var(--n-100)" }}>
      <td className="px-3 py-2">
        <div className="text-sm" style={{ color: "var(--n-950)" }}>
          {f.producto?.nombre}
        </div>
        <div
          className="font-mono text-[11px]"
          style={{ color: "var(--n-500)" }}
        >
          {f.producto?.referencia}
        </div>
      </td>
      <td
        className="px-3 py-2 text-right font-mono text-sm tabular-nums"
        style={{ color: "var(--n-700)" }}
      >
        {existencias}
      </td>
      <td className="px-3 py-2 text-right">
        <NumeroInput
          value={min}
          onChange={(v) => editar(f, "min", v)}
          min={0}
          step={1}
          disabled={guardando}
          className="h-12 w-20 rounded-lg border px-2 text-right font-mono text-sm outline-none"
          style={{ borderColor: invalido ? "var(--dang-500)" : "var(--n-200)" }}
          aria-label={`Mínimo de ${f.producto?.referencia}`}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <NumeroInput
          value={max}
          onChange={(v) => editar(f, "max", v)}
          min={0}
          step={1}
          disabled={guardando}
          className="h-12 w-20 rounded-lg border px-2 text-right font-mono text-sm outline-none"
          style={{ borderColor: invalido ? "var(--dang-500)" : "var(--n-200)" }}
          aria-label={`Máximo de ${f.producto?.referencia}`}
        />
      </td>
      <td className="px-3 py-2">
        <StatusBadge status={f.estado_stock} />
        {min === 0 && (
          <div className="text-[10.5px]" style={{ color: "var(--n-500)" }}>
            No alerta
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        {sugerido ? (
          <button
            onClick={() => usarSugerido(f)}
            disabled={guardando}
            className="inline-flex items-center rounded-lg border px-2.5 text-xs font-medium disabled:opacity-50"
            style={{
              minHeight: 48,
              borderColor: "var(--n-200)",
              color: "var(--p-700)",
            }}
          >
            {sugerido.min} → {sugerido.max}
          </button>
        ) : (
          <span className="text-xs" style={{ color: "var(--n-300)" }}>
            —
          </span>
        )}
      </td>
    </tr>
  );
}
