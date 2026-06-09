import { useState, useEffect, useRef } from "react";
import { Info, Plus, Pencil, Power } from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { safeError } from "../../../lib/utils";
import { useConfirm } from "../../../components/ui/ConfirmDialog";
import { pillStyle, surfaceInputStyle } from "../../../lib/admin-config-ui";

const TIPOS = ["Ahorros", "Corriente", "Digital"];

export default function CuentasBancarias() {
  const [cuentas, setCuentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [editando, setEditando] = useState(null); // cuenta o {nuevo:true}
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const { confirm, ConfirmDialog } = useConfirm();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ESC cierra el modal (si no estamos guardando)
  useEffect(() => {
    if (!editando) return;
    const onKey = (e) => {
      if (e.key === "Escape" && !saving) setEditando(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editando, saving]);

  const cargar = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const { data, error } = await supabase
        .from("cuentas_bancarias")
        .select("*")
        .order("activo", { ascending: false })
        .order("banco");
      if (!mountedRef.current) return;
      if (error) throw error;
      setCuentas(data ?? []);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar cuentas"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  const guardar = async () => {
    if (!editando) return;
    const banco = editando.banco?.trim();
    const numero = editando.numero?.trim();
    if (!banco || !numero) {
      setErrorMsg("Banco y número son obligatorios");
      return;
    }
    if (!TIPOS.includes(editando.tipo)) {
      setErrorMsg("Tipo inválido");
      return;
    }
    // Validación de unicidad cliente (banco, numero) — el UNIQUE BD también lo bloquea
    const duplicada = cuentas.find(
      (c) =>
        c.banco?.toLowerCase() === banco.toLowerCase() &&
        c.numero === numero &&
        c.id !== editando.id,
    );
    if (duplicada) {
      setErrorMsg(`Ya existe la cuenta ${banco} (${numero})`);
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setErrorMsg("");
    setOkMsg("");
    try {
      const payload = {
        banco,
        tipo: editando.tipo,
        numero,
        titular: editando.titular?.trim() || null,
        marca_iva: editando.marca_iva || null,
        activo: editando.activo ?? true,
      };
      if (editando.nuevo) {
        const { error } = await supabase
          .from("cuentas_bancarias")
          .insert(payload);
        if (error) throw error;
        setOkMsg(`Cuenta "${banco}" creada`);
      } else {
        const { error } = await supabase
          .from("cuentas_bancarias")
          .update(payload)
          .eq("id", editando.id);
        if (error) throw error;
        setOkMsg(`Cuenta "${banco}" actualizada`);
      }
      setEditando(null);
      await cargar();
    } catch (err) {
      setErrorMsg(safeError(err, "Error al guardar"));
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const toggleActivo = async (c) => {
    const ok = await confirm({
      titulo: `${c.activo ? "Desactivar" : "Activar"} cuenta`,
      mensaje: `${c.activo ? "Desactivar" : "Activar"} ${c.banco} (${c.numero})?`,
      confirmLabel: c.activo ? "Desactivar" : "Activar",
      danger: c.activo,
    });
    if (!ok) return;
    try {
      const { error } = await supabase
        .from("cuentas_bancarias")
        .update({ activo: !c.activo })
        .eq("id", c.id);
      if (error) throw error;
      setOkMsg(`Cuenta ${c.activo ? "desactivada" : "activada"}`);
      await cargar();
    } catch (err) {
      setErrorMsg(safeError(err, "Error"));
    }
  };

  const conIva = cuentas.filter((c) => c.marca_iva === "con_iva").length;
  const sinIva = cuentas.filter((c) => c.marca_iva === "sin_iva").length;

  return (
    <div className="flex flex-col gap-4">
      {errorMsg && <Banner type="destructive">{errorMsg}</Banner>}
      {okMsg && <Banner type="success">{okMsg}</Banner>}

      {/* Banner informativo */}
      <InfoBanner title="Cuentas para datos de pago en cotizaciones">
        Las cuentas activas con su marca de IVA aparecen disponibles al generar
        documentos. Las cuentas <b>con IVA</b> son empresariales registradas;
        las <b>sin IVA</b> son típicamente digitales personales
        (Nequi/Daviplata).
      </InfoBanner>

      <div className="flex items-center justify-between gap-3">
        <p
          className="text-xs"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {loading ? "Cargando…" : `${cuentas.length} cuentas`}
        </p>
        <button
          onClick={() =>
            setEditando({ nuevo: true, tipo: "Ahorros", activo: true })
          }
          className="inline-flex h-12 items-center gap-1.5 rounded-md px-4 text-[12.5px] font-semibold transition-opacity cursor-pointer hover:opacity-90"
          style={{
            backgroundColor: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
          }}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Nueva cuenta
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            />
          ))}
        </div>
      ) : cuentas.length === 0 ? (
        <Empty icon="🏦">Sin cuentas bancarias registradas</Empty>
      ) : (
        <section
          className="overflow-hidden rounded-[10px] border"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          {/* Desktop tabla */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr
                  className="text-left"
                  style={{
                    backgroundColor: "hsl(var(--muted) / 0.3)",
                    borderBottom: "1px solid hsl(var(--border))",
                  }}
                >
                  {[
                    "Banco",
                    "Número de cuenta",
                    "IVA",
                    "Estado",
                    "Default para PDFs",
                    "",
                  ].map((c, i) => (
                    <th
                      key={c || i}
                      className="px-3 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em]"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cuentas.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t align-middle"
                    style={{
                      borderColor: "hsl(var(--border) / 0.6)",
                      opacity: c.activo ? 1 : 0.55,
                    }}
                  >
                    <td className="px-3 py-3">
                      <p
                        className="text-[13px] font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {c.banco}
                      </p>
                      <p
                        className="mt-0.5 text-[11px]"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {c.tipo}
                        {c.titular ? ` · ${c.titular}` : ""}
                      </p>
                    </td>
                    <td
                      className="px-3 py-3 font-mono text-[12px] font-medium"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {c.numero}
                    </td>
                    <td className="px-3 py-3">
                      <IvaPill marca={c.marca_iva} />
                    </td>
                    <td className="px-3 py-3">
                      <EstadoPill activo={c.activo} />
                    </td>
                    {/* "Default para PDFs": el diseño Lovable lo muestra, pero
                        el esquema no tiene columna para ello → estado honesto
                        "no configurable aún", sin inventar un valor. */}
                    <td className="px-3 py-3">
                      <DefaultPdfPlaceholder />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <IconBtn
                          label="Editar cuenta"
                          onClick={() => setEditando({ ...c })}
                        >
                          <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </IconBtn>
                        <IconBtn
                          label={c.activo ? "Desactivar" : "Activar"}
                          token={c.activo ? "--destructive" : "--success"}
                          onClick={() => toggleActivo(c)}
                        >
                          <Power className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="divide-y md:hidden" role="list">
            {cuentas.map((c) => (
              <li
                key={c.id}
                className="px-4 py-3.5"
                style={{
                  borderColor: "hsl(var(--border))",
                  opacity: c.activo ? 1 : 0.55,
                }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p
                    className="text-sm font-semibold"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {c.banco}
                  </p>
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      backgroundColor: "hsl(var(--muted) / 0.4)",
                      color: "hsl(var(--muted-foreground))",
                    }}
                  >
                    {c.tipo}
                  </span>
                  <IvaPill marca={c.marca_iva} />
                  <EstadoPill activo={c.activo} />
                </div>
                <p
                  className="mt-1 font-mono text-xs"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {c.numero}
                  {c.titular ? ` · ${c.titular}` : ""}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setEditando({ ...c })}
                    className="h-11 flex-1 rounded-lg border text-xs font-semibold cursor-pointer"
                    style={{
                      borderColor: "hsl(var(--primary))",
                      color: "hsl(var(--primary))",
                    }}
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => toggleActivo(c)}
                    className="h-11 flex-1 rounded-lg border text-xs font-semibold cursor-pointer"
                    style={{
                      borderColor: c.activo
                        ? "hsl(var(--destructive))"
                        : "hsl(var(--success))",
                      color: c.activo
                        ? "hsl(var(--destructive))"
                        : "hsl(var(--success))",
                    }}
                  >
                    {c.activo ? "Desactivar" : "Activar"}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {/* Footer resumen + CTA (replica el footer del diseño Lovable) */}
          <div
            className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5"
            style={{
              borderColor: "hsl(var(--border))",
              backgroundColor: "hsl(var(--muted) / 0.3)",
            }}
          >
            <span
              className="font-mono text-[11.5px]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {cuentas.length} cuentas ·{" "}
              <b style={{ color: "hsl(var(--foreground))" }}>{conIva}</b> con
              IVA · <b style={{ color: "hsl(var(--foreground))" }}>{sinIva}</b>{" "}
              sin IVA
            </span>
            <button
              onClick={() =>
                setEditando({ nuevo: true, tipo: "Ahorros", activo: true })
              }
              className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium cursor-pointer transition-colors"
              style={{
                borderColor: "hsl(var(--primary) / 0.4)",
                color: "hsl(var(--primary))",
                backgroundColor: "transparent",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor =
                  "hsl(var(--primary) / 0.1)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "transparent")
              }
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              Agregar cuenta bancaria
            </button>
          </div>
        </section>
      )}

      {/* Nota explicativa (replica el pie informativo del diseño Lovable) */}
      {!loading && cuentas.length > 0 && (
        <p
          className="flex items-start gap-1.5 text-[12px] leading-relaxed"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          <Info
            className="mt-0.5 h-3 w-3 shrink-0"
            strokeWidth={1.75}
            style={{ color: "hsl(var(--info))" }}
          />
          <span>
            La marca{" "}
            <b style={{ color: "hsl(var(--foreground))" }}>Default para PDFs</b>{" "}
            (preselección de cuentas en cotizaciones) aún no está disponible; se
            habilitará en una versión futura.
          </span>
        </p>
      )}

      {editando && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => !saving && setEditando(null)}
        >
          <div
            className="w-full max-w-md space-y-3 rounded-xl border p-5"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className="text-lg font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {editando.nuevo ? "Nueva cuenta" : "Editar cuenta"}
            </h3>

            <Field label="Banco">
              <input
                type="text"
                value={editando.banco ?? ""}
                onChange={(e) =>
                  setEditando({ ...editando, banco: e.target.value })
                }
                className="h-12 w-full rounded-lg border px-3 text-sm"
                style={surfaceInputStyle}
                placeholder="Ej: Bancolombia"
              />
            </Field>

            <Field label="Tipo">
              <select
                value={editando.tipo}
                onChange={(e) =>
                  setEditando({ ...editando, tipo: e.target.value })
                }
                className="h-12 w-full rounded-lg border px-3 text-sm"
                style={surfaceInputStyle}
              >
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Número">
              <input
                type="text"
                value={editando.numero ?? ""}
                onChange={(e) =>
                  setEditando({ ...editando, numero: e.target.value })
                }
                className="h-12 w-full rounded-lg border px-3 font-mono text-sm"
                style={surfaceInputStyle}
                placeholder="XXX-XXXXXX-XX"
              />
            </Field>

            <Field label="Titular (opcional)">
              <input
                type="text"
                value={editando.titular ?? ""}
                onChange={(e) =>
                  setEditando({ ...editando, titular: e.target.value })
                }
                className="h-12 w-full rounded-lg border px-3 text-sm"
                style={surfaceInputStyle}
                placeholder="Compresores del Valle S.A.S."
              />
            </Field>

            <Field label="Marca IVA (opcional)">
              <select
                value={editando.marca_iva ?? ""}
                onChange={(e) =>
                  setEditando({
                    ...editando,
                    marca_iva: e.target.value || null,
                  })
                }
                className="h-12 w-full rounded-lg border px-3 text-sm"
                style={surfaceInputStyle}
              >
                <option value="">— Sin marca —</option>
                <option value="con_iva">IVA incluido</option>
                <option value="sin_iva">Sin IVA</option>
              </select>
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditando(null)}
                disabled={saving}
                className="h-12 rounded-lg border px-4 text-sm cursor-pointer disabled:opacity-50"
                style={{
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={saving}
                className="h-12 rounded-lg px-4 text-sm font-semibold cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{
                  backgroundColor: "hsl(var(--primary))",
                  color: "hsl(var(--primary-foreground))",
                }}
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog />
    </div>
  );
}

/* ── Helpers de presentación ──────────────────────────────────────────── */
// Columna "Default para PDFs" del diseño Lovable sin respaldo en el esquema.
// Se muestra un estado honesto en vez de inventar un checkbox funcional.
function DefaultPdfPlaceholder() {
  return (
    <span
      className="inline-flex items-center gap-2 text-[12px]"
      style={{ color: "hsl(var(--muted-foreground))" }}
      title="Función pendiente: preselección de cuentas en cotizaciones"
    >
      <span
        className="grid h-4 w-4 place-items-center rounded border"
        style={{
          borderColor: "hsl(var(--border))",
          backgroundColor: "hsl(var(--muted) / 0.3)",
        }}
      />
      No configurable aún
    </span>
  );
}

function IvaPill({ marca }) {
  if (!marca)
    return (
      <span
        className="text-[11px]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        —
      </span>
    );
  const token = marca === "con_iva" ? "--info" : "--warning";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none"
      style={pillStyle(token)}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: `hsl(var(${token}))` }}
      />
      {marca === "con_iva" ? "IVA incluido" : "Sin IVA"}
    </span>
  );
}

function EstadoPill({ activo }) {
  const token = activo ? "--success" : "--muted-foreground";
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none"
      style={pillStyle(token)}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: `hsl(var(${token}))` }}
      />
      {activo ? "Activo" : "Inactivo"}
    </span>
  );
}

