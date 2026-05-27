import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftCircle,
  Search,
  Package,
  Hash,
  Layers,
  FileText,
  Check,
  X,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, sanitizeSearch, safeError } from "../../lib/utils";

export default function EnsambleNuevo() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  // Selector de producto resultado
  const [search, setSearch] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [productoSel, setProductoSel] = useState(null);

  // Cantidad a producir
  const [cantidadProducida, setCantidadProducida] = useState("1");

  // BOM
  const [bom, setBom] = useState([]);
  const [loadingBom, setLoadingBom] = useState(false);

  // Submit
  const [observaciones, setObservaciones] = useState("");
  const [creando, setCreando] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const creandoRef = useRef(false);

  // Buscar producto resultado por nombre/referencia (limitado a productos con BOM definido)
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
        // Una sola query con inner join contra recetas_bom usando la FK
        // producto_resultado_id. Esto evita N+1 y descargar toda la tabla.
        const { data, error } = await supabase
          .from("productos")
          .select(
            `id, referencia, nombre, precio_venta,
             recetas_bom!recetas_bom_producto_resultado_id_fkey!inner(id)`,
          )
          .eq("activo", true)
          .or(`referencia.ilike.%${q}%,nombre.ilike.%${q}%`)
          .limit(10);
        if (ac.signal.aborted) return;
        if (error) throw error;
        // Dedupe: el inner join puede traer duplicados si hay N filas BOM
        const seen = new Set();
        const unique = (data ?? []).filter((p) => {
          if (seen.has(p.id)) return false;
          seen.add(p.id);
          return true;
        });
        setResultados(unique);
      } catch (err) {
        if (!ac.signal.aborted) {
          setErrorMsg(safeError(err, "Error al buscar productos"));
        }
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [search, productoSel]);

  // Al seleccionar producto, cargar BOM + stock actual de cada componente en la sede
  useEffect(() => {
    if (!productoSel || !perfil?.sede_id) {
      setBom([]);
      return;
    }
    const cargarBom = async () => {
      setLoadingBom(true);
      setErrorMsg("");
      const timeout = (p, ms = 15000) =>
        Promise.race([
          p,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout: red lenta")), ms),
          ),
        ]);
      try {
        const { data: receta, error: e1 } = await timeout(
          supabase
            .from("recetas_bom")
            .select(
              `cantidad,
             componente:componente_id(id, referencia, nombre, costo_promedio)`,
            )
            .eq("producto_resultado_id", productoSel.id),
        );
        if (e1) throw e1;
        if (!receta || receta.length === 0) {
          setBom([]);
          setErrorMsg("Este producto no tiene receta BOM definida");
          return;
        }
        // Filtra filas BOM cuyo componente fue eliminado (join devuelve null).
        const recetaValida = receta.filter((r) => r.componente);
        if (recetaValida.length === 0) {
          setBom([]);
          setErrorMsg(
            "La receta BOM referencia componentes inválidos (productos eliminados)",
          );
          return;
        }

        const compIds = recetaValida.map((r) => r.componente.id);
        const { data: inv, error: e2 } = await timeout(
          supabase
            .from("inventario")
            .select("producto_id, cantidad")
            .in("producto_id", compIds)
            .eq("sede_id", perfil.sede_id),
        );
        if (e2) throw e2;

        const stockMap = new Map();
        (inv ?? []).forEach((r) => stockMap.set(r.producto_id, r.cantidad));

        setBom(
          recetaValida.map((r) => ({
            componente_id: r.componente.id,
            referencia: r.componente.referencia,
            nombre: r.componente.nombre,
            costo_unitario: r.componente.costo_promedio ?? 0,
            cantidad_unitaria: r.cantidad,
            stock_disponible: stockMap.get(r.componente.id) ?? 0,
          })),
        );
      } catch (err) {
        setErrorMsg(safeError(err, "Error al cargar BOM"));
      } finally {
        setLoadingBom(false);
      }
    };
    cargarBom();
  }, [productoSel, perfil?.sede_id]);

  const cantProd = Math.min(
    9999,
    Math.max(1, parseInt(cantidadProducida, 10) || 1),
  );

  // Estado de cada componente: requerido vs disponible × cantProd
  const componentesEnriched = bom.map((c) => {
    const requerido = c.cantidad_unitaria * cantProd;
    const ok = c.stock_disponible >= requerido;
    return { ...c, requerido, ok };
  });
  const todoOk =
    componentesEnriched.length > 0 && componentesEnriched.every((c) => c.ok);
  const costoEstimado = componentesEnriched.reduce(
    (s, c) => s + c.costo_unitario * c.requerido,
    0,
  );

  const completar = async () => {
    if (!productoSel || !todoOk || creando) return;
    // Guard síncrono: sin esto, un doble-tap crea DOS ensambles y descuenta
    // stock dos veces (el `creando` de state no frena el segundo tap veloz).
    if (creandoRef.current) return;
    creandoRef.current = true;
    setCreando(true);
    setErrorMsg("");
    try {
      // 1) Crear cabecera de ensamble en estado pendiente
      const { data: ens, error: e1 } = await supabase
        .from("ensambles")
        .insert({
          producto_resultado_id: productoSel.id,
          cantidad_producida: cantProd,
          realizado_por: perfil?.id,
          sede_id: perfil?.sede_id,
          observaciones: observaciones.trim() || null,
          completado: false,
        })
        .select("id")
        .single();
      if (e1) throw e1;

      // 2) Insertar detalle (componentes que se consumirán)
      const detalles = componentesEnriched.map((c) => ({
        ensamble_id: ens.id,
        producto_id: c.componente_id,
        cantidad: c.requerido,
        costo_unitario: c.costo_unitario,
      }));
      const { error: e2 } = await supabase
        .from("detalle_ensamble")
        .insert(detalles);
      if (e2) {
        // Cleanup: si falla detalle, borrar la cabecera para no dejar huérfanos
        const { error: cleanupErr } = await supabase
          .from("ensambles")
          .delete()
          .eq("id", ens.id);
        if (cleanupErr) {
          // Si el cleanup también falla, queda una fila huérfana en `ensambles`
          // con completado=false. No produce pérdida de stock (los triggers solo
          // disparan en completado=true) pero sí ensucia el historial.
          console.error(
            "[EnsambleNuevo] CRITICAL: cleanup falló, ensamble huérfano id=" +
              ens.id,
            cleanupErr,
          );
        }
        throw e2;
      }

      // 3) Marcar completado=true → trigger BD descuenta componentes y suma producto
      const { error: e3 } = await supabase
        .from("ensambles")
        .update({ completado: true })
        .eq("id", ens.id);
      if (e3) throw e3;

      navigate("/ops/ensambles");
    } catch (err) {
      setErrorMsg(safeError(err, "Error al completar ensamble"));
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
          Selecciona producto, verifica componentes y completa.
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

      {/* Paso 1: Selector de producto */}
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
                placeholder="Buscar por nombre o referencia (mín 2 letras)…"
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
                className="divide-y overflow-hidden rounded-lg border"
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
                <p className="text-xs italic" style={{ color: "var(--n-500)" }}>
                  Sin productos con BOM que coincidan
                </p>
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
              onClick={() => {
                setProductoSel(null);
                setBom([]);
              }}
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

      {/* Paso 2: Cantidad */}
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
        </div>
      )}

      {/* Paso 3: BOM verde/rojo */}
      {productoSel && (
        <div className="iblock">
          <div className="ib-head">
            <div className="ib-ico">
              <Layers className="h-3.5 w-3.5" strokeWidth={1.7} />
            </div>
            <div className="ib-title">3 · Componentes requeridos (BOM)</div>
            {componentesEnriched.length > 0 && (
              <div className="ib-aux">{componentesEnriched.length} comp.</div>
            )}
          </div>
          {loadingBom ? (
            <p className="text-xs" style={{ color: "var(--n-500)" }}>
              Cargando BOM…
            </p>
          ) : componentesEnriched.length === 0 ? (
            <p className="text-xs italic" style={{ color: "var(--n-500)" }}>
              Sin componentes
            </p>
          ) : (
            <ul className="space-y-2" role="list">
              {componentesEnriched.map((c) => (
                <li
                  key={c.componente_id}
                  className="rounded-lg border px-3.5 py-3"
                  style={{
                    backgroundColor: c.ok ? "var(--succ-50)" : "var(--dang-50)",
                    borderColor: c.ok
                      ? "var(--succ-border, var(--succ-500))"
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
                        {c.referencia} · {formatCOP(c.costo_unitario)} c/u
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className="font-mono text-sm font-bold tabular-nums"
                        style={{
                          color: c.ok ? "var(--succ-700)" : "var(--dang-700)",
                        }}
                      >
                        {c.stock_disponible} / {c.requerido}
                      </p>
                      <p
                        className="inline-flex items-center gap-1 text-xs"
                        style={{
                          color: c.ok ? "var(--succ-700)" : "var(--dang-700)",
                        }}
                      >
                        {c.ok ? (
                          <>
                            <Check className="h-3 w-3" strokeWidth={2.2} />
                            Suficiente
                          </>
                        ) : (
                          <>
                            <X className="h-3 w-3" strokeWidth={2.2} />
                            Faltan
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Observaciones */}
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
      {productoSel && componentesEnriched.length > 0 && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border p-4"
          style={{ backgroundColor: "var(--n-0)", borderColor: "var(--p-200)" }}
        >
          <div>
            <p
              className="font-mono text-[10px] uppercase tracking-[0.08em]"
              style={{ color: "var(--n-300)" }}
            >
              Costo estimado
            </p>
            <p
              className="font-mono text-[22px] font-medium tabular-nums"
              style={{ color: "var(--p-700)" }}
            >
              {formatCOP(costoEstimado)}
            </p>
          </div>
          <p
            className="text-[12.5px] font-medium"
            style={{
              color: todoOk ? "var(--succ-700)" : "var(--dang-700)",
            }}
          >
            {todoOk
              ? "Todos los componentes disponibles"
              : "Faltan componentes — no se puede completar"}
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
          onClick={completar}
          disabled={!productoSel || !todoOk || creando || loadingBom}
          className="flex-1 rounded-lg text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ height: 48, backgroundColor: "var(--p-600)" }}
          onMouseEnter={(e) => {
            if (productoSel && todoOk && !creando && !loadingBom)
              e.currentTarget.style.backgroundColor = "var(--p-700)";
          }}
          onMouseLeave={(e) =>
            (e.currentTarget.style.backgroundColor = "var(--p-600)")
          }
        >
          {creando ? "Procesando…" : "Completar ensamble"}
        </button>
      </div>
    </div>
  );
}
