import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Package,
  ShoppingCart,
  Check,
  Building2,
  AlertTriangle,
  SlidersHorizontal,
  X,
  RefreshCw,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError } from "../../lib/utils";
import StatusBadge from "../../components/ui/StatusBadge";
import { abcBadgeStyle } from "../../lib/admin-analytics-ui";
import { useAuthStore } from "../../stores/authStore";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import { surfaceInputStyle, pillStyle } from "../../lib/admin-ops-ui";

const TODAS_SEDES = "Todas";
const COLS =
  "grid-cols-[28px_minmax(0,1fr)_56px_130px_104px_72px_72px_84px_116px]";

/* ── Sugerencias de reorden (datos reales: v_sugerencias_reorden) ──────── */
export default function Reorden() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const isAdmin = perfil?.rol === "Admin";
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [sedeFiltro, setSedeFiltro] = useState(TODAS_SEDES);
  // Selección de SKUs para generar una orden de compra (estado de UI local).
  const [seleccion, setSeleccion] = useState(() => new Set());
  const [agotadosSinConfig, setAgotadosSinConfig] = useState(null);
  // Bloque B — asistente de min/max sugeridos.
  const [modalMinMax, setModalMinMax] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cargar = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const { data, error } = await supabase
        .from("v_sugerencias_reorden")
        .select("*")
        .limit(200);
      if (!mountedRef.current) return;
      if (error) throw error;
      setItems(data ?? []);
      setSeleccion(new Set());
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar sugerencias"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const cargarAgotadosSinConfig = async () => {
    try {
      // El stock de un vendible vive en `cantidad`; el de un insumo en
      // `cantidad_insumo` — contar solo `cantidad` marcaría como agotados
      // insumos con existencias.
      const base = () =>
        supabase
          .from("inventario")
          .select("id, producto:producto_id!inner(id)", {
            count: "exact",
            head: true,
          })
          .eq("producto.activo", true)
          .eq("producto.stock_minimo", 0);
      const [vendibles, insumos] = await Promise.all([
        base().eq("producto.vendible", true).lte("cantidad", 0),
        base().eq("producto.vendible", false).lte("cantidad_insumo", 0),
      ]);
      if (!mountedRef.current) return;
      if (vendibles.error) throw vendibles.error;
      if (insumos.error) throw insumos.error;
      setAgotadosSinConfig((vendibles.count ?? 0) + (insumos.count ?? 0));
    } catch {
      // Silencioso: es un dato informativo adicional, no crítico para la página.
      if (mountedRef.current) setAgotadosSinConfig(null);
    }
  };

  useEffect(() => {
    cargar();
    cargarAgotadosSinConfig();
  }, []);

  const keyOf = (i) => `${i.producto_id}-${i.sede_id}`;

  const sedes = useMemo(() => {
    const set = new Map();
    items.forEach((i) => set.set(i.sede_id, i.sede_nombre));
    return [TODAS_SEDES, ...[...set.keys()]];
  }, [items]);

  const filtrados = useMemo(
    () =>
      sedeFiltro === TODAS_SEDES
        ? items
        : items.filter((i) => i.sede_id === sedeFiltro),
    [items, sedeFiltro],
  );

  const totalCompra = filtrados.reduce(
    (s, i) => s + Number(i.costo_estimado_compra || 0),
    0,
  );
  const urgentes = filtrados.filter((i) => i.estado_stock === "Agotado").length;
  const claseA = filtrados.filter((i) => i.clasificacion === "A").length;

  // Métricas de la selección activa.
  const seleccionados = filtrados.filter((i) => seleccion.has(keyOf(i)));
  const valorSeleccion = seleccionados.reduce(
    (s, i) => s + Number(i.costo_estimado_compra || 0),
    0,
  );

  const toggle = (key) =>
    setSeleccion((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const todosVisiblesOn =
    filtrados.length > 0 && filtrados.every((i) => seleccion.has(keyOf(i)));
  const algunoOn = filtrados.some((i) => seleccion.has(keyOf(i)));

  const toggleTodos = () =>
    setSeleccion((prev) => {
      const next = new Set(prev);
      const keys = filtrados.map(keyOf);
      if (keys.every((k) => next.has(k))) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });

  const generarOC = () => {
    // Abre el flujo REAL de Nueva compra (no se inventa creación de OC aquí).
    // Adjunta las sugerencias como `state` para que CompraNueva pueda
    // preseleccionarlas cuando ese soporte exista; hoy se ignora sin romper.
    navigate("/ops/compras/nueva", {
      state: {
        sugerenciasReorden: seleccionados.map((i) => ({
          producto_id: i.producto_id,
          referencia: i.referencia,
          nombre: i.nombre,
          sede_id: i.sede_id,
          cantidad_sugerida: i.cantidad_sugerida,
          costo_unitario: Number(i.costo_promedio || 0),
        })),
      },
    });
  };

  return (
    <div className="flex flex-col gap-6 px-5 pb-8 pt-6 sm:px-7 animate-fade-in">
      {/* Page head */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="m-0 mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Admin · Sugerencias de reposición
          </p>
          <h1
            className="m-0 flex items-center gap-2.5 text-[24px] font-semibold leading-tight tracking-[-0.018em]"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Reorden
            {!loading && items.length > 0 && (
              <span
                className="rounded-[3px] border px-1.5 py-px font-mono text-[11px] font-semibold"
                style={{
                  backgroundColor: "hsl(var(--warning) / 0.12)",
                  borderColor: "hsl(var(--warning) / 0.4)",
                  color: "hsl(var(--warning))",
                }}
              >
                {items.length} SKUs
              </span>
            )}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setModalMinMax(true)}
              className="inline-flex h-12 items-center gap-1.5 rounded-md border px-4 text-[12.5px] font-semibold transition-colors cursor-pointer"
              style={{
                borderColor: "hsl(var(--border))",
                backgroundColor: "hsl(var(--card))",
                color: "hsl(var(--foreground))",
              }}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} />
              Sugerir min/max
            </button>
          )}
          <button
            onClick={() => navigate("/ops/compras/nueva")}
            className="inline-flex h-12 items-center gap-1.5 rounded-md px-4 text-[12.5px] font-semibold transition-colors cursor-pointer"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            <ShoppingCart className="h-3.5 w-3.5" strokeWidth={1.75} />
            Nueva compra
          </button>
        </div>
      </div>

      {modalMinMax && (
        <ModalMinMax
          onClose={() => setModalMinMax(false)}
          onAplicado={() => {
            setModalMinMax(false);
            cargar();
            cargarAgotadosSinConfig();
          }}
        />
      )}

      {errorMsg && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.4)",
            color: "hsl(var(--destructive))",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* KPI strip */}
      <div
        className="grid grid-cols-2 gap-y-4 border-b pb-5 pt-1 md:grid-cols-4 md:gap-y-0"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <Kpi
          label="SKUs en reorden"
          value={filtrados.length.toLocaleString("es-CO")}
          sub="Bajo el mínimo"
        />
        <Kpi
          label="Agotados"
          value={urgentes.toLocaleString("es-CO")}
          token={urgentes > 0 ? "--destructive" : undefined}
          sub="Reposición urgente"
        />
        <Kpi
          label="Clase A en alerta"
          value={claseA.toLocaleString("es-CO")}
          token={claseA > 0 ? "--success" : undefined}
          sub="Alto valor · prioridad"
        />
        <Kpi
          last
          label="Valor total estimado"
          value={formatCOP(totalCompra)}
          sub="Costo · cantidad sugerida"
        />
      </div>

      {/* Aviso: agotados sin stock mínimo configurado (no aparecen abajo) */}
      {!loading && agotadosSinConfig > 0 && (
        <div
          className="flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[12.5px]"
          style={{
            backgroundColor: "hsl(var(--warning) / 0.08)",
            borderColor: "hsl(var(--warning) / 0.35)",
            color: "hsl(var(--foreground))",
          }}
        >
          <AlertTriangle
            className="h-4 w-4 shrink-0 mt-0.5"
            strokeWidth={1.75}
            style={{ color: "hsl(var(--warning))" }}
          />
          <p className="m-0">
            <strong>{agotadosSinConfig}</strong>{" "}
            {agotadosSinConfig === 1
              ? "referencia agotada no aparece"
              : "referencias agotadas no aparecen"}{" "}
            en esta lista porque no tienen stock mínimo configurado. Configura
            mínimo y máximo en el producto para recibir sugerencias.
          </p>
        </div>
      )}

      {/* Filtro por sede */}
      {!loading && sedes.length > 2 && (
        <div className="flex flex-wrap items-center gap-2 -mt-1">
          <span
            className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            <Building2 className="h-3 w-3" strokeWidth={1.5} />
            Sede
          </span>
          <Seg
            options={sedes}
            value={sedeFiltro}
            onChange={setSedeFiltro}
            labelOf={(s) =>
              s === TODAS_SEDES
                ? "Todas"
                : (items.find((i) => i.sede_id === s)?.sede_nombre ?? s)
            }
          />
        </div>
      )}

      {/* Barra de selección */}
      {!loading && filtrados.length > 0 && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border px-4 py-2.5"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--muted) / 0.3)",
          }}
        >
          <div className="flex items-center gap-3 text-[12px]">
            <span
              className="font-mono text-[10.5px] uppercase tracking-[0.06em]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Selección
            </span>
            <span
              className="font-mono text-[12px] font-semibold tabular-nums"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {seleccion.size} SKUs
            </span>
            <span style={{ color: "hsl(var(--border))" }}>·</span>
            <span
              className="font-mono text-[12px] tabular-nums"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {formatCOP(valorSeleccion)}
            </span>
          </div>
          <button
            disabled={seleccion.size === 0}
            onClick={generarOC}
            className="inline-flex h-12 items-center gap-1.5 rounded-md px-4 text-[12.5px] font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed"
            style={
              seleccion.size === 0
                ? {
                    border: "1px solid hsl(var(--border))",
                    backgroundColor: "hsl(var(--card))",
                    color: "hsl(var(--muted-foreground))",
                    opacity: 0.7,
                  }
                : {
                    backgroundColor: "hsl(var(--primary))",
                    color: "hsl(var(--primary-foreground))",
                  }
            }
          >
            <ShoppingCart className="h-3.5 w-3.5" strokeWidth={1.75} />
            Generar OC
            {seleccion.size > 0 && ` (${seleccion.size})`}
          </button>
        </div>
      )}

      {loading ? (
        <SkeletonList />
      ) : filtrados.length === 0 ? (
        <Empty icon="📦">Todos los productos están sobre el stock mínimo</Empty>
      ) : (
        <section
          className="overflow-hidden rounded-[10px] border"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          {/* Desktop tabla */}
          <div className="hidden md:block overflow-x-auto">
            <div
              className={`grid ${COLS} items-center gap-3 border-b px-[18px] py-2 font-mono text-[10.5px] uppercase tracking-[0.06em]`}
              style={{
                borderColor: "hsl(var(--border))",
                backgroundColor: "hsl(var(--muted) / 0.3)",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              <CheckBox
                checked={todosVisiblesOn}
                indeterminate={!todosVisiblesOn && algunoOn}
                onClick={toggleTodos}
                ariaLabel="Seleccionar todos"
              />
              <span>Producto</span>
              <span>ABC</span>
              <span>Sede</span>
              <span>Estado</span>
              <span className="text-right">Stock</span>
              <span className="text-right">Mínimo</span>
              <span className="text-right">Sugerido</span>
              <span className="text-right">Costo est.</span>
            </div>
            {filtrados.map((i) => {
              const key = keyOf(i);
              const on = seleccion.has(key);
              return (
                <div
                  key={key}
                  className={`grid ${COLS} items-center gap-3 border-b px-[18px] py-2.5 transition-colors last:border-b-0`}
                  style={{
                    borderColor: "hsl(var(--border))",
                    backgroundColor: on
                      ? "hsl(var(--primary) / 0.06)"
                      : "transparent",
                  }}
                >
                  <CheckBox
                    checked={on}
                    onClick={() => toggle(key)}
                    ariaLabel={`Seleccionar ${i.referencia}`}
                  />
                  <div className="flex min-w-0 items-center gap-2">
                    <Package
                      className="h-3.5 w-3.5 shrink-0"
                      strokeWidth={1.5}
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    />
                    <div className="min-w-0">
                      <p
                        className="truncate text-sm font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {i.nombre}
                      </p>
                      <p
                        className="truncate font-mono text-[10.5px]"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {i.referencia}
                      </p>
                    </div>
                  </div>
                  <span
                    className="grid h-5 w-5 place-items-center rounded-[4px] border text-[10.5px] font-bold"
                    style={abcBadgeStyle(i.clasificacion)}
                  >
                    {i.clasificacion ?? "—"}
                  </span>
                  <span
                    className="truncate text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {i.sede_nombre}
                  </span>
                  <span>
                    <StatusBadge status={i.estado_stock} />
                  </span>
                  <span
                    className="text-right font-mono text-sm font-semibold tabular-nums"
                    style={{
                      color:
                        i.estado_stock === "Agotado"
                          ? "hsl(var(--destructive))"
                          : "hsl(var(--warning))",
                    }}
                  >
                    {i.stock_actual}
                  </span>
                  <span
                    className="text-right font-mono text-sm tabular-nums"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {i.stock_minimo}
                  </span>
                  <span
                    className="text-right font-mono text-sm font-bold tabular-nums"
                    style={{ color: "hsl(var(--primary))" }}
                  >
                    {i.cantidad_sugerida}
                  </span>
                  <span
                    className="text-right font-mono text-sm font-medium tabular-nums"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {formatCOP(i.costo_estimado_compra)}
                  </span>
                </div>
              );
            })}
            <div
              className={`grid ${COLS} items-center gap-3 border-t-2 px-[18px] py-3`}
              style={{
                borderColor: "hsl(var(--border))",
                backgroundColor: "hsl(var(--muted) / 0.3)",
              }}
            >
              <span
                className="col-span-8 text-right text-sm font-semibold"
                style={{ color: "hsl(var(--foreground))" }}
              >
                Total estimado:
              </span>
              <span
                className="text-right font-mono text-sm font-bold tabular-nums"
                style={{ color: "hsl(var(--primary))" }}
              >
                {formatCOP(totalCompra)}
              </span>
            </div>
          </div>

          {/* Mobile cards */}
          <ul className="md:hidden divide-y" role="list">
            {filtrados.map((i) => {
              const key = keyOf(i);
              const on = seleccion.has(key);
              return (
                <li
                  key={key}
                  className="p-4"
                  style={{
                    borderColor: "hsl(var(--border))",
                    backgroundColor: on
                      ? "hsl(var(--primary) / 0.06)"
                      : "transparent",
                  }}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <CheckBox
                        checked={on}
                        onClick={() => toggle(key)}
                        ariaLabel={`Seleccionar ${i.referencia}`}
                        big
                      />
                      <span
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-md border text-[10.5px] font-bold"
                        style={abcBadgeStyle(i.clasificacion)}
                      >
                        {i.clasificacion ?? "—"}
                      </span>
                      <div className="min-w-0">
                        <p
                          className="truncate text-sm font-medium"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {i.nombre}
                        </p>
                        <p
                          className="truncate font-mono text-xs"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {i.referencia} · {i.sede_nombre}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={i.estado_stock} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <CardMetric
                      label="Stock"
                      value={i.stock_actual}
                      token={
                        i.estado_stock === "Agotado"
                          ? "--destructive"
                          : "--warning"
                      }
                    />
                    <CardMetric
                      label="Sugerido"
                      value={i.cantidad_sugerida}
                      token="--primary"
                    />
                    <CardMetric
                      label="Costo"
                      value={formatCOP(i.costo_estimado_compra)}
                      token="--foreground"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ── Bloque B — Modal "Sugerir min/max" ────────────────────────────────── */
const PARAM_LABELS = {
  minmax_lead_time_dias: "Lead time (días)",
  minmax_factor_seguridad: "Factor de seguridad",
  minmax_factor_max: "Máx = mín ×",
};

function ModalMinMax({ onClose, onAplicado }) {
  const [loading, setLoading] = useState(true);
  const [recalculando, setRecalculando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [sugerencias, setSugerencias] = useState([]);
  const [soloSinConfigurar, setSoloSinConfigurar] = useState(true);
  const [seleccion, setSeleccion] = useState(() => new Set());
  const [parametros, setParametros] = useState({
    minmax_lead_time_dias: 7,
    minmax_factor_seguridad: 1.5,
    minmax_factor_max: 3,
  });
  const mountedRef = useRef(true);
  const { confirm, ConfirmDialog } = useConfirm();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cargarParametros = async () => {
    try {
      const { data, error } = await supabase
        .from("parametros")
        .select("clave, valor")
        .in("clave", Object.keys(parametros));
      if (!mountedRef.current) return;
      if (error) throw error;
      if (data?.length) {
        setParametros((prev) => {
          const next = { ...prev };
          data.forEach((p) => {
            next[p.clave] = Number(p.valor);
          });
          return next;
        });
      }
    } catch {
      // Si falla la carga de parámetros, se usan los defaults locales.
    }
  };

  const cargarSugerencias = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const { data, error } = await supabase.rpc("fn_sugerir_minmax", {
        p_dias: 90,
      });
      if (!mountedRef.current) return;
      if (error) throw error;
      const lista = data ?? [];
      setSugerencias(lista);
      // Selección por defecto: todos los NO configurados marcados, los
      // ya configurados desmarcados (protege valores manuales existentes).
      setSeleccion(
        new Set(
          lista.filter((i) => !i.ya_configurado).map((i) => i.producto_id),
        ),
      );
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al calcular sugerencias"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargarParametros();
    cargarSugerencias();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recalcular = async () => {
    // Validar los 3 valores ANTES de escribir: la tabla `parametros` es
    // global (compartida por todas las sesiones) y el update va clave por
    // clave — un valor inválido a mitad de camino la dejaría mixta.
    const valores = {};
    for (const clave of Object.keys(parametros)) {
      const n = Number(parametros[clave]);
      if (parametros[clave] === "" || !Number.isFinite(n) || n <= 0) {
        setErrorMsg("Los tres parámetros deben ser números mayores que 0");
        return;
      }
      valores[clave] = n;
    }
    setRecalculando(true);
    setErrorMsg("");
    setOkMsg("");
    try {
      // Guarda los 3 parámetros (update por clave, ya existen por la semilla
      // de la migración) y vuelve a llamar al RPC con los valores nuevos.
      for (const clave of Object.keys(valores)) {
        const { error } = await supabase
          .from("parametros")
          .update({
            valor: valores[clave],
            updated_at: new Date().toISOString(),
          })
          .eq("clave", clave);
        if (error) throw error;
      }
      await cargarSugerencias();
      setOkMsg("Parámetros actualizados");
    } catch (err) {
      setErrorMsg(safeError(err, "Error al guardar parámetros"));
    } finally {
      setRecalculando(false);
    }
  };

  const visibles = useMemo(
    () =>
      soloSinConfigurar
        ? sugerencias.filter((i) => !i.ya_configurado)
        : sugerencias,
    [sugerencias, soloSinConfigurar],
  );

  const toggle = (id) =>
    setSeleccion((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const todosVisiblesOn =
    visibles.length > 0 && visibles.every((i) => seleccion.has(i.producto_id));
  const algunoOn = visibles.some((i) => seleccion.has(i.producto_id));

  const toggleTodos = () =>
    setSeleccion((prev) => {
      const next = new Set(prev);
      const ids = visibles.map((i) => i.producto_id);
      if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });

  // Solo se aplican los seleccionados VISIBLES: un ítem marcado que el
  // filtro "Solo sin configurar" oculte no debe aplicarse a ciegas.
  const seleccionados = visibles.filter((i) => seleccion.has(i.producto_id));

  const aplicar = async () => {
    if (seleccionados.length === 0) return;
    const ok = await confirm({
      titulo: "Aplicar sugerencias de min/max",
      mensaje: `Se actualizará el stock mínimo y máximo de ${seleccionados.length} ${
        seleccionados.length === 1 ? "producto" : "productos"
      }.`,
      confirmLabel: "Aplicar seleccionados",
    });
    if (!ok) return;
    setAplicando(true);
    setErrorMsg("");
    setOkMsg("");
    try {
      const payload = seleccionados.map((i) => ({
        producto_id: i.producto_id,
        min: i.min_sugerido,
        max: i.max_sugerido,
      }));
      const { data, error } = await supabase.rpc("fn_aplicar_minmax", {
        p_items: payload,
      });
      if (error) throw error;
      setOkMsg(
        `${data?.aplicados ?? seleccionados.length} productos actualizados`,
      );
      await onAplicado();
    } catch (err) {
      setErrorMsg(safeError(err, "Error al aplicar sugerencias"));
    } finally {
      setAplicando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border sm:max-w-4xl sm:rounded-2xl"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <ConfirmDialog />
        {/* Header */}
        <div
          className="flex items-start justify-between gap-3 border-b px-5 py-4"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <div>
            <h2
              className="text-lg font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Sugerir mínimos y máximos
            </h2>
            <p
              className="mt-1 text-[12.5px]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Basado en la demanda real de los últimos 90 días (ventas + OT +
              ensambles).
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md cursor-pointer"
            style={{ color: "hsl(var(--muted-foreground))" }}
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Cuerpo scrolleable */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {errorMsg && <Banner type="destructive">{errorMsg}</Banner>}
          {okMsg && <Banner type="success">{okMsg}</Banner>}

          {/* Parámetros editables */}
          <div
            className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border p-3"
            style={{
              borderColor: "hsl(var(--border))",
              backgroundColor: "hsl(var(--muted) / 0.3)",
            }}
          >
            {Object.keys(parametros).map((clave) => (
              <div key={clave} className="flex flex-col gap-1">
                <label
                  className="font-mono text-[10.5px] uppercase tracking-[0.06em]"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {PARAM_LABELS[clave]}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={parametros[clave]}
                  onChange={(e) =>
                    setParametros((prev) => ({
                      ...prev,
                      [clave]: e.target.value,
                    }))
                  }
                  className="h-11 w-32 rounded-lg border px-2.5 text-sm"
                  style={surfaceInputStyle}
                />
              </div>
            ))}
            <button
              onClick={recalcular}
              disabled={recalculando}
              className="inline-flex h-11 items-center gap-1.5 rounded-md px-4 text-[12.5px] font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                backgroundColor: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
              }}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${recalculando ? "animate-spin" : ""}`}
                strokeWidth={1.75}
              />
              Recalcular
            </button>
          </div>

          {/* Toggle solo sin configurar */}
          <label className="mb-3 flex w-fit cursor-pointer items-center gap-2 text-[12.5px]">
            <input
              type="checkbox"
              checked={soloSinConfigurar}
              onChange={(e) => setSoloSinConfigurar(e.target.checked)}
              className="h-4 w-4 cursor-pointer"
            />
            <span style={{ color: "hsl(var(--foreground))" }}>
              Solo sin configurar
            </span>
          </label>

          {loading ? (
            <SkeletonList />
          ) : visibles.length === 0 ? (
            <Empty icon="📈">
              {sugerencias.length === 0
                ? "Sin demanda registrada en el periodo"
                : "Todos los productos visibles ya están configurados"}
            </Empty>
          ) : (
            <section
              className="overflow-hidden rounded-[10px] border"
              style={{ borderColor: "hsl(var(--border))" }}
            >
              {/* Desktop tabla */}
              <div className="hidden md:block overflow-x-auto">
                <div
                  className="grid grid-cols-[28px_minmax(0,1fr)_90px_120px_140px_120px] items-center gap-3 border-b px-[18px] py-2 font-mono text-[10.5px] uppercase tracking-[0.06em]"
                  style={{
                    borderColor: "hsl(var(--border))",
                    backgroundColor: "hsl(var(--muted) / 0.3)",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  <CheckBox
                    checked={todosVisiblesOn}
                    indeterminate={!todosVisiblesOn && algunoOn}
                    onClick={toggleTodos}
                    ariaLabel="Seleccionar todos"
                  />
                  <span>Producto</span>
                  <span className="text-right">Demanda 90d</span>
                  <span className="text-right">Actual</span>
                  <span className="text-right">Sugerido</span>
                  <span className="text-right">Estado</span>
                </div>
                {visibles.map((i) => {
                  const on = seleccion.has(i.producto_id);
                  return (
                    <div
                      key={i.producto_id}
                      className="grid grid-cols-[28px_minmax(0,1fr)_90px_120px_140px_120px] items-center gap-3 border-b px-[18px] py-2.5 transition-colors last:border-b-0"
                      style={{
                        borderColor: "hsl(var(--border))",
                        backgroundColor: on
                          ? "hsl(var(--primary) / 0.06)"
                          : "transparent",
                      }}
                    >
                      <CheckBox
                        checked={on}
                        onClick={() => toggle(i.producto_id)}
                        ariaLabel={`Seleccionar ${i.referencia}`}
                      />
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="grid h-5 w-5 shrink-0 place-items-center rounded-[4px] border text-[10.5px] font-bold"
                          style={abcBadgeStyle(i.clasificacion)}
                        >
                          {i.clasificacion ?? "—"}
                        </span>
                        <div className="min-w-0">
                          <p
                            className="truncate text-sm font-medium"
                            style={{ color: "hsl(var(--foreground))" }}
                          >
                            {i.nombre}
                          </p>
                          <p
                            className="truncate font-mono text-[10.5px]"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            {i.referencia}
                          </p>
                        </div>
                      </div>
                      <span
                        className="text-right font-mono text-sm tabular-nums"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {i.demanda_periodo}
                      </span>
                      <span
                        className="text-right font-mono text-xs tabular-nums"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {i.stock_minimo_actual} → {i.stock_maximo_actual}
                      </span>
                      <span
                        className="text-right font-mono text-sm font-bold tabular-nums"
                        style={{ color: "hsl(var(--primary))" }}
                      >
                        {i.min_sugerido} → {i.max_sugerido}
                      </span>
                      <span className="text-right">
                        {i.ya_configurado && (
                          <span
                            className="rounded-[4px] border px-1.5 py-0.5 text-[10.5px] font-semibold"
                            style={pillStyle("--info")}
                          >
                            Configurado
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Mobile cards */}
              <ul className="md:hidden divide-y" role="list">
                {visibles.map((i) => {
                  const on = seleccion.has(i.producto_id);
                  return (
                    <li
                      key={i.producto_id}
                      className="p-4"
                      style={{
                        borderColor: "hsl(var(--border))",
                        backgroundColor: on
                          ? "hsl(var(--primary) / 0.06)"
                          : "transparent",
                      }}
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <CheckBox
                            checked={on}
                            onClick={() => toggle(i.producto_id)}
                            ariaLabel={`Seleccionar ${i.referencia}`}
                            big
                          />
                          <span
                            className="grid h-6 w-6 shrink-0 place-items-center rounded-md border text-[10.5px] font-bold"
                            style={abcBadgeStyle(i.clasificacion)}
                          >
                            {i.clasificacion ?? "—"}
                          </span>
                          <div className="min-w-0">
                            <p
                              className="truncate text-sm font-medium"
                              style={{ color: "hsl(var(--foreground))" }}
                            >
                              {i.nombre}
                            </p>
                            <p
                              className="truncate font-mono text-xs"
                              style={{ color: "hsl(var(--muted-foreground))" }}
                            >
                              {i.referencia}
                            </p>
                          </div>
                        </div>
                        {i.ya_configurado && (
                          <span
                            className="shrink-0 rounded-[4px] border px-1.5 py-0.5 text-[10.5px] font-semibold"
                            style={pillStyle("--info")}
                          >
                            Configurado
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        <CardMetric
                          label="Demanda 90d"
                          value={i.demanda_periodo}
                          token="--foreground"
                        />
                        <CardMetric
                          label="Actual"
                          value={`${i.stock_minimo_actual}→${i.stock_maximo_actual}`}
                          token="--muted-foreground"
                        />
                        <CardMetric
                          label="Sugerido"
                          value={`${i.min_sugerido}→${i.max_sugerido}`}
                          token="--primary"
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        {/* Footer sticky */}
        <div
          className="flex items-center justify-between gap-3 border-t px-5 py-3"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--muted) / 0.3)",
          }}
        >
          <span
            className="font-mono text-[12px] font-semibold tabular-nums"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {seleccionados.length} seleccionados
          </span>
          <button
            disabled={seleccionados.length === 0 || aplicando}
            onClick={aplicar}
            className="inline-flex h-12 items-center gap-1.5 rounded-md px-4 text-[12.5px] font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed"
            style={
              seleccionados.length === 0 || aplicando
                ? {
                    border: "1px solid hsl(var(--border))",
                    backgroundColor: "hsl(var(--card))",
                    color: "hsl(var(--muted-foreground))",
                    opacity: 0.7,
                  }
                : {
                    backgroundColor: "hsl(var(--primary))",
                    color: "hsl(var(--primary-foreground))",
                  }
            }
          >
            <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
            Aplicar seleccionados
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Checkbox accesible con tokens semánticos ──────────────────────────── */
function CheckBox({ checked, indeterminate, onClick, ariaLabel, big }) {
  const size = big ? "h-6 w-6" : "h-4 w-4";
  const active = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`grid ${size} shrink-0 place-items-center rounded-[3px] border transition-colors cursor-pointer`}
      style={{
        borderColor: active ? "hsl(var(--primary))" : "hsl(var(--border))",
        backgroundColor: checked
          ? "hsl(var(--primary))"
          : indeterminate
            ? "hsl(var(--primary) / 0.15)"
            : "transparent",
        color: checked
          ? "hsl(var(--primary-foreground))"
          : "hsl(var(--primary))",
      }}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={2.5} />}
      {indeterminate && !checked && (
        <span
          className="h-0.5 w-2 rounded-full"
          style={{ backgroundColor: "hsl(var(--primary))" }}
        />
      )}
    </button>
  );
}

/* ── Segmented control (estilo Dashboard admin) ───────────────────────── */
function Seg({ options, value, onChange, labelOf }) {
  return (
    <div
      className="inline-flex flex-wrap gap-px rounded-[7px] border p-0.5"
      style={{
        borderColor: "hsl(var(--border))",
        backgroundColor: "hsl(var(--muted) / 0.4)",
      }}
    >
      {options.map((opt) => {
        const on = opt === value;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className="rounded-[5px] px-2.5 py-1.5 text-[12px] transition-colors cursor-pointer"
            style={{
              backgroundColor: on ? "hsl(var(--card))" : "transparent",
              color: on
                ? "hsl(var(--foreground))"
                : "hsl(var(--muted-foreground))",
              fontWeight: on ? 600 : 500,
              boxShadow: on ? "0 1px 2px rgba(16,24,40,0.06)" : "none",
            }}
          >
            {labelOf ? labelOf(opt) : opt}
          </button>
        );
      })}
    </div>
  );
}

/* ── Banner de estado (error/éxito) con tokens semánticos ─────────────── */
function Banner({ type, children }) {
  return (
    <div
      role={type === "destructive" ? "alert" : "status"}
      className="mb-3 rounded-lg border px-3 py-2 text-xs"
      style={{
        backgroundColor: `hsl(var(--${type}) / 0.08)`,
        borderColor: `hsl(var(--${type}) / 0.4)`,
        color: `hsl(var(--${type}))`,
      }}
    >
      {children}
    </div>
  );
}

function CardMetric({ label, value, token }) {
  return (
    <div>
      <p style={{ color: "hsl(var(--muted-foreground))" }}>{label}</p>
      <p
        className="font-bold tabular-nums"
        style={{ color: `hsl(var(${token}))` }}
      >
        {value}
      </p>
    </div>
  );
}

/* ── KPI con separadores punteados ────────────────────────────────────── */
function Kpi({ label, value, sub, token, last }) {
  return (
    <div
      className={`flex flex-col gap-1.5 pr-7 md:pl-7 md:first:pl-0 ${
        last ? "" : "md:border-r md:border-dashed"
      }`}
      style={last ? undefined : { borderColor: "hsl(var(--border))" }}
    >
      <div
        className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </div>
      <div
        className="font-mono text-[22px] font-semibold leading-tight tracking-[-0.02em] tabular-nums"
        style={{
          color: token ? `hsl(var(${token}))` : "hsl(var(--foreground))",
        }}
      >
        {value}
      </div>
      <div
        className="text-[11.5px]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {sub}
      </div>
    </div>
  );
}

function Empty({ icon, children }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-5xl mb-3">{icon}</div>
      <p style={{ color: "hsl(var(--muted-foreground))" }}>{children}</p>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-xl border"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        />
      ))}
    </div>
  );
}
