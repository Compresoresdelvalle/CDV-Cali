import { useState, useEffect, useRef } from "react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatDate, sanitizeSearch, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import { useConfirm } from "../../components/ui/ConfirmDialog";

export default function Conteo() {
  const perfil = useAuthStore((s) => s.perfil);
  const isAdmin = perfil?.rol === "Admin";

  const [conteos, setConteos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [filtro, setFiltro] = useState("Pendientes");
  const [modalNuevo, setModalNuevo] = useState(false);
  const [aplicandoId, setAplicandoId] = useState(null);
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
      let q = supabase
        .from("conteos")
        .select(
          `id, fecha, stock_sistema, stock_fisico, diferencia, ajuste_aplicado, observaciones, sede_id,
           producto:producto_id(referencia, nombre),
           sede:sede_id(nombre),
           contador:contado_por(nombre),
           aprobador:aprobado_por(nombre)`,
        )
        .order("fecha", { ascending: false })
        .limit(100);
      if (filtro === "Pendientes") q = q.eq("ajuste_aplicado", false);
      if (filtro === "Aplicados") q = q.eq("ajuste_aplicado", true);

      const { data, error } = await q;
      if (!mountedRef.current) return;
      if (error) throw error;
      setConteos(data ?? []);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar conteos"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
  }, [filtro]);

  const aplicarAjuste = async (conteo) => {
    const ok = await confirm({
      titulo: "Aplicar ajuste de inventario",
      mensaje: `Stock sistema: ${conteo.stock_sistema} → físico: ${conteo.stock_fisico} (diferencia: ${conteo.diferencia > 0 ? "+" : ""}${conteo.diferencia}). Se registrará un movimiento conteo_ajuste.`,
      confirmLabel: "Aplicar ajuste",
      danger: conteo.diferencia < 0,
    });
    if (!ok) return;
    setAplicandoId(conteo.id);
    setErrorMsg("");
    setOkMsg("");
    try {
      const { error } = await supabase.rpc("fn_aplicar_ajuste_conteo", {
        p_conteo_id: conteo.id,
      });
      if (error) throw error;
      setOkMsg("Ajuste aplicado correctamente");
      await cargar();
    } catch (err) {
      setErrorMsg(safeError(err, "Error al aplicar ajuste"));
    } finally {
      setAplicandoId(null);
    }
  };

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Conteo cíclico"
        description={loading ? "Cargando…" : `${conteos.length} registros`}
        actions={
          <button
            onClick={() => setModalNuevo(true)}
            className="h-9 px-4 rounded-lg text-sm font-medium cursor-pointer"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            + Nuevo conteo
          </button>
        }
      />

      {errorMsg && <Banner type="destructive">{errorMsg}</Banner>}
      {okMsg && <Banner type="success">{okMsg}</Banner>}

      <div className="flex gap-2">
        {["Todos", "Pendientes", "Aplicados"].map((f) => (
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

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="rounded-xl p-4 animate-pulse border h-20"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            />
          ))}
        </div>
      ) : conteos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-5xl mb-3">📋</div>
          <p style={{ color: "hsl(var(--muted-foreground))" }}>
            Sin conteos {filtro.toLowerCase()}
          </p>
        </div>
      ) : (
        <ul className="space-y-2" role="list">
          {conteos.map((c) => (
            <li
              key={c.id}
              className="rounded-lg border p-3"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p
                      className="text-sm font-semibold"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {c.producto?.nombre}
                    </p>
                    <span
                      className="text-xs font-mono"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {c.producto?.referencia}
                    </span>
                    {c.ajuste_aplicado ? (
                      <span
                        className="px-2 py-0.5 rounded text-xs font-medium"
                        style={{
                          backgroundColor: "hsl(var(--success) / 0.15)",
                          color: "hsl(var(--success))",
                        }}
                      >
                        Aplicado
                      </span>
                    ) : (
                      <span
                        className="px-2 py-0.5 rounded text-xs font-medium"
                        style={{
                          backgroundColor: "hsl(var(--warning) / 0.15)",
                          color: "hsl(var(--warning))",
                        }}
                      >
                        Pendiente
                      </span>
                    )}
                  </div>
                  <p
                    className="text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {c.sede?.nombre ?? c.sede_id} · {formatDate(c.fecha)} ·
                    Contó: {c.contador?.nombre}
                    {c.aprobador && ` · Aprobó: ${c.aprobador.nombre}`}
                  </p>
                  {c.observaciones && (
                    <p
                      className="text-xs italic mt-0.5"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {c.observaciones}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-center">
                    <p
                      className="text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      Sistema
                    </p>
                    <p
                      className="text-sm font-bold tabular-nums"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {c.stock_sistema}
                    </p>
                  </div>
                  <div className="text-center">
                    <p
                      className="text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      Físico
                    </p>
                    <p
                      className="text-sm font-bold tabular-nums"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {c.stock_fisico}
                    </p>
                  </div>
                  <div className="text-center">
                    <p
                      className="text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      Dif
                    </p>
                    <p
                      className="text-sm font-bold tabular-nums"
                      style={{
                        color:
                          c.diferencia === 0
                            ? "hsl(var(--success))"
                            : c.diferencia > 0
                              ? "hsl(var(--info))"
                              : "hsl(var(--destructive))",
                      }}
                    >
                      {c.diferencia > 0 ? "+" : ""}
                      {c.diferencia}
                    </p>
                  </div>
                  {!c.ajuste_aplicado && isAdmin && (
                    <button
                      onClick={() => aplicarAjuste(c)}
                      disabled={aplicandoId === c.id}
                      className="text-xs px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
                      style={{
                        backgroundColor: "hsl(var(--primary))",
                        color: "hsl(var(--primary-foreground))",
                      }}
                    >
                      {aplicandoId === c.id ? "..." : "Aplicar"}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {modalNuevo && (
        <ModalNuevoConteo
          perfil={perfil}
          onClose={() => setModalNuevo(false)}
          onSaved={async () => {
            setModalNuevo(false);
            setOkMsg("Conteo registrado");
            await cargar();
          }}
        />
      )}
      <ConfirmDialog />
    </div>
  );
}

function ModalNuevoConteo({ perfil, onClose, onSaved }) {
  const [search, setSearch] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [productoSel, setProductoSel] = useState(null);
  const [stockSistema, setStockSistema] = useState(0);
  const [stockFisico, setStockFisico] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Búsqueda
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
          .select(
            `id, referencia, nombre, inventario:inventario(id, cantidad, sede_id)`,
          )
          .eq("activo", true)
          .or(`referencia.ilike.%${q}%,nombre.ilike.%${q}%`)
          .limit(10);
        if (ac.signal.aborted) return;
        if (error) throw error;
        setResultados(data ?? []);
      } catch (err) {
        if (!ac.signal.aborted) setError(safeError(err, "Error buscando"));
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [search, productoSel]);

  const seleccionar = (p) => {
    const inv = (p.inventario ?? []).find((i) => i.sede_id === perfil?.sede_id);
    if (!inv) {
      // Producto no tiene fila inventario en la sede del usuario.
      // Avisamos al operario en vez de continuar con stock=0 silencioso.
      setError(
        `"${p.nombre}" no tiene inventario en tu sede. Pídele a un Admin que lo agregue antes de contar.`,
      );
      return;
    }
    setError("");
    setProductoSel({ ...p, inventario_id: inv.id });
    setStockSistema(inv.cantidad ?? 0);
    setSearch("");
    setResultados([]);
  };

  const guardar = async () => {
    if (!productoSel) {
      setError("Selecciona un producto");
      return;
    }
    const fisico = parseInt(stockFisico, 10);
    if (isNaN(fisico) || fisico < 0) {
      setError("Stock físico inválido");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // RPC server-side: lee stock_sistema con FOR UPDATE en el momento del
      // insert (anti-race), valida rol Admin/Bodeguero y sede, calcula diferencia.
      const { data, error } = await supabase.rpc("fn_registrar_conteo", {
        p_producto_id: productoSel.id,
        p_stock_fisico: fisico,
        p_observaciones: observaciones.trim() || null,
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error("No se pudo registrar el conteo");
      await onSaved();
    } catch (err) {
      setError(safeError(err, "Error al guardar conteo"));
    } finally {
      setSaving(false);
    }
  };

  const dif = (parseInt(stockFisico, 10) || 0) - stockSistema;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto"
        style={{ backgroundColor: "hsl(var(--card))" }}
      >
        <h2
          className="text-lg font-semibold mb-4"
          style={{ color: "hsl(var(--foreground))" }}
        >
          Nuevo conteo cíclico
        </h2>

        {error && <Banner type="destructive">{error}</Banner>}

        {!productoSel ? (
          <div className="space-y-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar producto por nombre o referencia (mín 2 letras)…"
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
                className="rounded-lg border overflow-hidden max-h-60 overflow-y-auto"
                style={{ borderColor: "hsl(var(--border))" }}
              >
                {resultados.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => seleccionar(p)}
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
                        {p.referencia}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div
              className="rounded-lg border p-3"
              style={{
                backgroundColor: "hsl(var(--muted) / 0.3)",
                borderColor: "hsl(var(--primary))",
              }}
            >
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
              <button
                onClick={() => setProductoSel(null)}
                className="text-xs mt-1 underline cursor-pointer"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Cambiar
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Stock sistema">
                <input
                  type="number"
                  value={stockSistema}
                  disabled
                  className="w-full h-12 px-3 rounded-lg border text-sm tabular-nums"
                  style={{ ...inputStyle, opacity: 0.7 }}
                />
              </Field>
              <Field label="Stock físico contado *">
                <input
                  type="number"
                  min="0"
                  value={stockFisico}
                  onChange={(e) => setStockFisico(e.target.value)}
                  autoFocus
                  className="w-full h-12 px-3 rounded-lg border text-sm tabular-nums font-bold"
                  style={inputStyle}
                />
              </Field>
            </div>

            {stockFisico !== "" && (
              <div
                className="rounded-lg border p-3 text-center"
                style={{
                  backgroundColor:
                    dif === 0
                      ? "hsl(var(--success) / 0.1)"
                      : dif > 0
                        ? "hsl(var(--info) / 0.1)"
                        : "hsl(var(--destructive) / 0.1)",
                  borderColor:
                    dif === 0
                      ? "hsl(var(--success))"
                      : dif > 0
                        ? "hsl(var(--info))"
                        : "hsl(var(--destructive))",
                }}
              >
                <p
                  className="text-xs"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Diferencia
                </p>
                <p
                  className="text-2xl font-bold tabular-nums"
                  style={{
                    color:
                      dif === 0
                        ? "hsl(var(--success))"
                        : dif > 0
                          ? "hsl(var(--info))"
                          : "hsl(var(--destructive))",
                  }}
                >
                  {dif > 0 ? "+" : ""}
                  {dif} uds
                </p>
              </div>
            )}

            <Field label="Observaciones">
              <textarea
                rows={2}
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border text-sm"
                style={inputStyle}
              />
            </Field>

            <div className="flex gap-2 pt-2">
              <button
                onClick={onClose}
                disabled={saving}
                className="flex-1 h-12 rounded-lg text-sm font-medium border cursor-pointer disabled:opacity-50"
                style={{
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={saving || stockFisico === ""}
                className="flex-1 h-12 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
                style={{
                  backgroundColor: "hsl(var(--primary))",
                  color: "hsl(var(--primary-foreground))",
                }}
              >
                {saving ? "Guardando…" : "Registrar conteo"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  backgroundColor: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
  color: "hsl(var(--foreground))",
};

function Field({ label, children }) {
  return (
    <label className="block">
      <span
        className="block text-xs font-medium mb-1.5"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Banner({ type, children }) {
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs mb-3"
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
