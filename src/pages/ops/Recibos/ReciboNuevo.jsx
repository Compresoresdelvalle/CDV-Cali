import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftCircle,
  Sparkles,
  Link2,
  Info,
  Check,
  Wallet,
  Zap,
} from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { formatCOP, safeError } from "../../../lib/utils";
import { useAuthStore } from "../../../stores/authStore";
import {
  RECIBO_METODOS_PAGO,
  metodoPagoLabel,
  cuentaBancariaLabel,
} from "../../../lib/recibos-ui";

/**
 * Crear recibo de pago — Fase 14 (B5: se eliminó el modo "desde cotización").
 * Recibo manual con vínculo opcional a una OT (que pre-llena cliente y concepto
 * y suma sus abonos previos); server-authoritative vía fn_registrar_recibo,
 * guard síncrono anti doble-submit.
 */
export default function ReciboNuevo() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [cuentas, setCuentas] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const guardandoRef = useRef(false);

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

  // Vínculo con OT (mecanismo de generación del recibo)
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
  // IVA acotado a [0,100] — el input HTML no impide teclear fuera de rango.
  const ivaN = Math.min(100, Math.max(0, Number(ivaPct) || 0));
  const total = subN * (1 + ivaN / 100);
  const pagadoN = Number(montoPagado) || 0;
  const saldo = total - abonosPrevios - pagadoN;

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
        .select("id, numero, cliente_nombre, cliente_nit, total")
        .eq("numero", num)
        .single();
      if (error || !ot) throw new Error("OT no encontrada");
      const { data: tot } = await supabase.rpc("fn_total_abonos_ot", {
        p_orden_id: ot.id,
      });
      setOrden(ot);
      setAbonosPrevios(Number(tot) || 0);
      // Al vincular la OT se pre-llenan los datos del recibo (editables).
      if (!clienteNombre) setClienteNombre(ot.cliente_nombre ?? "");
      if (!clienteNit && ot.cliente_nit) setClienteNit(ot.cliente_nit);
      if (!concepto.trim()) setConcepto(`Pago de OT #${ot.numero}`);
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
    if (subN < 0) {
      setErrorMsg("El subtotal no puede ser negativo");
      return;
    }
    // Guard síncrono anti doble-submit (el `disabled` no aplica de inmediato).
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setSubmitting(true);
    try {
      const payload = {
        cliente_nombre: clienteNombre.trim(),
        cliente_nit: clienteNit.trim() || null,
        concepto: concepto.trim(),
        cotizacion_id: null,
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
      guardandoRef.current = false;
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      <button onClick={() => navigate("/ops/recibos")} className="back-btn">
        <ArrowLeftCircle className="size-3.5" />
        Volver a Recibos
      </button>

      {/* ── Encabezado ─────────────────────────────────────────────── */}
      <div
        className="mt-4 flex flex-col items-start gap-3 border-b pb-4"
        style={{ borderColor: "var(--n-150)" }}
      >
        <div className="min-w-0">
          <div className="ph-eyebrow">Nuevo</div>
          <h1
            className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--n-900)" }}
          >
            Nuevo recibo
          </h1>
          <p className="mt-1.5 text-[13px]" style={{ color: "var(--n-500)" }}>
            Para anticipos, abonos a una OT o pagos sin venta asociada. Vincula
            una OT para pre-cargar el cliente y registrar el abono.
          </p>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="mt-4 rounded-[10px] border px-4 py-3 text-sm"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
            color: "var(--dang-700)",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* ── Layout: formulario + resumen sticky ────────────────────── */}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          {/* Datos del recibo */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <Sparkles className="size-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Datos del recibo</div>
            </div>
            <div className="flex flex-col gap-3">
              <Field label="Consecutivo" badge="auto">
                <input
                  className="finput locked"
                  readOnly
                  value="Se asigna al guardar"
                  title="El número de recibo lo asigna la base de datos de forma consecutiva."
                />
              </Field>
              <div className="field-row">
                <Field label="Cliente" req>
                  <input
                    type="text"
                    value={clienteNombre}
                    onChange={(e) => setClienteNombre(e.target.value)}
                    placeholder="Razón social o nombre…"
                    className="finput sans"
                  />
                </Field>
                <Field label="NIT / Cédula">
                  <input
                    type="text"
                    value={clienteNit}
                    onChange={(e) => setClienteNit(e.target.value)}
                    placeholder="900.123.456-7"
                    className="finput"
                  />
                </Field>
              </div>
              <Field label="Concepto" req>
                <textarea
                  value={concepto}
                  onChange={(e) => setConcepto(e.target.value)}
                  placeholder="Ej. Pago por reparación de compresor / abono a OT #12"
                  maxLength={500}
                  className="ftextarea"
                />
              </Field>
            </div>
          </div>

          {/* Vínculo con OT (opcional) */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <Link2 className="size-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Vínculo con OT (opcional)</div>
            </div>
            <div className="flex flex-col gap-3">
              <Field label="N° de OT">
                <input
                  type="number"
                  value={ordenNum}
                  onChange={(e) => setOrdenNum(e.target.value)}
                  onBlur={buscarOrden}
                  placeholder="Ej. 12"
                  className="finput"
                />
              </Field>
              {orden && (
                <>
                  <div className="banner-info">
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                    <div className="body">
                      <b>OT #{orden.numero}</b> · abonos previos registrados:{" "}
                      <b>{formatCOP(abonosPrevios)}</b>.
                    </div>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={crearAbono}
                      onChange={(e) => setCrearAbono(e.target.checked)}
                      className="cursor-pointer"
                    />
                    <span style={{ color: "var(--n-900)" }}>
                      Registrar el monto pagado como abono de la OT #
                      {orden.numero}
                    </span>
                  </label>
                </>
              )}
            </div>
          </div>

          {/* Montos */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico succ">
                <Wallet className="size-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Montos y pago</div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="field-row">
                <Field label="Subtotal">
                  <div className="fprefix">
                    <span className="pre">$</span>
                    <input
                      type="number"
                      min="0"
                      value={subtotal}
                      onChange={(e) => setSubtotal(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </Field>
                <Field label="IVA %">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={ivaPct}
                    onChange={(e) => setIvaPct(e.target.value)}
                    className="finput"
                  />
                </Field>
              </div>
              <div className="field-row">
                <Field label="Monto recibido">
                  <div className="fprefix">
                    <span className="pre">$</span>
                    <input
                      type="number"
                      min="0"
                      value={montoPagado}
                      onChange={(e) => setMontoPagado(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </Field>
                <Field label="Forma de pago" req>
                  <select
                    value={metodoPago}
                    onChange={(e) => setMetodoPago(e.target.value)}
                    className="fselect"
                  >
                    {RECIBO_METODOS_PAGO.map((m) => (
                      <option key={m.v} value={m.v}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Cuenta bancaria (opcional)">
                <select
                  value={cuentaId}
                  onChange={(e) => setCuentaId(e.target.value)}
                  className="fselect"
                >
                  <option value="">— Ninguna —</option>
                  {cuentas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {cuentaBancariaLabel(c)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          {/* Observaciones */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <Info className="size-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Observaciones</div>
            </div>
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Notas internas (opcional)…"
              maxLength={500}
              className="ftextarea"
            />
            <p className="mt-2 text-[12px]" style={{ color: "var(--n-500)" }}>
              Recibido por:{" "}
              <span style={{ color: "var(--n-900)" }}>
                {perfil?.nombre ?? "—"}
              </span>
            </p>
          </div>
        </div>

        {/* ── Resumen sticky ───────────────────────────────────────── */}
        <aside className="cart">
          <span className="cart-eyebrow">Resumen · Nuevo recibo</span>
          <div className="cart-line">
            <span>Tipo</span>
            <span className="v">{orden ? "Vinculado a OT" : "Manual"}</span>
          </div>
          <div className="cart-line">
            <span>Consecutivo</span>
            <span className="v">Auto BD</span>
          </div>
          <div className="cart-line">
            <span>Cliente</span>
            <span className="v">{clienteNombre || "—"}</span>
          </div>
          <div className="cart-line">
            <span>Vínculo</span>
            <span className="v">
              {orden ? `OT #${orden.numero}` : "Ninguno"}
            </span>
          </div>
          <div className="cart-line">
            <span>Forma de pago</span>
            <span className="v">{metodoPagoLabel(metodoPago)}</span>
          </div>
          <div className="cart-line">
            <span>Total recibo</span>
            <span className="v">{formatCOP(total)}</span>
          </div>
          {abonosPrevios > 0 && (
            <div className="cart-line" style={{ color: "var(--warn-700)" }}>
              <span>Abonos previos</span>
              <span className="v" style={{ color: "var(--warn-700)" }}>
                −{formatCOP(abonosPrevios)}
              </span>
            </div>
          )}
          <div className="cart-line">
            <span>Monto recibido</span>
            <span className="v">{formatCOP(pagadoN)}</span>
          </div>
          <div className="cart-line tot">
            <span>Saldo pendiente</span>
            <span className="v">{formatCOP(saldo)}</span>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            <button
              onClick={guardar}
              disabled={submitting}
              className="btn btn-pri w-full justify-center disabled:opacity-50"
              style={{ height: 48 }}
            >
              <Check className="size-3.5" />
              {submitting ? "Guardando…" : "Crear recibo"}
            </button>
            <button
              onClick={() => navigate("/ops/recibos")}
              disabled={submitting}
              className="btn btn-out w-full justify-center disabled:opacity-50"
              style={{ height: 48 }}
            >
              Cancelar
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function Field({ label, req, badge, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flbl">
        {label}
        {req && <span className="req">*</span>}
        {badge === "auto" && (
          <span className="auto">
            <Zap className="size-2.5" />
            Auto BD
          </span>
        )}
        {badge === "sugg" && (
          <span className="sugg">
            <Sparkles className="size-2.5" />
            Pre-cargado
          </span>
        )}
      </label>
      {children}
    </div>
  );
}
