import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../../lib/utils";
import PageHeader from "../../../components/layout/PageHeader";
import { useConfirm } from "../../../components/ui/ConfirmDialog";
import { generarReciboPDF } from "../../../lib/pdf/reciboPDF";

/**
 * Detalle de un recibo de pago — Fase 14.
 * Vista + botones Descargar PDF / Imprimir / Anular.
 */
export default function ReciboDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();

  const [recibo, setRecibo] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [anulando, setAnulando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const { data: r, error } = await supabase
        .from("recibos")
        .select(
          `id, numero, fecha, cliente_nombre, cliente_nit, concepto,
           cotizacion_id, orden_id, subtotal, iva_pct, total, abonos_previos,
           monto_pagado, saldo, metodo_pago, observaciones, anulado, abono_id,
           recibidor:recibido_por(nombre),
           cuenta:cuenta_bancaria_id(banco, tipo, numero, titular)`,
        )
        .eq("id", id)
        .single();
      if (error || !r) throw new Error("Recibo no encontrado");
      const { data: det } = await supabase
        .from("detalle_recibo")
        .select("descripcion, cantidad, precio_unitario, subtotal")
        .eq("recibo_id", id);
      setRecibo(r);
      setItems(det ?? []);
    } catch (err) {
      setErrorMsg(safeError(err, "Error al cargar el recibo"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const construirPDF = () =>
    generarReciboPDF({
      recibo,
      items,
      cuenta: recibo.cuenta ?? null,
      recibidoPor: recibo.recibidor?.nombre ?? "—",
    });

  // Envuelve la generación del PDF: si jsPDF falla, muestra el error en vez
  // de dejar una excepción sin manejar.
  const manejarPDF = (accion) => {
    setErrorMsg("");
    try {
      const pdf = construirPDF();
      if (accion === "print") pdf.print();
      else pdf.download();
    } catch (err) {
      setErrorMsg(safeError(err, "No se pudo generar el PDF del recibo"));
    }
  };

  const anular = async () => {
    const ok = await confirm({
      titulo: "Anular recibo",
      mensaje: `Se anulará el recibo #${recibo.numero}. Si registró un abono en una OT, ese abono se eliminará. Esta acción no se puede deshacer.`,
      confirmLabel: "Sí, anular",
      danger: true,
    });
    if (!ok) return;
    setAnulando(true);
    setErrorMsg("");
    try {
      const { error } = await supabase.rpc("fn_anular_recibo", {
        p_recibo_id: id,
      });
      if (error) throw error;
      await cargar();
    } catch (err) {
      setErrorMsg(safeError(err, "Error al anular el recibo"));
    } finally {
      setAnulando(false);
    }
  };

  if (loading) {
    return (
      <div
        className="p-4 sm:p-6"
        style={{ backgroundColor: "hsl(var(--background))" }}
      >
        <div
          className="h-12 rounded-lg animate-pulse"
          style={{ backgroundColor: "hsl(var(--muted) / 0.4)" }}
        />
      </div>
    );
  }

  if (!recibo) {
    return (
      <div className="p-4 sm:p-6 space-y-3">
        <p style={{ color: "hsl(var(--destructive))" }}>
          {errorMsg || "Recibo no encontrado"}
        </p>
        <button
          onClick={() => navigate("/ops/recibos")}
          className="text-sm px-4 py-2 rounded-lg border cursor-pointer"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          ← Volver
        </button>
      </div>
    );
  }

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title={`Recibo #${recibo.numero}`}
        description={`${recibo.cliente_nombre} · ${formatDate(recibo.fecha)}`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {recibo.anulado && (
              <span
                className="px-2 py-0.5 rounded text-[10px] font-semibold"
                style={{
                  backgroundColor: "hsl(var(--destructive) / 0.15)",
                  color: "hsl(var(--destructive))",
                }}
              >
                Anulado
              </span>
            )}
            <button
              onClick={() => navigate("/ops/recibos")}
              className="h-9 px-3 rounded-lg border text-sm font-medium cursor-pointer"
              style={{
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--muted-foreground))",
                backgroundColor: "hsl(var(--card))",
              }}
            >
              ← Volver
            </button>
          </div>
        }
      />

      {errorMsg && (
        <div
          role="alert"
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

      {/* Acciones */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => manejarPDF("print")}
          className="text-sm px-4 py-2 rounded-lg cursor-pointer min-h-[44px]"
          style={{
            backgroundColor: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
          }}
        >
          🖨️ Imprimir
        </button>
        <button
          onClick={() => manejarPDF("download")}
          className="text-sm px-4 py-2 rounded-lg border cursor-pointer min-h-[44px]"
          style={{
            borderColor: "hsl(var(--border))",
            color: "hsl(var(--foreground))",
            backgroundColor: "hsl(var(--card))",
          }}
        >
          📄 Descargar PDF
        </button>
        {!recibo.anulado && (
          <button
            onClick={anular}
            disabled={anulando}
            className="text-sm px-4 py-2 rounded-lg cursor-pointer min-h-[44px] disabled:opacity-50"
            style={{
              backgroundColor: "hsl(var(--destructive))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            {anulando ? "Anulando..." : "Anular recibo"}
          </button>
        )}
      </div>

      {/* Info general */}
      <div
        className="rounded-xl border p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <Info label="Cliente" value={recibo.cliente_nombre} />
        <Info label="NIT / Cédula" value={recibo.cliente_nit ?? "—"} />
        <Info label="Forma de pago" value={recibo.metodo_pago} />
        <Info label="Recibido por" value={recibo.recibidor?.nombre ?? "—"} />
        {recibo.cuenta && (
          <div className="col-span-2 md:col-span-4">
            <p
              className="text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Cuenta bancaria
            </p>
            <p style={{ color: "hsl(var(--foreground))" }}>
              {recibo.cuenta.banco} {recibo.cuenta.tipo} {recibo.cuenta.numero}
              {recibo.cuenta.titular ? ` · ${recibo.cuenta.titular}` : ""}
            </p>
          </div>
        )}
        <div className="col-span-2 md:col-span-4">
          <p
            className="text-xs"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Concepto
          </p>
          <p
            className="whitespace-pre-line"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {recibo.concepto}
          </p>
        </div>
        {recibo.observaciones && (
          <div className="col-span-2 md:col-span-4">
            <p
              className="text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Observaciones
            </p>
            <p
              className="whitespace-pre-line"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {recibo.observaciones}
            </p>
          </div>
        )}
      </div>

      {/* Ítems (si vino de cotización) */}
      {items.length > 0 && (
        <div
          className="rounded-xl border overflow-hidden"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          <div
            className="px-4 py-3 border-b text-xs font-semibold uppercase tracking-wide"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
              backgroundColor: "hsl(var(--muted) / 0.3)",
            }}
          >
            Detalle ({items.length})
          </div>
          <ul>
            {items.map((it, idx) => (
              <li
                key={idx}
                className="px-4 py-3 flex justify-between gap-3"
                style={{
                  borderTop:
                    idx === 0 ? "none" : "1px solid hsl(var(--border) / 0.5)",
                }}
              >
                <div className="min-w-0">
                  <p
                    className="text-sm font-medium"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {it.descripcion}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {it.cantidad} × {formatCOP(it.precio_unitario)}
                  </p>
                </div>
                <p
                  className="text-sm font-bold shrink-0 tabular-nums"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {formatCOP(it.subtotal)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Montos */}
      <div
        className="rounded-xl border p-4 space-y-1.5 text-sm"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <Linea label="Subtotal" valor={formatCOP(recibo.subtotal)} />
        <Linea
          label={`IVA ${Number(recibo.iva_pct)}%`}
          valor={formatCOP(Number(recibo.total) - Number(recibo.subtotal))}
        />
        <Linea label="Total" valor={formatCOP(recibo.total)} bold />
        {Number(recibo.abonos_previos) > 0 && (
          <Linea
            label="Abonos previos"
            valor={`- ${formatCOP(recibo.abonos_previos)}`}
          />
        )}
        <Linea label="Monto recibido" valor={formatCOP(recibo.monto_pagado)} />
        <Linea label="Saldo pendiente" valor={formatCOP(recibo.saldo)} bold />
      </div>

      <ConfirmDialog />
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
        {label}
      </p>
      <p style={{ color: "hsl(var(--foreground))" }}>{value}</p>
    </div>
  );
}

function Linea({ label, valor, bold }) {
  return (
    <div className="flex justify-between">
      <span
        style={{
          color: bold
            ? "hsl(var(--foreground))"
            : "hsl(var(--muted-foreground))",
          fontWeight: bold ? 700 : 400,
        }}
      >
        {label}
      </span>
      <span
        className="tabular-nums"
        style={{
          color: "hsl(var(--foreground))",
          fontWeight: bold ? 700 : 400,
        }}
      >
        {valor}
      </span>
    </div>
  );
}
