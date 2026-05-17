import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabase";
import { formatCOP, safeError } from "../../../lib/utils";
import { useAuthStore } from "../../../stores/authStore";
import PageHeader from "../../../components/layout/PageHeader";

/**
 * Crear recibo de pago — Fase 14.
 * Dos modos: desde cero / desde cotización (pre-llena).
 * Vínculo opcional a OT → muestra abonos previos y puede registrar el pago
 * como abono de esa OT.
 */
const inputCls =
  "w-full px-3 py-2 rounded-lg border text-sm min-h-[44px] focus:outline-none";
const inputStyle = {
  backgroundColor: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
  color: "hsl(var(--foreground))",
};

export default function ReciboNuevo() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [modo, setModo] = useState("cero"); // cero | cotizacion
  const [cuentas, setCuentas] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Campos del recibo
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteNit, setClienteNit] = useState("");
  const [concepto, setConcepto] = useState("");
  const [subtotal, setSubtotal] = useState("");
  const [ivaPct, setIvaPct] = useState("19");
  const [montoPagado, setMontoPagado] = useState("");
  const [metodoPago, setMetodoPago] = useState("efectivo");
  const [cuentaId, setCuentaId] = useState("");
  const [observaciones, setObservaciones] = useState("");

  // Vínculos
  const [cotizacionNum, setCotizacionNum] = useState("");
  const [cotizacion, setCotizacion] = useState(null);
  const [items, setItems] = useState([]);
  const [ordenNum, setOrdenNum] = useState("");
  const [orden, setOrden] = useState(null);
  const [abonosPrevios, setAbonosPrevios] = useState(0);
  const [crearAbono, setCrearAbono] = useState(true);

  useEffect(() => {
    supabase
      .from("cuentas_bancarias")
      .select("id, banco, tipo, numero, titular")
      .eq("activo", true)
      .then(({ data }) => setCuentas(data ?? []));
  }, []);

  // Calculados
  const subN = Number(subtotal) || 0;
  const ivaN = Number(ivaPct) || 0;
  const total = subN * (1 + ivaN / 100);
  const pagadoN = Number(montoPagado) || 0;
  const saldo = total - abonosPrevios - pagadoN;

  const buscarCotizacion = async () => {
    setErrorMsg("");
    const num = parseInt(cotizacionNum, 10);
    if (!num) return;
    try {
      const { data: cot, error } = await supabase
        .from("cotizaciones")
        .select(
          "id, numero, cliente_nombre, cliente_nit, subtotal, iva_pct, total",
        )
        .eq("numero", num)
        .single();
      if (error || !cot) throw new Error("Cotización no encontrada");
      const { data: det } = await supabase
        .from("detalle_cotizacion")
        .select(
          "cantidad, precio_unitario, subtotal, producto:producto_id(nombre)",
        )
        .eq("cotizacion_id", cot.id);
      setCotizacion(cot);
      setClienteNombre(cot.cliente_nombre ?? "");
      setClienteNit(cot.cliente_nit ?? "");
      setConcepto(`Pago de cotización #${cot.numero}`);
      setSubtotal(String(cot.subtotal ?? 0));
      setIvaPct(String(cot.iva_pct ?? 19));
      setItems(
        (det ?? []).map((d) => ({
          descripcion: d.producto?.nombre ?? "Ítem",
          cantidad: d.cantidad,
          precio_unitario: d.precio_unitario,
          subtotal: d.subtotal,
        })),
      );
    } catch (err) {
      setErrorMsg(safeError(err, "Error al buscar cotización"));
    }
  };

  const buscarOrden = async () => {
    setErrorMsg("");
    const num = parseInt(ordenNum, 10);
    if (!num) {
      setOrden(null);
      setAbonosPrevios(0);
      return;
    }
    try {
      const { data: ot, error } = await supabase
        .from("ordenes_servicio")
        .select("id, numero, cliente_nombre, total")
        .eq("numero", num)
        .single();
      if (error || !ot) throw new Error("OT no encontrada");
      const { data: tot } = await supabase.rpc("fn_total_abonos_ot", {
        p_orden_id: ot.id,
      });
      setOrden(ot);
      setAbonosPrevios(Number(tot) || 0);
      if (!clienteNombre) setClienteNombre(ot.cliente_nombre ?? "");
    } catch (err) {
      setErrorMsg(safeError(err, "Error al buscar OT"));
    }
  };

  const guardar = async () => {
    setErrorMsg("");
    if (!clienteNombre.trim()) {
      setErrorMsg("El nombre del cliente es obligatorio");
      return;
    }
    if (!concepto.trim()) {
      setErrorMsg("El concepto es obligatorio");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        cliente_nombre: clienteNombre.trim(),
        cliente_nit: clienteNit.trim() || null,
        concepto: concepto.trim(),
        cotizacion_id: cotizacion?.id ?? null,
        orden_id: orden?.id ?? null,
        subtotal: subN,
        iva_pct: ivaN,
        total,
        abonos_previos: abonosPrevios,
        monto_pagado: pagadoN,
        saldo,
        metodo_pago: metodoPago,
        cuenta_bancaria_id: cuentaId || null,
        observaciones: observaciones.trim() || null,
        crear_abono: !!orden && crearAbono,
        items: modo === "cotizacion" ? items : undefined,
      };
      const { data, error } = await supabase.rpc("fn_registrar_recibo", {
        p_payload: payload,
      });
      if (error) throw error;
      navigate(`/ops/recibos/${data.recibo_id}`);
    } catch (err) {
      setErrorMsg(safeError(err, "Error al registrar recibo"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Nuevo recibo"
        description="Recibo de pago. Crea desde cero o desde una cotización."
        actions={
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

      {/* Modo */}
      <div className="flex gap-2 flex-wrap">
        {[
          { v: "cero", label: "Desde cero" },
          { v: "cotizacion", label: "Desde cotización" },
        ].map((m) => (
          <button
            key={m.v}
            onClick={() => setModo(m.v)}
            className="h-9 px-4 rounded-lg text-sm font-medium border cursor-pointer"
            style={{
              backgroundColor:
                modo === m.v ? "hsl(var(--primary))" : "hsl(var(--card))",
              color:
                modo === m.v
                  ? "hsl(var(--primary-foreground))"
                  : "hsl(var(--foreground))",
              borderColor: "hsl(var(--border))",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <Section title="Datos del recibo">
        {modo === "cotizacion" && (
          <Row>
            <Field label="N° de cotización">
              <div className="flex gap-2">
                <input
                  type="number"
                  value={cotizacionNum}
                  onChange={(e) => setCotizacionNum(e.target.value)}
                  className={inputCls}
                  style={inputStyle}
                  placeholder="Ej. 57"
                />
                <button
                  onClick={buscarCotizacion}
                  className="px-3 rounded-lg text-sm font-medium cursor-pointer shrink-0"
                  style={{
                    backgroundColor: "hsl(var(--primary))",
                    color: "hsl(var(--primary-foreground))",
                  }}
                >
                  Buscar
                </button>
              </div>
            </Field>
            {cotizacion && (
              <Field label=" ">
                <p
                  className="text-xs pt-2"
                  style={{ color: "hsl(var(--success))" }}
                >
                  ✓ Cotización #{cotizacion.numero} cargada ({items.length}{" "}
                  ítems)
                </p>
              </Field>
            )}
          </Row>
        )}

        <Row>
          <Field label="Cliente *">
            <input
              type="text"
              value={clienteNombre}
              onChange={(e) => setClienteNombre(e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder="Nombre del cliente"
            />
          </Field>
          <Field label="NIT / Cédula">
            <input
              type="text"
              value={clienteNit}
              onChange={(e) => setClienteNit(e.target.value)}
              className={inputCls}
              style={inputStyle}
            />
          </Field>
        </Row>

        <Field label="Concepto *">
          <textarea
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            className={inputCls + " min-h-[70px]"}
            style={inputStyle}
            placeholder="Ej. Pago por reparación de compresor / abono a OT #12"
            maxLength={500}
          />
        </Field>
      </Section>

      <Section title="Vínculo con OT (opcional)">
        <Row>
          <Field label="N° de OT">
            <div className="flex gap-2">
              <input
                type="number"
                value={ordenNum}
                onChange={(e) => setOrdenNum(e.target.value)}
                onBlur={buscarOrden}
                className={inputCls}
                style={inputStyle}
                placeholder="Ej. 12"
              />
            </div>
          </Field>
          {orden && (
            <Field label=" ">
              <p
                className="text-xs pt-2"
                style={{ color: "hsl(var(--success))" }}
              >
                ✓ OT #{orden.numero} · abonos previos:{" "}
                {formatCOP(abonosPrevios)}
              </p>
            </Field>
          )}
        </Row>
        {orden && (
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={crearAbono}
              onChange={(e) => setCrearAbono(e.target.checked)}
              className="cursor-pointer"
            />
            <span style={{ color: "hsl(var(--foreground))" }}>
              Registrar el monto pagado como abono de la OT #{orden.numero}
            </span>
          </label>
        )}
      </Section>

      <Section title="Montos">
        <Row>
          <Field label="Subtotal (COP)">
            <input
              type="number"
              min="0"
              value={subtotal}
              onChange={(e) => setSubtotal(e.target.value)}
              className={inputCls}
              style={inputStyle}
            />
          </Field>
          <Field label="IVA %">
            <input
              type="number"
              min="0"
              max="100"
              value={ivaPct}
              onChange={(e) => setIvaPct(e.target.value)}
              className={inputCls}
              style={inputStyle}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Monto recibido (COP)">
            <input
              type="number"
              min="0"
              value={montoPagado}
              onChange={(e) => setMontoPagado(e.target.value)}
              className={inputCls}
              style={inputStyle}
            />
          </Field>
          <Field label="Forma de pago">
            <select
              value={metodoPago}
              onChange={(e) => setMetodoPago(e.target.value)}
              className={inputCls}
              style={inputStyle}
            >
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="otro">Otro</option>
            </select>
          </Field>
        </Row>
        <Field label="Cuenta bancaria (opcional)">
          <select
            value={cuentaId}
            onChange={(e) => setCuentaId(e.target.value)}
            className={inputCls}
            style={inputStyle}
          >
            <option value="">— Ninguna —</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.banco} {c.tipo} {c.numero}
              </option>
            ))}
          </select>
        </Field>

        {/* Resumen calculado */}
        <div
          className="rounded-lg border p-3 text-sm space-y-1"
          style={{
            backgroundColor: "hsl(var(--muted) / 0.3)",
            borderColor: "hsl(var(--border))",
          }}
        >
          <Linea label="Total (subtotal + IVA)" valor={formatCOP(total)} />
          {abonosPrevios > 0 && (
            <Linea
              label="Abonos previos"
              valor={`- ${formatCOP(abonosPrevios)}`}
            />
          )}
          <Linea label="Monto recibido" valor={formatCOP(pagadoN)} />
          <Linea label="Saldo pendiente" valor={formatCOP(saldo)} bold />
        </div>
      </Section>

      <Section title="Observaciones">
        <textarea
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          className={inputCls + " min-h-[60px]"}
          style={inputStyle}
          maxLength={500}
        />
        <p
          className="text-xs"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Recibido por: {perfil?.nombre ?? "—"}
        </p>
      </Section>

      <div className="flex justify-end gap-2">
        <button
          onClick={() => navigate("/ops/recibos")}
          disabled={submitting}
          className="text-sm px-4 py-2 rounded-lg border cursor-pointer min-h-[48px] disabled:opacity-50"
          style={{
            borderColor: "hsl(var(--border))",
            color: "hsl(var(--muted-foreground))",
          }}
        >
          Cancelar
        </button>
        <button
          onClick={guardar}
          disabled={submitting}
          className="text-sm px-5 py-2 rounded-lg cursor-pointer min-h-[48px] disabled:opacity-50"
          style={{
            backgroundColor: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
          }}
        >
          {submitting ? "Guardando..." : "Crear recibo"}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <h3
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function Row({ children }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-1">
      <label
        className="text-xs"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </label>
      {children}
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
