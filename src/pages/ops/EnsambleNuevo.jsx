import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, sanitizeSearch, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";

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
    <div
      className="p-4 sm:p-6 space-y-5 animate-fade-in max-w-3xl"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Nuevo ensamble"
        description="Selecciona producto, verifica componentes y completa"
      />

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

      {/* Paso 1: Selector de producto */}
      <Section titulo="1. Producto a ensamblar">
        {!productoSel ? (
          <>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o referencia (mín 2 letras)…"
              className="w-full h-12 px-3 rounded-lg border text-sm"
              style={inputStyle}
            />
            {buscando && (
              <p
                className="text-xs"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Buscando…
              </p>
            )}
            {resultados.length > 0 && (
              <ul
                className="rounded-lg border overflow-hidden"
                style={{ borderColor: "hsl(var(--border))" }}
              >
                {resultados.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => {
                        setProductoSel(p);
                        setSearch("");
                        setResultados([]);
                      }}
                      className="w-full text-left px-3 py-2.5 cursor-pointer"
                      style={{
                        backgroundColor: "hsl(var(--card))",
                        borderBottom: "1px solid hsl(var(--border) / 0.5)",
                      }}
                    >
                      <p
                        className="text-sm font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {p.nombre}
                      </p>
                      <p
                        className="text-xs font-mono"
                        style={{ color: "hsl(var(--muted-foreground))" }}
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
                <p
                  className="text-xs italic"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Sin productos con BOM que coincidan
                </p>
              )}
          </>
        ) : (
          <div
            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--primary))",
            }}
          >
            <div className="flex-1 min-w-0">
              <p
                className="text-sm font-semibold"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {productoSel.nombre}
              </p>
              <p
                className="text-xs font-mono"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {productoSel.referencia}
              </p>
            </div>
            <button
              onClick={() => {
                setProductoSel(null);
                setBom([]);
              }}
              className="text-xs px-3 py-2 rounded-lg border cursor-pointer"
              style={{
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              Cambiar
            </button>
          </div>
        )}
      </Section>

      {/* Paso 2: Cantidad */}
      {productoSel && (
        <Section titulo="2. Cantidad a producir">
          <input
            type="number"
            value={cantidadProducida}
            onChange={(e) => setCantidadProducida(e.target.value)}
            min="1"
            step="1"
            className="w-32 h-12 px-3 rounded-lg border text-sm tabular-nums"
            style={inputStyle}
          />
        </Section>
      )}

      {/* Paso 3: BOM verde/rojo */}
      {productoSel && (
        <Section titulo="3. Componentes requeridos (BOM)">
          {loadingBom ? (
            <p
              className="text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Cargando BOM…
            </p>
          ) : componentesEnriched.length === 0 ? (
            <p
              className="text-xs italic"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Sin componentes
            </p>
          ) : (
            <ul className="space-y-2" role="list">
              {componentesEnriched.map((c) => (
                <li
                  key={c.componente_id}
                  className="rounded-lg border px-3 py-2.5"
                  style={{
                    backgroundColor: c.ok
                      ? "hsl(var(--success) / 0.06)"
                      : "hsl(var(--destructive) / 0.08)",
                    borderColor: c.ok
                      ? "hsl(var(--success) / 0.4)"
                      : "hsl(var(--destructive) / 0.5)",
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-medium truncate"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {c.nombre}
                      </p>
                      <p
                        className="text-xs font-mono"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {c.referencia} · {formatCOP(c.costo_unitario)} c/u
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className="text-sm font-bold tabular-nums"
                        style={{
                          color: c.ok
                            ? "hsl(var(--success))"
                            : "hsl(var(--destructive))",
                        }}
                      >
                        {c.stock_disponible} / {c.requerido}
                      </p>
                      <p
                        className="text-xs"
                        style={{
                          color: c.ok
                            ? "hsl(var(--success))"
                            : "hsl(var(--destructive))",
                        }}
                      >
                        {c.ok ? "✓ Suficiente" : "✕ Faltan"}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {/* Observaciones */}
      {productoSel && (
        <Section titulo="4. Observaciones (opcional)">
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border text-sm"
            style={inputStyle}
          />
        </Section>
      )}

      {/* Resumen + acción */}
      {productoSel && componentesEnriched.length > 0 && (
        <div
          className="rounded-xl border p-4 flex items-center justify-between gap-3"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--primary))",
          }}
        >
          <div>
            <p
              className="text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Costo estimado
            </p>
            <p
              className="text-xl font-bold tabular-nums"
              style={{ color: "hsl(var(--primary))" }}
            >
              {formatCOP(costoEstimado)}
            </p>
          </div>
          <p
            className="text-xs flex-1 text-center"
            style={{
              color: todoOk ? "hsl(var(--success))" : "hsl(var(--destructive))",
            }}
          >
            {todoOk
              ? "Todos los componentes disponibles"
              : "Faltan componentes — no se puede completar"}
          </p>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={() => navigate("/ops/ensambles")}
          disabled={creando}
          className="flex-1 h-12 rounded-lg text-sm font-medium border cursor-pointer disabled:opacity-50"
          style={{
            borderColor: "hsl(var(--border))",
            color: "hsl(var(--muted-foreground))",
            backgroundColor: "transparent",
          }}
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={completar}
          disabled={!productoSel || !todoOk || creando || loadingBom}
          className="flex-1 h-12 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            backgroundColor: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
          }}
        >
          {creando ? "Procesando…" : "Completar ensamble"}
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  backgroundColor: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
  color: "hsl(var(--foreground))",
};

function Section({ titulo, children }) {
  return (
    <div className="space-y-3">
      <h3
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {titulo}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
