import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeftCircle,
  XCircle,
  Package,
  Boxes,
  Info,
  User,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatDate, safeError } from "../../lib/utils";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import { avisarOk, avisarError } from "../../lib/notify";
import { useAuthStore } from "../../stores/authStore";
import {
  devolucionTipoPill,
  devolucionSigno,
  devolucionEstadoClass,
  devolucionEstadoLabel,
} from "../../lib/devoluciones-ui";

// Una sola línea (supabase-js recorta espacios; un salto de línea lo rechazaría
// PostgREST). Tres embeds a `usuarios` (registró / anuló) se desambiguan por la
// columna. `sede:sede_id` trae el nombre legible de la sede.
const COLS =
  "id, numero, fecha, reingresa_stock, cantidad, motivo, observaciones, estado, venta_id, sede_id, anulado_at, motivo_anulacion, producto:producto_id(nombre, referencia), registrador:registrado_por(nombre), anulador:anulado_por(nombre), venta:venta_id(numero), sede:sede_id(nombre)";

export default function DevolucionDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";

  const [dev, setDev] = useState(null);
  const [movs, setMovs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [anulando, setAnulando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const { data, error } = await supabase
        .from("devoluciones")
        .select(COLS)
        .eq("id", id)
        .single();
      if (error || !data) throw new Error("Devolución no encontrada");
      setDev(data);
      // Movimientos ligados: el original de la devolución y, si se anuló, el
      // ajuste compensatorio. Muestra el efecto real en el stock.
      const { data: m } = await supabase
        .from("movimientos")
        .select(
          "tipo, cantidad, stock_anterior, stock_posterior, observaciones, created_at",
        )
        .eq("referencia_id", id)
        .eq("referencia_tipo", "devolucion")
        .order("created_at", { ascending: true });
      setMovs(m ?? []);
    } catch (err) {
      setErrorMsg(safeError(err, "Error al cargar la devolución"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const esCambio = (dev?.motivo ?? "")
    .toLowerCase()
    .startsWith("cambio desde venta");
  const anulable = esAdmin && dev?.estado === "procesada";

  const anular = async () => {
    const ok = await confirm({
      titulo: `Anular devolución #${dev.numero}`,
      mensaje: dev.reingresa_stock
        ? `Se revertirá el reingreso de ${dev.cantidad} unidad(es) de "${
            dev.producto?.nombre ?? "el producto"
          }" al inventario de ${
            dev.sede?.nombre ?? dev.sede_id
          }. Queda registrado y no se puede deshacer.`
        : `Se repondrán ${dev.cantidad} unidad(es) de "${
            dev.producto?.nombre ?? "el producto"
          }" al inventario de ${
            dev.sede?.nombre ?? dev.sede_id
          } (revierte la salida a proveedor). Queda registrado y no se puede deshacer.`,
      confirmLabel: "Sí, anular",
      danger: true,
    });
    if (!ok) return;
    setAnulando(true);
    try {
      const { error } = await supabase.rpc("fn_anular_devolucion", {
        p_devolucion_id: id,
        p_motivo: null,
      });
      if (error) throw error;
      avisarOk(`Devolución #${dev.numero} anulada`);
      await cargar();
    } catch (err) {
      // El backend devuelve el porqué exacto (parte de un cambio, stock
      // insuficiente, ya anulada…). Se muestra tal cual, sin genéricos.
      avisarError(err, "No se pudo anular la devolución");
    } finally {
      setAnulando(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1000px] animate-pulse px-4 py-5 sm:px-7 sm:py-6">
        <div
          className="h-8 w-1/3 rounded-lg"
          style={{ backgroundColor: "var(--n-100)" }}
        />
        <div
          className="mt-4 space-y-3 rounded-[10px] border p-5"
          style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
        >
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-4 w-3/4 rounded"
              style={{ backgroundColor: "var(--n-100)" }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (!dev) {
    return (
      <div className="mx-auto w-full max-w-[1000px] px-4 py-5 sm:px-7 sm:py-6">
        <button
          onClick={() => navigate("/ops/devoluciones")}
          className="back-btn"
        >
          <ArrowLeftCircle className="size-3.5" />
          Volver a Devoluciones
        </button>
        <p className="mt-4 text-sm" style={{ color: "var(--dang-700)" }}>
          {errorMsg || "Devolución no encontrada"}
        </p>
      </div>
    );
  }

  const tipo = devolucionTipoPill(dev.reingresa_stock);
  const signo = devolucionSigno(dev.reingresa_stock);
  const anulada = dev.estado === "anulada";

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 py-5 sm:px-7 sm:py-6">
      {ConfirmDialog}

      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <button
        onClick={() => navigate("/ops/devoluciones")}
        className="back-btn"
      >
        <ArrowLeftCircle className="size-3.5" />
        Volver a Devoluciones
      </button>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1
              className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
              style={{ color: "var(--n-950)" }}
            >
              Devolución #{dev.numero}
            </h1>
            <span className={tipo.cls}>
              <span className="dot" />
              {tipo.label}
            </span>
            <span className={devolucionEstadoClass(dev.estado)}>
              <span className="dot" />
              {devolucionEstadoLabel(dev.estado)}
            </span>
          </div>
          <p className="mt-1.5 text-[13px]" style={{ color: "var(--n-500)" }}>
            {formatDate(dev.fecha)} · {dev.sede?.nombre ?? dev.sede_id}
          </p>
        </div>

        {anulable && (
          <button
            onClick={anular}
            disabled={anulando}
            className="btn btn-out shrink-0 disabled:opacity-50"
            style={{ height: 44, color: "var(--dang-700)" }}
          >
            <XCircle className="h-4 w-4" strokeWidth={2} />
            {anulando ? "Anulando…" : "Anular devolución"}
          </button>
        )}
      </div>

      {/* ── Avisos ──────────────────────────────────────────────────── */}
      {anulada && (
        <div
          role="status"
          className="mt-4 rounded-[10px] border px-4 py-3 text-sm"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
            color: "var(--dang-700)",
          }}
        >
          <b>Devolución anulada.</b>
          {dev.anulado_at ? ` El ${formatDate(dev.anulado_at)}` : ""}
          {dev.anulador?.nombre ? ` por ${dev.anulador.nombre}` : ""}.
          {dev.motivo_anulacion ? ` Motivo: ${dev.motivo_anulacion}` : ""} El
          efecto en el inventario ya fue revertido.
        </div>
      )}

      {!anulada && esCambio && (
        <div
          className="mt-4 flex items-start gap-2 rounded-[10px] border px-4 py-3 text-sm"
          style={{
            backgroundColor: "var(--n-25)",
            borderColor: "var(--n-150)",
            color: "var(--n-700)",
          }}
        >
          <Info
            className="mt-0.5 h-4 w-4 shrink-0"
            style={{ color: "var(--p-600)" }}
          />
          <span>
            Esta devolución es parte de un <b>cambio de producto</b>
            {dev.venta?.numero ? ` de la venta V-${dev.venta.numero}` : ""}.
            Para revertirla no se anula aquí: se anula la venta del cambio desde
            Ventas, y así también se ajusta el producto entregado a cambio.
          </span>
        </div>
      )}

      {/* ── Contenido ───────────────────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Producto y cantidad */}
        <Card icon={Package} titulo="Producto">
          <p
            className="text-[15px] font-semibold leading-tight"
            style={{ color: "var(--n-950)" }}
          >
            {dev.producto?.nombre ?? "—"}
          </p>
          {dev.producto?.referencia && (
            <p
              className="mt-0.5 font-mono text-[12px]"
              style={{ color: "var(--n-500)" }}
            >
              {dev.producto.referencia}
            </p>
          )}
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-[11px]" style={{ color: "var(--n-500)" }}>
              Cantidad
            </span>
            <span
              className="font-mono text-[20px] font-semibold tabular-nums"
              style={{
                color: dev.reingresa_stock
                  ? "var(--succ-700)"
                  : "var(--warn-700)",
              }}
            >
              {signo}
              {dev.cantidad}
            </span>
          </div>
        </Card>

        {/* Origen y registro */}
        <Card icon={User} titulo="Origen">
          <Fila label="Tipo" valor={tipo.label} />
          {dev.reingresa_stock && (
            <Fila
              label="Venta origen"
              valor={dev.venta?.numero ? `V-${dev.venta.numero}` : "—"}
            />
          )}
          <Fila label="Sede" valor={dev.sede?.nombre ?? dev.sede_id} />
          <Fila label="Registró" valor={dev.registrador?.nombre ?? "—"} />
          <Fila label="Fecha" valor={formatDate(dev.fecha)} />
        </Card>

        {/* Motivo */}
        <Card icon={Info} titulo="Motivo y observaciones" full>
          <p className="text-[13.5px]" style={{ color: "var(--n-700)" }}>
            {dev.motivo || "—"}
          </p>
          {dev.observaciones && (
            <p className="mt-2 text-[12.5px]" style={{ color: "var(--n-500)" }}>
              {dev.observaciones}
            </p>
          )}
        </Card>

        {/* Impacto en inventario */}
        <Card icon={Boxes} titulo="Impacto en inventario" full>
          <p className="text-[12.5px]" style={{ color: "var(--n-500)" }}>
            {dev.reingresa_stock
              ? "Devolución de cliente: reingresó el producto al stock."
              : "Devolución a proveedor: sacó el producto del stock."}
          </p>
          {movs.length === 0 ? (
            <p className="mt-2 text-[12.5px]" style={{ color: "var(--n-400)" }}>
              Sin movimientos registrados.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {movs.map((m, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-[8px] border px-3 py-2 text-[12.5px]"
                  style={{
                    borderColor: "var(--n-150)",
                    backgroundColor: "var(--n-25)",
                  }}
                >
                  <span style={{ color: "var(--n-700)" }}>
                    {m.observaciones ||
                      (m.tipo === "ajuste" ? "Ajuste" : "Devolución")}
                  </span>
                  <span
                    className="whitespace-nowrap font-mono tabular-nums"
                    style={{ color: "var(--n-500)" }}
                  >
                    {m.stock_anterior} →{" "}
                    <b style={{ color: "var(--n-950)" }}>{m.stock_posterior}</b>
                    <span
                      className="ml-2"
                      style={{
                        color:
                          Number(m.cantidad) >= 0
                            ? "var(--succ-700)"
                            : "var(--warn-700)",
                      }}
                    >
                      ({Number(m.cantidad) >= 0 ? "+" : "−"}
                      {Math.abs(Number(m.cantidad))})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function Card({ icon: Icon, titulo, children, full }) {
  return (
    <div
      className={`rounded-[10px] border ${full ? "md:col-span-2" : ""}`}
      style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
    >
      <div
        className="flex items-center gap-2 border-b px-4 py-2.5"
        style={{ borderColor: "var(--n-150)" }}
      >
        <Icon className="h-3.5 w-3.5" style={{ color: "var(--n-500)" }} />
        <span
          className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
          style={{ color: "var(--n-500)" }}
        >
          {titulo}
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Fila({ label, valor }) {
  return (
    <div
      className="flex items-center justify-between gap-3 border-b py-1.5 last:border-b-0"
      style={{ borderColor: "var(--n-100)" }}
    >
      <span className="text-[12px]" style={{ color: "var(--n-500)" }}>
        {label}
      </span>
      <span
        className="text-right text-[13px] font-medium"
        style={{ color: "var(--n-900)" }}
      >
        {valor}
      </span>
    </div>
  );
}