function IconBtn({ children, label, onClick, token }) {
  const color = token ? `hsl(var(${token}))` : "hsl(var(--muted-foreground))";
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-9 w-9 place-items-center rounded-md transition-colors cursor-pointer"
      style={{ color }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.backgroundColor = "hsl(var(--muted) / 0.5)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
    >
      {children}
    </button>
  );
}

function Banner({ type, children }) {
  return (
    <div
      role={type === "destructive" ? "alert" : "status"}
      className="rounded-lg border px-3 py-2 text-xs"
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

function InfoBanner({ title, children }) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border p-4"
      style={{
        backgroundColor: "hsl(var(--info) / 0.08)",
        borderColor: "hsl(var(--info) / 0.3)",
      }}
    >
      <Info
        className="mt-0.5 h-4 w-4 shrink-0"
        strokeWidth={1.75}
        style={{ color: "hsl(var(--info))" }}
      />
      <div>
        <div
          className="text-[13px] font-medium"
          style={{ color: "hsl(var(--info))" }}
        >
          {title}
        </div>
        <div
          className="mt-0.5 text-[12px] leading-relaxed"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span
        className="mb-1 block text-xs font-medium"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Empty({ icon, children }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 text-5xl">{icon}</div>
      <p style={{ color: "hsl(var(--muted-foreground))" }}>{children}</p>
    </div>
  );
}
