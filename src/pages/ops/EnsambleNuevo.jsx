import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftCircle,
  Search,
  Package,
  Hash,
  Layers,
  FileText,
  X,
  Trash2,
  ScanLine,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, sanitizeSearch, safeError } from "../../lib/utils";
import UbicacionChip from "../../components/ui/UbicacionChip";
import QRScanner from "../../components/forms/QRScanner";

/**
 * Nuevo ensamble (rediseño Parte 2 — receta al vuelo, sin BOM).
 *
 * Flujo:
 *  1. Elegir el producto a ensamblar (ensamblable=true).
 *  2. Cantidad a producir.
 *  3. Armar la receta agregando componentes (insumos) y sus cantidades. Los
 *     componentes se consumen del POOL DE INSUMO de la sede; si falta, se puede
 *     convertir desde el stock de venta (avisa al Admin).
 *  4. Completar → el trigger consume insumos, suma el resultado al stock vendible
 *     del compresor y notifica al Admin para revisar precio/costo.
 */
export default function EnsambleNuevo() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin"; // costos visibles solo para Admin
  const sede = perfil?.sede_id;

  // Producto resultado
  const [search, setSearch] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [productoSel, setProductoSel] = useState(null);
  const [cantidadProducida, setCantidadProducida] = useState("1");

  // Técnico asignado (la vendedora elige a quién se le asigna).
  const [tecnicos, setTecnicos] = useState([]);
  const [tecnicoSel, setTecnicoSel] = useState("");

  useEffect(() => {
    let alive = true;
    supabase
      .from("usuarios")
      .select("id, nombre")
      .eq("rol", "Tecnico")
      .eq("activo", true)
      .order("nombre")
      .then(({ data }) => {
        if (alive) setTecnicos(data ?? []);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Componentes (receta al vuelo)
  const [componentes, setComponentes] = useState([]);
  const [compSearch, setCompSearch] = useState("");
  const [compResultados, setCompResultados] = useState([]);
  const [compBuscando, setCompBuscando] = useState(false);
  const [modoGlobal, setModoGlobal] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Conversión venta→insumo de un componente
  const [convComp, setConvComp] = useState(null);
  const [convCant, setConvCant] = useState("1");
  const [convSaving, setConvSaving] = useState(false);
  const [convError, setConvError] = useState("");

  const [observaciones, setObservaciones] = useState("");
  const [creando, setCreando] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [aviso, setAviso] = useState("");
  const creandoRef = useRef(false);

  // Buscar producto resultado (ensamblable=true)
  useEffect(() => {
    const q = sanitizeSearch(search);
    if (q.length < 2 || productoSel) {
      setResultados([]);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const { data, error } = await supabase
          .from("productos")
          .select("id, referencia, nombre, precio_venta")
          .eq("activo", true)
          .eq("ensamblable", true)
          .or(`referencia.ilike.%${q}%,nombre.ilike.%${q}%`)
          .limit(1000);
        if (ac.signal.aborted) return;
        if (error) throw error;
        setResultados(data ?? []);
      } catch (err) {
        if (!ac.signal.aborted)
          setErrorMsg(safeError(err, "Error al buscar productos"));
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [search, productoSel]);

  // Buscar componentes (insumos por defecto / inventario global)
  useEffect(() => {
    const q = sanitizeSearch(compSearch);
    if (q.length < 2 || !sede) {
      setCompResultados([]);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setCompBuscando(true);
      try {
        const { data: prods, error: e1 } = await supabase
          .from("productos")
          .select("id, referencia, nombre, costo_promedio, vendible")
          .eq("activo", true)
          .or(`referencia.ilike.%${q}%,nombre.ilike.%${q}%`)
          .limit(1000);
        if (ac.signal.aborted) return;
        if (e1) throw e1;
        if (!prods?.length) {
          setCompResultados([]);
          return;
        }
        const ids = prods.map((p) => p.id);
        const { data: inv, error: e2 } = await supabase
          .from("inventario")
          .select("producto_id, cantidad, cantidad_insumo, ubicacion_id")
          .in("producto_id", ids)
          .eq("sede_id", sede);
        if (ac.signal.aborted) return;
        if (e2) throw e2;
        const byProd = new Map();
        (inv ?? []).forEach((r) => byProd.set(r.producto_id, r));
        const enriched = prods.map((p) => ({
          ...p,
          insumo: byProd.get(p.id)?.cantidad_insumo ?? 0,
          venta: byProd.get(p.id)?.cantidad ?? 0,
          ubicacion_id: byProd.get(p.id)?.ubicacion_id ?? null,
        }));
        // "Solo insumos": designados (vendible=false) o con stock de insumo.
        const visibles = modoGlobal
          ? enriched
          : enriched.filter((p) => p.vendible === false || (p.insumo ?? 0) > 0);
        setCompResultados(visibles);
      } catch (err) {
        // ENS-05: este catch era silencioso — el operario veía "sin resultados"
        // cuando en realidad la búsqueda había fallado.
        if (!ac.signal.aborted)
          setErrorMsg(safeError(err, "Error al buscar componentes"));
      } finally {
        setCompBuscando(false);
      }
    }, 300);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [compSearch, sede, modoGlobal]);

  const agregarComponente = (p) => {
    setErrorMsg("");
    setAviso("");
    setCompSearch("");
    setCompResultados([]);
    if (componentes.some((c) => c.id === p.id)) return;
    setComponentes((cs) => [
      ...cs,
      {
        id: p.id,
        referencia: p.referencia,
        nombre: p.nombre,
        costo_unitario: p.costo_promedio ?? 0,
        cantidad: 1,
        insumo: p.insumo ?? 0,
        venta: p.venta ?? 0,
      },
    ]);
  };

  const setCompCantidad = (id, val) => {
    const n = Math.max(1, parseInt(val, 10) || 1);
    setComponentes((cs) =>
      cs.map((c) => (c.id === id ? { ...c, cantidad: n } : c)),
    );
  };
  const quitarComponente = (id) =>
    setComponentes((cs) => cs.filter((c) => c.id !== id));

  const abrirConversion = (c) => {
    const deficit = Math.max(1, c.cantidad - (c.insumo ?? 0));
    setConvComp(c);
    setConvCant(String(deficit));
    setConvError("");
  };

  const convertir = async () => {
    if (!convComp) return;
    setConvError("");
    const n = Number(convCant);
    if (!Number.isInteger(n) || n < 1) {
      setConvError("La cantidad debe ser un entero mayor a 0");
      return;
    }
    if (n > (convComp.venta ?? 0)) {
      setConvError(`Máximo de venta disponible: ${convComp.venta ?? 0}`);
      return;
    }
    setConvSaving(true);
    try {
      const { data, error } = await supabase.rpc("fn_convertir_a_insumo", {
        p_producto_id: convComp.id,
        p_sede_id: sede,
        p_cantidad: n,
      });
      if (error) throw error;
      setComponentes((cs) =>
        cs.map((c) =>
          c.id === convComp.id
            ? {
                ...c,
                insumo: (c.insumo ?? 0) + n,
                venta: (c.venta ?? 0) - n,
              }
            : c,
        ),
      );
      setConvComp(null);
      setAviso(
        data?.notificado_admin
          ? "Convertido a insumo. Se notificó al Admin."
          : "Convertido a insumo.",
      );
    } catch (err) {
      setConvError(safeError(err, "Error al convertir a insumo"));
    } finally {
      setConvSaving(false);
    }
  };

  const cantProd = Math.min(
    9999,
    Math.max(1, parseInt(cantidadProducida, 10) || 1),
  );
  const costoEstimado = componentes.reduce(
    (s, c) => s + c.costo_unitario * c.cantidad,
    0,
  );
  const faltantes = componentes.filter((c) => c.cantidad > (c.insumo ?? 0));
  // Técnico OPCIONAL (decisión del dueño): si Pedro el bodeguero arma solo,
  // no tiene por qué existir un Técnico activo para poder ensamblar.
  const puedeCrear =
    !!productoSel && componentes.length > 0 && faltantes.length === 0;

  // ENS-01 UX: cambiar el producto a ensamblar descarta la receta armada — la
  // receta era del producto anterior y dejarla puesta induce a ensamblar el
  // producto nuevo con los componentes del viejo.
  const cambiarProducto = () => {
    setProductoSel(null);
    setComponentes([]);
    setCompSearch("");
    setCompResultados([]);
    if (componentes.length > 0) {
      setAviso("Se limpió la receta: era del producto anterior.");
    }
  };

  // QR de componentes: agrega el producto escaneado con su stock real en la sede.
  const handleQRFound = async (productoId) => {
    setScannerOpen(false);
    if (!sede) return;
    try {
      const [{ data: prod }, { data: inv }] = await Promise.all([
        supabase
          .from("productos")
          .select("id, referencia, nombre, costo_promedio, vendible")
          .eq("id", productoId)
          .eq("activo", true)
          .single(),
        supabase
          .from("inventario")
          .select("cantidad, cantidad_insumo, ubicacion_id")
          .eq("sede_id", sede)
          .eq("producto_id", productoId)
          .maybeSingle(),
      ]);
      if (!prod) {
        setErrorMsg("El producto escaneado no existe o está inactivo.");
        return;
      }
      setErrorMsg("");
      agregarComponente({
        ...prod,
        insumo: inv?.cantidad_insumo ?? 0,
        venta: inv?.cantidad ?? 0,
        ubicacion_id: inv?.ubicacion_id ?? null,
      });
    } catch {
      setErrorMsg("No se pudo leer el producto escaneado. Reintenta.");
    }
  };

  // Crea el ensamble EN PROCESO: los insumos se restan al insertar el detalle
  // (vía trigger). NO se completa aquí — eso lo hará la vendedora tras el "terminado"
  // del técnico, desde el detalle del ensamble.
  const crearEnsamble = async () => {
    if (!puedeCrear || creando) return;
    if (creandoRef.current) return;
    creandoRef.current = true;
    setCreando(true);
    setErrorMsg("");
    try {
      const { data: ens, error: e1 } = await supabase
        .from("ensambles")
        .insert({
          producto_resultado_id: productoSel.id,
          cantidad_producida: cantProd,
          realizado_por: perfil?.id,
          tecnico_id: tecnicoSel,
          sede_id: sede,
          observaciones: observaciones.trim() || null,
          completado: false,
          terminado: false,
        })
        .select("id")
        .single();
      if (e1) throw e1;

      const detalles = componentes.map((c) => ({
        ensamble_id: ens.id,
        producto_id: c.id,
        cantidad: c.cantidad,
        costo_unitario: c.costo_unitario,
      }));
      const { error: e2 } = await supabase
        .from("detalle_ensamble")
        .insert(detalles);
      if (e2) {
        await supabase.from("ensambles").delete().eq("id", ens.id);
        throw e2;
      }

      navigate(`/ops/ensambles/${ens.id}`);
    } catch (err) {
      setErrorMsg(safeError(err, "Error al crear el ensamble"));
    } finally {
      setCreando(false);
      creandoRef.current = false;
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4 px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      <button
        onClick={() => navigate("/ops/ensambles")}
        className="back-btn inline-flex items-center gap-1.5"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver a Ensambles
      </button>

      <div className="border-b pb-4" style={{ borderColor: "var(--n-100)" }}>
        <div className="ph-eyebrow">Nuevo ensamble</div>
        <h1 className="ph-client" style={{ marginBottom: 0 }}>
          Registrar ensamble
        </h1>
        <p className="ph-sub mt-1.5">
          Elige el producto, arma la receta con insumos y completa.
        </p>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-[10px] border px-4 py-3 text-sm"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
            color: "var(--dang-700)",
          }}
        >
          {errorMsg}
        </div>
      )}
      {aviso && (
        <div
          className="rounded-[10px] border px-4 py-3 text-sm"
          style={{
            backgroundColor: "var(--succ-50)",
            borderColor: "var(--succ-500)",
            color: "var(--succ-700)",
          }}
        >
          {aviso}
        </div>
      )}

      {/* Paso 1: producto a ensamblar */}
      <div className="iblock">
        <div className="ib-head">
          <div className="ib-ico">
            <Package className="h-3.5 w-3.5" strokeWidth={1.7} />
          </div>
          <div className="ib-title">1 · Producto a ensamblar</div>
        </div>
        {!productoSel ? (
          <div className="space-y-2">
            <div
              className="flex h-12 items-center gap-2.5 rounded-lg border px-3.5"
              style={{
                borderColor: "var(--n-200)",
                backgroundColor: "var(--n-0)",
              }}
            >
              <Search
                className="h-4 w-4 shrink-0"
                strokeWidth={1.5}
                style={{ color: "var(--n-500)" }}
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar compresor / ensamblable (mín 2 letras)…"
                className="min-w-0 flex-1 border-none bg-transparent text-sm outline-none"
                style={{ color: "var(--n-950)" }}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  aria-label="Limpiar"
                  className="grid h-6 w-6 place-items-center rounded"
                  style={{ color: "var(--n-500)" }}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
              )}
            </div>
            {buscando && (
              <p className="text-xs" style={{ color: "var(--n-500)" }}>
                Buscando…
              </p>
            )}
            {resultados.length > 0 && (
              <ul
                className="divide-y max-h-80 overflow-y-auto rounded-lg border"
                style={{ borderColor: "var(--n-150)" }}
              >
                {resultados.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => {
                        setProductoSel(p);
                        setSearch("");
                        setResultados([]);
                      }}
                      className="w-full px-3.5 py-3 text-left transition-colors"
                      style={{ backgroundColor: "var(--n-0)" }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = "var(--n-50)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = "var(--n-0)")
                      }
                    >
                      <p
                        className="text-sm font-medium"
                        style={{ color: "var(--n-950)" }}
                      >
                        {p.nombre}
                      </p>
                      <p
                        className="font-mono text-xs"
                        style={{ color: "var(--n-500)" }}
                      >
                        {p.referencia} · {formatCOP(p.precio_venta)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {search.trim().length >= 2 &&
              !buscando &&
              resultados.length === 0 && (
                <div
                  className="rounded-lg border px-3 py-2.5 text-xs leading-relaxed"
                  style={{
                    borderColor: "var(--n-200)",
                    backgroundColor: "var(--n-25)",
                    color: "var(--n-600)",
                  }}
                >
                  No aparece ningún equipo con ese nombre. Solo salen aquí los
                  productos marcados como <b>ensamblables</b>. Si el equipo que
                  buscas no aparece, pídele a un <b>Admin</b> que lo agregue en{" "}
                  <b>Configuración › Equipos ensamblables</b> (puede elegirlo
                  del inventario que ya existe, sin duplicarlo).
                </div>
              )}
          </div>
        ) : (
          <div
            className="flex items-center justify-between gap-3 rounded-lg border px-3.5 py-3"
            style={{
              backgroundColor: "var(--n-25)",
              borderColor: "var(--p-200)",
            }}
          >
            <div className="min-w-0 flex-1">
              <p
                className="text-sm font-semibold"
                style={{ color: "var(--n-950)" }}
              >
                {productoSel.nombre}
              </p>
              <p
                className="font-mono text-xs"
                style={{ color: "var(--n-500)" }}
              >
                {productoSel.referencia}
              </p>
            </div>
            <button
              onClick={cambiarProducto}
              className="rounded-lg border px-3 text-xs font-medium"
              style={{
                height: 48,
                borderColor: "var(--n-200)",
                color: "var(--n-700)",
                backgroundColor: "var(--n-0)",
              }}
            >
              Cambiar
            </button>
          </div>
        )}
      </div>

      {/* Paso 2: cantidad */}
      {productoSel && (
        <div className="iblock">
          <div className="ib-head">
            <div className="ib-ico">
              <Hash className="h-3.5 w-3.5" strokeWidth={1.7} />
            </div>
            <div className="ib-title">2 · Cantidad a producir</div>
          </div>
          <input
            type="number"
            value={cantidadProducida}
            onChange={(e) => setCantidadProducida(e.target.value)}
            min="1"
            step="1"
            className="w-32 rounded-lg border px-3 font-mono text-sm tabular-nums outline-none"
            style={{
              height: 48,
              backgroundColor: "var(--n-0)",
              borderColor: "var(--n-200)",
              color: "var(--n-950)",
            }}
          />
          {cantProd > 1 && (
            <p className="mt-1.5 text-xs" style={{ color: "var(--warn-700)" }}>
              La receta de abajo es el TOTAL de insumos para las {cantProd}{" "}
              unidades, no por unidad.
            </p>
          )}
        </div>
      )}

      {/* Paso 2b: técnico asignado */}
      {productoSel && (
        <div className="iblock">
          <div className="ib-head">
            <div className="ib-ico">
              <Package className="h-3.5 w-3.5" strokeWidth={1.7} />
            </div>
            <div className="ib-title">2b · Técnico asignado (opcional)</div>
          </div>
          <select
            value={tecnicoSel}
            onChange={(e) => setTecnicoSel(e.target.value)}
            className="w-full max-w-xs rounded-lg border px-3 text-sm outline-none"
            style={{
              height: 48,
              backgroundColor: "var(--n-0)",
              borderColor: "var(--n-200)",
              color: "var(--n-950)",
            }}
          >
            <option value="">Sin técnico (lo armo yo)</option>
            {tecnicos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
          {tecnicos.length === 0 && (
            <p className="mt-1 text-xs" style={{ color: "var(--n-500)" }}>
              No hay técnicos activos — el ensamble queda a tu nombre.
            </p>
          )}
        </div>
      )}

      {/* Paso 3: receta al vuelo */}
      {productoSel && (
        <div className="iblock">
          <div className="ib-head">
            <div className="ib-ico">
              <Layers className="h-3.5 w-3.5" strokeWidth={1.7} />
            </div>
            <div className="ib-title">3 · Insumos de la receta</div>
            {componentes.length > 0 && (
              <div className="ib-aux">{componentes.length} comp.</div>
            )}
          </div>

          {/* Buscador de componentes */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div
                className="flex h-12 flex-1 items-center gap-2.5 rounded-lg border px-3.5"
                style={{
                  borderColor: "var(--n-200)",
                  backgroundColor: "var(--n-0)",
                }}
              >
                <Search
                  className="h-4 w-4 shrink-0"
                  strokeWidth={1.5}
                  style={{ color: "var(--n-500)" }}
                />
                <input
                  type="text"
                  value={compSearch}
                  onChange={(e) => setCompSearch(e.target.value)}
                  placeholder="Agregar insumo por nombre o referencia (mín 2)…"
                  className="min-w-0 flex-1 border-none bg-transparent text-sm outline-none"
                  style={{ color: "var(--n-950)" }}
                />
                {compSearch && (
                  <button
                    onClick={() => setCompSearch("")}
                    aria-label="Limpiar"
                    className="grid h-6 w-6 place-items-center rounded"
                    style={{ color: "var(--n-500)" }}
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border transition-colors"
                style={{
                  borderColor: "var(--n-200)",
                  backgroundColor: "var(--n-0)",
                  color: "var(--n-700)",
                }}
                aria-label="Escanear componente por QR"
              >
                <ScanLine className="h-5 w-5" strokeWidth={1.8} />
              </button>
            </div>

            {/* Toggle solo insumos / global */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setModoGlobal(false)}
                className="rounded-md px-2.5 py-1 font-medium"
                style={{
                  backgroundColor: !modoGlobal
                    ? "var(--p-700)"
                    : "var(--n-100)",
                  color: !modoGlobal ? "#fff" : "var(--n-500)",
                }}
              >
                Solo insumos
              </button>
              <button
                type="button"
                onClick={() => setModoGlobal(true)}
                className="rounded-md px-2.5 py-1 font-medium"
                style={{
                  backgroundColor: modoGlobal ? "var(--p-700)" : "var(--n-100)",
                  color: modoGlobal ? "#fff" : "var(--n-500)",
                }}
              >
                Inventario global
              </button>
              <span style={{ color: "var(--n-500)" }}>
                {modoGlobal
                  ? "Todo el inventario (al agregar, convierte a insumo)"
                  : "Solo insumos (agrega aunque tenga 0 y conviértelo)"}
              </span>
            </div>

            {compBuscando && (
              <p className="text-xs" style={{ color: "var(--n-500)" }}>
                Buscando…
              </p>
            )}
            {compResultados.length > 0 && (
              <ul
                className="max-h-56 divide-y overflow-y-auto rounded-lg border"
                style={{ borderColor: "var(--n-150)" }}
              >
                {compResultados.map((p) => {
                  const yaEsta = componentes.some((c) => c.id === p.id);
                  return (
                    <li key={p.id}>
                      <button
                        onClick={() => !yaEsta && agregarComponente(p)}
                        disabled={yaEsta}
                        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors disabled:opacity-40"
                        style={{ backgroundColor: "var(--n-0)" }}
                      >
                        <div className="min-w-0 flex-1">
                          <p
                            className="flex items-center gap-1.5 truncate text-sm font-medium"
                            style={{ color: "var(--n-950)" }}
                          >
                            {p.nombre}
                            <UbicacionChip codigo={p.ubicacion_id} />
                          </p>
                          <p
                            className="font-mono text-xs"
                            style={{ color: "var(--n-500)" }}
                          >
                            {p.referencia} ·{" "}
                            <span
                              style={{
                                color:
                                  (p.insumo ?? 0) > 0
                                    ? "var(--succ-700)"
                                    : "var(--n-500)",
                              }}
                            >
                              Insumo: {p.insumo ?? 0}
                            </span>
                            {(p.insumo ?? 0) < 1 && (
                              <span style={{ color: "var(--warn-700)" }}>
                                {" "}
                                · venta: {p.venta ?? 0}
                              </span>
                            )}
                          </p>
                        </div>
                        <span
                          className="shrink-0 text-xs font-medium"
                          style={{
                            color: yaEsta ? "var(--n-300)" : "var(--p-700)",
                          }}
                        >
                          {yaEsta ? "Agregado" : "+ Agregar"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Lista de componentes agregados */}
          {componentes.length > 0 && (
            <ul className="mt-3 space-y-2" role="list">
              {componentes.map((c) => {
                const ok = c.cantidad <= (c.insumo ?? 0);
                return (
                  <li
                    key={c.id}
                    className="rounded-lg border px-3.5 py-3"
                    style={{
                      backgroundColor: ok ? "var(--succ-50)" : "var(--dang-50)",
                      borderColor: ok
                        ? "var(--succ-500)"
                        : "var(--dang-border)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-sm font-medium"
                          style={{ color: "var(--n-950)" }}
                        >
                          {c.nombre}
                        </p>
                        <p
                          className="font-mono text-xs"
                          style={{ color: "var(--n-500)" }}
                        >
                          {c.referencia}
                          {esAdmin && (
                            <> · {formatCOP(c.costo_unitario)} c/u</>
                          )}{" "}
                          · insumo disp.: {c.insumo ?? 0}
                        </p>
                      </div>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={c.cantidad}
                        onChange={(e) => setCompCantidad(c.id, e.target.value)}
                        className="min-h-[44px] w-20 rounded-lg border px-2 text-center font-mono text-sm tabular-nums outline-none"
                        style={{
                          backgroundColor: "var(--n-0)",
                          borderColor: "var(--n-200)",
                          color: "var(--n-950)",
                        }}
                      />
                      <button
                        onClick={() => quitarComponente(c.id)}
                        aria-label="Quitar"
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-md md:h-9 md:w-9"
                        style={{ color: "var(--dang-700)" }}
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                      </button>
                    </div>
                    {!ok && (
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span
                          className="text-xs"
                          style={{ color: "var(--dang-700)" }}
                        >
                          Faltan {c.cantidad - (c.insumo ?? 0)} de insumo
                          {(c.venta ?? 0) > 0
                            ? ` (venta disp.: ${c.venta})`
                            : " (sin stock de venta — pide traspaso/compra)"}
                        </span>
                        {(c.venta ?? 0) > 0 && (
                          <button
                            onClick={() => abrirConversion(c)}
                            className="rounded-md px-2.5 py-1 text-xs font-medium"
                            style={{
                              backgroundColor: "var(--p-700)",
                              color: "#fff",
                            }}
                          >
                            Convertir a insumo
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Paso 4: observaciones */}
      {productoSel && (
        <div className="iblock">
          <div className="ib-head">
            <div className="ib-ico">
              <FileText className="h-3.5 w-3.5" strokeWidth={1.7} />
            </div>
            <div className="ib-title">4 · Observaciones (opcional)</div>
          </div>
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={2}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              backgroundColor: "var(--n-0)",
              borderColor: "var(--n-200)",
              color: "var(--n-950)",
            }}
          />
        </div>
      )}

      {/* Resumen */}
      {productoSel && componentes.length > 0 && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border p-4"
          style={{ backgroundColor: "var(--n-0)", borderColor: "var(--p-200)" }}
        >
          {/* Costo de materiales: solo Admin */}
          {esAdmin && (
            <div>
              <p
                className="font-mono text-[10px] uppercase tracking-[0.08em]"
                style={{ color: "var(--n-300)" }}
              >
                Costo de materiales
              </p>
              <p
                className="font-mono text-[22px] font-medium tabular-nums"
                style={{ color: "var(--p-700)" }}
              >
                {formatCOP(costoEstimado)}
              </p>
            </div>
          )}
          <p
            className="text-[12.5px] font-medium"
            style={{
              color: puedeCrear ? "var(--succ-700)" : "var(--dang-700)",
            }}
          >
            {faltantes.length > 0
              ? "Faltan insumos — convierte o ajusta cantidades"
              : "Listo para crear (los insumos se reservan al crear)"}
          </p>
        </div>
      )}

      {/* Acciones */}
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={() => navigate("/ops/ensambles")}
          disabled={creando}
          className="flex-1 rounded-lg border text-sm font-medium disabled:opacity-50"
          style={{
            height: 48,
            borderColor: "var(--n-200)",
            color: "var(--n-700)",
            backgroundColor: "var(--n-0)",
          }}
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={crearEnsamble}
          disabled={!puedeCrear || creando}
          className="flex-1 rounded-lg text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ height: 48, backgroundColor: "var(--p-600)" }}
        >
          {creando ? "Procesando…" : "Crear ensamble"}
        </button>
      </div>

      {scannerOpen && (
        <QRScanner
          onFound={handleQRFound}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {/* Modal: convertir venta→insumo de un componente */}
      {convComp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => !convSaving && setConvComp(null)}
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
              Convertir a insumo
            </h3>
            <p className="text-xs" style={{ color: "var(--n-500)" }}>
              <strong>{convComp.nombre}</strong> · insumo:{" "}
              {convComp.insumo ?? 0} · venta disponible: {convComp.venta ?? 0}
            </p>
            <p
              className="rounded-md px-3 py-2 text-xs"
              style={{
                backgroundColor: "var(--warn-50)",
                color: "var(--warn-700)",
              }}
            >
              ¿Seguro que deseas convertir? Al confirmar, se notificará al
              Admin.
            </p>
            {convError && (
              <div
                role="alert"
                className="rounded-lg border px-3 py-2 text-xs"
                style={{
                  backgroundColor: "var(--dang-50)",
                  borderColor: "var(--dang-200)",
                  color: "var(--dang-700)",
                }}
              >
                {convError}
              </div>
            )}
            <div>
              <label className="text-xs" style={{ color: "var(--n-500)" }}>
                Cantidad a convertir (máx. {convComp.venta ?? 0})
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={convCant}
                onChange={(e) => setConvCant(e.target.value)}
                disabled={convSaving}
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
                onClick={() => setConvComp(null)}
                disabled={convSaving}
                className="min-h-[44px] rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
                style={{ borderColor: "var(--n-200)", color: "var(--n-500)" }}
              >
                Cancelar
              </button>
              <button
                onClick={convertir}
                disabled={convSaving}
                className="min-h-[44px] rounded-lg px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: "var(--p-700)" }}
              >
                {convSaving ? "Convirtiendo…" : "Sí, convertir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
