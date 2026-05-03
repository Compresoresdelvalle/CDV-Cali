import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import { useConfirm } from "../../components/ui/ConfirmDialog";

export default function AnalisisABC() {
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recalculando, setRecalculando] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [filtro, setFiltro] = useState("Todos");
  const mountedRef = useRef(true);
  const { confirm, ConfirmDialog } = useConfirm();

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
        .from("productos")
        .select(
          "id, referencia, nombre, categoria, clasificacion, precio_venta, costo_promedio",
        )
        .eq("activo", true)
        .order("clasificacion", { ascending: true })
        .order("nombre", { ascending: true });
      if (!mountedRef.current) return;
      if (error) throw error;
      setProductos(data ?? []);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar productos"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const recalcular = async () => {
    const ok = await confirm({
      titulo: "Recalcular clasificación ABC",
      mensaje:
        "Reclasifica TODOS los productos según ventas de los últimos 90 días. Puede tardar varios segundos.",
      confirmLabel: "Recalcular",
    });
    if (!ok) return;
    setRecalculando(true);
    setErrorMsg("");
    setOkMsg("");
    try {
      // Timeout duro 30s — recalcular ABC sobre 3000 productos puede tardar
      const { error } = await Promise.race([
        supabase.rpc("fn_recalcular_abc"),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "Timeout: el recálculo tarda más de 30s, contacta soporte",
                ),
              ),
            30000,
          ),
        ),
      ]);
      if (!mountedRef.current) return;
      if (error) throw error;
      setOkMsg("Clasificación ABC recalculada correctamente");
      await cargar();
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al recalcular"));
    } finally {
      if (mountedRef.current) setRecalculando(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  const filtrados =
    filtro === "Todos"
      ? productos
      : productos.filter((p) => p.clasificacion === filtro);

  const counts = {
    A: productos.filter((p) => p.clasificacion === "A").length,
    B: productos.filter((p) => p.clasificacion === "B").length,
    C: productos.filter((p) => p.clasificacion === "C").length,
  };
  const total = productos.length || 1;
  const pcts = {
    A: ((counts.A / total) * 100).toFixed(1),
    B: ((counts.B / total) * 100).toFixed(1),
    C: ((counts.C / total) * 100).toFixed(1),
  };

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Análisis ABC"
        description={
          loading ? "Cargando…" : `${productos.length} productos clasificados`
        }
        actions={
          <button
            onClick={recalcular}
            disabled={recalculando || loading}
            className="h-9 px-4 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            {recalculando ? "Recalculando…" : "↻ Recalcular ABC"}
          </button>
        }
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
      {okMsg && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: "hsl(var(--success) / 0.08)",
            borderColor: "hsl(var(--success) / 0.4)",
            color: "hsl(var(--success))",
          }}
        >
          {okMsg}
        </div>
      )}

      {/* Resumen ABC */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            k: "A",
            color: "success",
            desc: "Alto valor — requiere control estricto",
          },
          { k: "B", color: "warning", desc: "Valor medio — control moderado" },
          { k: "C", color: "muted", desc: "Bajo valor — control simple" },
        ].map((c) => (
          <button
            key={c.k}
            onClick={() => setFiltro(c.k === filtro ? "Todos" : c.k)}
            className="text-left rounded-xl border p-4 cursor-pointer transition-all"
            style={{
              backgroundColor:
                filtro === c.k
                  ? `hsl(var(--${c.color}) / 0.12)`
                  : "hsl(var(--card))",
              borderColor:
                filtro === c.k
                  ? `hsl(var(--${c.color}))`
                  : "hsl(var(--border))",
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-2xl font-bold"
                style={{ color: `hsl(var(--${c.color}))` }}
              >
                {c.k}
              </span>
              <span
                className="text-2xl font-bold tabular-nums ml-auto"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {counts[c.k]}
              </span>
            </div>
            <p
              className="text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {pcts[c.k]}% del total
            </p>
            <p
              className="text-xs mt-1"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {c.desc}
            </p>
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        {["Todos", "A", "B", "C"].map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer"
            style={
              filtro === f
                ? {
                    backgroundColor: "hsl(var(--primary))",
                    color: "hsl(var(--primary-foreground))",
                    borderColor: "hsl(var(--primary))",
                  }
                : {
                    backgroundColor: "transparent",
                    color: "hsl(var(--muted-foreground))",
                    borderColor: "hsl(var(--border))",
                  }
            }
          >
            {f}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="rounded-xl p-4 animate-pulse border h-14"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            />
          ))}
        </div>
      ) : filtrados.length === 0 ? (
        <p
          className="text-center py-12 text-sm"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Sin productos en categoría {filtro}
        </p>
      ) : (
        <ul className="space-y-1.5" role="list">
          {filtrados.map((p) => (
            <li
              key={p.id}
              className="rounded-lg border px-3 py-2 flex items-center justify-between gap-3"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span
                  className="px-2 py-0.5 rounded text-xs font-bold shrink-0"
                  style={{
                    backgroundColor:
                      p.clasificacion === "A"
                        ? "hsl(var(--success) / 0.2)"
                        : p.clasificacion === "B"
                          ? "hsl(var(--warning) / 0.2)"
                          : "hsl(var(--muted) / 0.4)",
                    color:
                      p.clasificacion === "A"
                        ? "hsl(var(--success))"
                        : p.clasificacion === "B"
                          ? "hsl(var(--warning))"
                          : "hsl(var(--muted-foreground))",
                  }}
                >
                  {p.clasificacion}
                </span>
                <div className="min-w-0">
                  <p
                    className="text-sm font-medium truncate"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {p.nombre}
                  </p>
                  <p
                    className="text-xs font-mono"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {p.referencia} · {p.categoria}
                  </p>
                </div>
              </div>
              <p
                className="text-sm font-bold tabular-nums shrink-0"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {formatCOP(p.precio_venta)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog />
    </div>
  );
}
