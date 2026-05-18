import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatDate, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";

const SEDE_LABELS = {
  "BOD-PRINCIPAL": "Bodega Principal",
  "ALM-01": "Almacén 01",
  "ALM-02": "Almacén 02",
  "ALM-03": "Almacén 03",
};

function sedeLabel(id) {
  return SEDE_LABELS[id] ?? id;
}

function SectionCard({ title, children }) {
  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <div
        className="px-4 py-3 border-b"
        style={{
          borderColor: "hsl(var(--border))",
          backgroundColor: "hsl(var(--muted) / 0.3)",
        }}
      >
        <p
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {title}
        </p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function TraspasoDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [traspaso, setTraspaso] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accionando, setAccionando] = useState(false);
  const [error, setError] = useState(null);

  const esAdmin = perfil?.rol === "Admin";
  const esBodeguero = perfil?.rol === "Bodeguero";

  const accionandoRef = useRef(false);

  const cargar = async () => {
    setLoading(true);
    try {
      const [{ data: t, error: errT }, { data: d, error: errD }] =
        await Promise.all([
          supabase
            .from("traspasos")
            .select(
              `*,
               solicitante:solicitado_por(nombre),
               picker:picker_id(nombre),
               verificador:verificado_por(nombre),
               receptor:recibido_por(nombre)`,
            )
            .eq("id", id)
            .single(),
          supabase
            .from("detalle_traspaso")
            .select(
              `*, producto:producto_id(nombre, referencia, unidad_medida),
               ubicacion:ubicacion_origen_id(pasillo, estante, nivel, prioridad_picking)`,
            )
            .eq("traspaso_id", id)
            .order("created_at"),
        ]);
      // El error de la cabecera es bloqueante; el del detalle solo degrada.
      if (errT) throw errT;
      setTraspaso(t);
      setItems(d ?? []);
      if (errD) setError("No se pudo cargar el detalle de productos.");
    } catch (e) {
      setError(safeError(e, "Error al cargar el traspaso"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Acción: iniciar picking ───────────────────────────────
  const iniciarPicking = async () => {
    if (accionandoRef.current) return;
    accionandoRef.current = true;
    setError(null);
    setAccionando(true);
    try {
      const { error: rpcErr } = await supabase.rpc("fn_procesar_traspaso", {
        p_traspaso_id: id,
        p_accion: "iniciar_picking",
        p_items: null,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      navigate(`/ops/traspasos/${id}/picking`);
    } catch (e) {
      setError(safeError(e, "Error en operación de traspaso"));
    } finally {
      setAccionando(false);
      accionandoRef.current = false;
    }
  };

  // ── Acción: enviar (verificado → en_transito) ────────────
  const enviarTraspaso = async () => {
    if (accionandoRef.current) return;
    accionandoRef.current = true;
    setError(null);
    setAccionando(true);
    try {
      const { error: rpcErr } = await supabase.rpc("fn_procesar_traspaso", {
        p_traspaso_id: id,
        p_accion: "enviar",
        p_items: null,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      await cargar();
    } catch (e) {
      setError(safeError(e, "Error en operación de traspaso"));
    } finally {
      setAccionando(false);
      accionandoRef.current = false;
    }
  };

  if (loading) return <LoadingView />;
  if (!traspaso)
    return <NotFoundView onBack={() => navigate("/ops/traspasos")} />;

  const yoSoyPicker = traspaso.picker_id === perfil?.id;
  const yoSoyDeSedeDestino =
    perfil?.sede_id === traspaso.sede_destino_id || esAdmin;

  // Calcular progreso de picking
  const totalItems = items.length;
  const itemsCompletos = items.filter((i) => i.picking_completado).length;
  const pickingCompleto = totalItems > 0 && itemsCompletos === totalItems;

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title={`Traspaso #${traspaso.numero}`}
        description={`${sedeLabel(traspaso.sede_origen_id)} → ${sedeLabel(traspaso.sede_destino_id)}`}
        actions={
          <button
            onClick={() => navigate("/ops/traspasos")}
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

      {/* Error de acción */}
      {error && (
        <div
          className="p-3 rounded-lg border text-sm font-medium"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.3)",
            color: "hsl(var(--destructive))",
          }}
        >
          {error}
        </div>
      )}

      {/* Estado + Flujo visual */}
      <div
        className="rounded-xl border p-4"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p
              className="text-xs font-semibold uppercase tracking-wide mb-1"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Estado actual
            </p>
            <StatusBadge status={traspaso.estado} />
          </div>
          <FlujoBadges estado={traspaso.estado} />
        </div>

        {/* Metadatos */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetaDato label="Creado" valor={formatDate(traspaso.fecha)} />
          <MetaDato
            label="Solicitado por"
            valor={traspaso.solicitante?.nombre ?? "—"}
          />
          <MetaDato
            label="Picker"
            valor={traspaso.picker?.nombre ?? "Sin asignar"}
          />
          <MetaDato
            label="Verificado por"
            valor={traspaso.verificador?.nombre ?? "—"}
          />
        </div>

        {traspaso.fecha_recepcion && (
          <div className="mt-3">
            <MetaDato
              label="Recepción"
              valor={formatDate(traspaso.fecha_recepcion)}
            />
          </div>
        )}

        {traspaso.observaciones && (
          <p
            className="mt-3 text-sm"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {traspaso.observaciones}
          </p>
        )}
      </div>

      {/* ── PANEL DE ACCIÓN según estado ──────────────────── */}

      {/* borrador → iniciar picking */}
      {traspaso.estado === "borrador" && (esAdmin || esBodeguero) && (
        <ActionPanel
          icon="📦"
          title="Iniciar picking"
          description="Asígnate como picker y comienza a recoger los productos de bodega."
          buttonLabel={accionando ? "Iniciando…" : "Iniciar picking"}
          buttonDisabled={accionando}
          onAction={iniciarPicking}
          color="primary"
        />
      )}

      {/* picking: el picker continúa su trabajo (si aún falta) */}
      {traspaso.estado === "picking" && yoSoyPicker && !pickingCompleto && (
        <ActionPanel
          icon="🏷️"
          title="Continuar picking"
          description={`${itemsCompletos} de ${totalItems} items completados.`}
          buttonLabel="Ir al picking"
          onAction={() => navigate(`/ops/traspasos/${id}/picking`)}
          color="warning"
          progress={totalItems > 0 ? (itemsCompletos / totalItems) * 100 : 0}
        />
      )}

      {/* F12 fix UX: picking completo pero soy el picker → esperar verificador */}
      {traspaso.estado === "picking" && yoSoyPicker && pickingCompleto && (
        <ActionPanel
          icon="⏳"
          title="Picking completo — esperando verificación"
          description="Terminaste de pickear todos los items. Por segregación de funciones, otra persona (Admin u otro Bodeguero) debe entrar a este traspaso y verificarlo. El estado cambiará cuando lo haga."
          buttonLabel="Revisar mi picking"
          onAction={() => navigate(`/ops/traspasos/${id}/picking`)}
          color="info"
        />
      )}

      {/* picking: otra persona puede verificar */}
      {traspaso.estado === "picking" &&
        !yoSoyPicker &&
        (esAdmin || esBodeguero) && (
          <ActionPanel
            icon="✅"
            title="Verificar traspaso"
            description={
              pickingCompleto
                ? "Todos los items fueron pickeados. Puedes verificar el traspaso."
                : `Picking en progreso: ${itemsCompletos}/${totalItems} items. Cuando estén todos listos podrás verificar.`
            }
            buttonLabel="Verificar cantidades"
            buttonDisabled={!pickingCompleto}
            onAction={() => navigate(`/ops/traspasos/${id}/verificar`)}
            color="info"
          />
        )}

      {/* verificado → enviar */}
      {traspaso.estado === "verificado" && (esAdmin || esBodeguero) && (
        <ActionPanel
          icon="🚚"
          title="Enviar traspaso"
          description="El traspaso fue verificado. Al confirmar el envío el stock saldrá de la sede origen."
          buttonLabel={accionando ? "Enviando…" : "Confirmar envío"}
          buttonDisabled={accionando}
          onAction={enviarTraspaso}
          color="primary"
        />
      )}

      {/* en_transito → recibir (solo sede destino) */}
      {traspaso.estado === "en_transito" && yoSoyDeSedeDestino && (
        <ActionPanel
          icon="📥"
          title="Confirmar recepción"
          description="El traspaso está en camino. Confirma las cantidades recibidas en tu sede."
          buttonLabel="Confirmar recepción"
          onAction={() => navigate(`/ops/traspasos/${id}/recibir`)}
          color="success"
        />
      )}

      {/* Alerta de diferencias */}
      {traspaso.estado === "con_diferencia" && (
        <div
          className="p-4 rounded-xl border"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.06)",
            borderColor: "hsl(var(--destructive) / 0.3)",
          }}
        >
          <p
            className="text-sm font-semibold"
            style={{ color: "hsl(var(--destructive))" }}
          >
            ⚠️ Traspaso recibido con diferencias
          </p>
          <p
            className="text-xs mt-1"
            style={{ color: "hsl(var(--destructive) / 0.8)" }}
          >
            Las cantidades recibidas no coinciden con las enviadas. Revisa el
            detalle de items abajo.
          </p>
        </div>
      )}

      {/* ── Detalle de items ───────────────────────────────── */}
      <SectionCard title={`Productos (${items.length})`}>
        {items.length === 0 ? (
          <p
            className="text-sm"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Sin productos.
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const hayDiff =
                traspaso.estado === "recibido" ||
                traspaso.estado === "con_diferencia";
              const diferencia = hayDiff
                ? item.cantidad_recibida - item.cantidad_enviada
                : null;

              return (
                <div
                  key={item.id}
                  className="p-3 rounded-lg border"
                  style={{
                    backgroundColor:
                      diferencia !== null && diferencia !== 0
                        ? "hsl(var(--destructive) / 0.05)"
                        : "hsl(var(--muted) / 0.2)",
                    borderColor:
                      diferencia !== null && diferencia !== 0
                        ? "hsl(var(--destructive) / 0.3)"
                        : "hsl(var(--border))",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-medium truncate"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {item.producto?.nombre ?? "—"}
                      </p>
                      <p
                        className="text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {item.producto?.referencia}
                        {item.ubicacion &&
                          ` · ${item.ubicacion.pasillo}-${item.ubicacion.estante}-${item.ubicacion.nivel}`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <CantidadesItem item={item} estado={traspaso.estado} />
                    </div>
                  </div>

                  {/* Diferencia */}
                  {diferencia !== null && diferencia !== 0 && (
                    <p
                      className="text-xs mt-1.5 font-semibold"
                      style={{ color: "hsl(var(--destructive))" }}
                    >
                      Diferencia: {diferencia > 0 ? "+" : ""}
                      {diferencia} unidades
                    </p>
                  )}

                  {/* Estado picking */}
                  {traspaso.estado === "picking" && (
                    <div className="mt-1.5">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={
                          item.picking_completado
                            ? {
                                backgroundColor: "hsl(var(--success) / 0.1)",
                                color: "hsl(var(--success))",
                              }
                            : {
                                backgroundColor: "hsl(var(--warning) / 0.1)",
                                color: "hsl(var(--warning))",
                              }
                        }
                      >
                        {item.picking_completado ? "✓ Pickeado" : "Pendiente"}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function CantidadesItem({ item, estado }) {
  return (
    <div
      className="text-xs space-y-0.5"
      style={{ color: "hsl(var(--muted-foreground))" }}
    >
      <p>
        Solicitado:{" "}
        <strong style={{ color: "hsl(var(--foreground))" }}>
          {item.cantidad_solicitada}
        </strong>
      </p>
      {[
        "picking",
        "verificado",
        "en_transito",
        "recibido",
        "con_diferencia",
      ].includes(estado) && (
        <p>
          Enviado:{" "}
          <strong style={{ color: "hsl(var(--foreground))" }}>
            {item.cantidad_enviada ?? 0}
          </strong>
        </p>
      )}
      {["recibido", "con_diferencia"].includes(estado) && (
        <p>
          Recibido:{" "}
          <strong
            style={{
              color:
                item.cantidad_recibida !== item.cantidad_enviada
                  ? "hsl(var(--destructive))"
                  : "hsl(var(--success))",
            }}
          >
            {item.cantidad_recibida ?? 0}
          </strong>
        </p>
      )}
    </div>
  );
}

function FlujoBadges({ estado }) {
  const pasos = [
    { key: "borrador", label: "Pendiente" },
    { key: "picking", label: "Picking" },
    { key: "verificado", label: "Verificado" },
    { key: "en_transito", label: "En Tránsito" },
    { key: "recibido", label: "Recibido" },
  ];

  const orden = pasos.map((p) => p.key);
  const idxActual = orden.indexOf(
    estado === "con_diferencia" ? "recibido" : estado,
  );

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {pasos.map((paso, idx) => {
        const completado = idx < idxActual;
        const activo = idx === idxActual;
        return (
          <div key={paso.key} className="flex items-center gap-1">
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{
                backgroundColor: activo
                  ? "hsl(var(--primary))"
                  : completado
                    ? "hsl(var(--success) / 0.15)"
                    : "hsl(var(--muted))",
                color: activo
                  ? "hsl(var(--primary-foreground))"
                  : completado
                    ? "hsl(var(--success))"
                    : "hsl(var(--muted-foreground))",
              }}
            >
              {completado ? "✓ " : ""}
              {paso.label}
            </span>
            {idx < pasos.length - 1 && (
              <span
                className="text-xs"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                →
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ActionPanel({
  icon,
  title,
  description,
  buttonLabel,
  buttonDisabled,
  onAction,
  color,
  progress,
}) {
  const colors = {
    primary: {
      bg: "hsl(var(--primary) / 0.06)",
      border: "hsl(var(--primary) / 0.2)",
      btn: "hsl(var(--primary))",
      btnText: "hsl(var(--primary-foreground))",
    },
    warning: {
      bg: "hsl(var(--warning) / 0.06)",
      border: "hsl(var(--warning) / 0.2)",
      btn: "hsl(var(--warning))",
      btnText: "hsl(var(--primary-foreground))",
    },
    info: {
      bg: "hsl(var(--info) / 0.06)",
      border: "hsl(var(--info) / 0.2)",
      btn: "hsl(var(--info))",
      btnText: "hsl(var(--primary-foreground))",
    },
    success: {
      bg: "hsl(var(--success) / 0.06)",
      border: "hsl(var(--success) / 0.2)",
      btn: "hsl(var(--success))",
      btnText: "hsl(var(--primary-foreground))",
    },
  };

  const c = colors[color] ?? colors.primary;

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ backgroundColor: c.bg, borderColor: c.border }}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{icon}</span>
        <div className="flex-1">
          <p
            className="text-sm font-semibold"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {title}
          </p>
          <p
            className="text-xs mt-0.5"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {description}
          </p>
        </div>
      </div>

      {/* Barra de progreso picking */}
      {progress !== undefined && (
        <div
          className="h-2 rounded-full overflow-hidden"
          style={{ backgroundColor: "hsl(var(--muted))" }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${progress}%`,
              backgroundColor: "hsl(var(--warning))",
            }}
          />
        </div>
      )}

      <button
        onClick={onAction}
        disabled={buttonDisabled}
        className="w-full h-10 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40 cursor-pointer"
        style={{ backgroundColor: c.btn, color: c.btnText }}
        onMouseEnter={(e) =>
          !buttonDisabled && (e.currentTarget.style.opacity = "0.9")
        }
        onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

function MetaDato({ label, valor }) {
  return (
    <div>
      <p
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </p>
      <p
        className="text-sm font-medium mt-0.5"
        style={{ color: "hsl(var(--foreground))" }}
      >
        {valor}
      </p>
    </div>
  );
}

function LoadingView() {
  return (
    <div
      className="p-4 sm:p-6 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-xl animate-pulse"
            style={{ backgroundColor: "hsl(var(--muted))" }}
          />
        ))}
      </div>
    </div>
  );
}

function NotFoundView({ onBack }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="text-5xl mb-4">🔄</div>
      <p
        className="font-semibold mb-4"
        style={{ color: "hsl(var(--foreground))" }}
      >
        Traspaso no encontrado
      </p>
      <button
        onClick={onBack}
        className="px-4 h-9 rounded-lg text-sm font-medium cursor-pointer"
        style={{
          backgroundColor: "hsl(var(--primary))",
          color: "hsl(var(--primary-foreground))",
        }}
      >
        Volver a traspasos
      </button>
    </div>
  );
}
