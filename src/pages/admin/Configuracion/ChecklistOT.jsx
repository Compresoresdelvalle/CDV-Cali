import { useState, useEffect, useRef } from "react";
import { AlertTriangle, Plus, Pencil, Power, Info } from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { safeError } from "../../../lib/utils";
import { avisarOk, avisarError } from "../../../lib/notify";
import { useConfirm } from "../../../components/ui/ConfirmDialog";
import { pillStyle, surfaceInputStyle } from "../../../lib/admin-config-ui";

export default function ChecklistOT() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [editando, setEditando] = useState(null); // item o {nuevo:true}
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
        .from("checklist_componentes")
        .select("*")
        .order("activo", { ascending: false })
        .order("orden")
        .order("nombre");
      if (!mountedRef.current) return;
      if (error) throw error;
      setItems(data ?? []);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar checklist"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  const guardar = async () => {
    if (!editando) return;
    const nombre = editando.nombre?.trim();
    if (!nombre) {
      setErrorMsg("Nombre obligatorio");
      return;
    }
    // `orden` siempre entero >= 0 (el ordenamiento del checklist lo asume).
    const orden = Math.max(0, Math.trunc(Number(editando.orden) || 0));
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setErrorMsg("");
    try {
      const payload = { nombre, orden, activo: editando.activo ?? true };
      if (editando.nuevo) {
        const { error } = await supabase
          .from("checklist_componentes")
          .insert(payload);
        if (error) throw error;
        avisarOk(`Componente "${nombre}" creado`);
      } else {
        const { error } = await supabase
          .from("checklist_componentes")
          .update(payload)
          .eq("id", editando.id);
        if (error) throw error;
        avisarOk(`Componente "${nombre}" actualizado`);
      }
      setEditando(null);
      await cargar();
    } catch (err) {
      avisarError(err, "Error al guardar");
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const toggleActivo = async (it) => {
    const ok = await confirm({
      titulo: `${it.activo ? "Desactivar" : "Activar"} componente`,
      mensaje: `${it.activo ? "Desactivar" : "Activar"} "${it.nombre}"? Las OT existentes no se verán afectadas; solo cambia su disponibilidad para nuevas OT.`,
      confirmLabel: it.activo ? "Desactivar" : "Activar",
      danger: it.activo,
    });
    if (!ok) return;
    try {
      const { error } = await supabase
        .from("checklist_componentes")
        .update({ activo: !it.activo })
        .eq("id", it.id);
      if (error) throw error;
      avisarOk(`Componente ${it.activo ? "desactivado" : "activado"}`);
      await cargar();
    } catch (err) {
      avisarError(err, "Error");
    }
  };

  const activos = items.filter((i) => i.activo).length;

  return (
    <div className="flex flex-col gap-4">
      {errorMsg && <Banner type="destructive">{errorMsg}</Banner>}

      {/* Banner: no afecta OTs ya creadas */}
      <WarnBanner title="Los cambios no afectan OTs ya creadas">
        Modificar el checklist <b>NO afecta OTs ya creadas</b>. Los cambios
        aplican solo a OTs nuevas a partir del guardado. Lo no marcado en una OT
        = no llegó (soporte legal).
      </WarnBanner>

      <div className="flex items-center justify-between gap-3">
        <p
          className="text-xs"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {loading
            ? "Cargando…"
            : `${items.length} componentes · ${activos} activos`}
        </p>
        <button
          onClick={() =>
            setEditando({ nuevo: true, orden: 0, activo: true, nombre: "" })
          }
          className="inline-flex h-12 items-center gap-1.5 rounded-md px-4 text-[12.5px] font-semibold transition-opacity cursor-pointer hover:opacity-90"
          style={{
            backgroundColor: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
          }}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Nuevo componente
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-lg border"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Empty icon="📋">Sin componentes en el checklist</Empty>
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
                  {["#", "Ítem del checklist", "Orden", "Estado", ""].map(
                    (c, i) => (
                      <th
                        key={c || i}
                        className="px-3 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em]"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {c}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr
                    key={it.id}
                    className="border-t align-middle"
                    style={{
                      borderColor: "hsl(var(--border) / 0.6)",
                      opacity: it.activo ? 1 : 0.5,
                    }}
                  >
                    <td
                      className="px-3 py-2.5 font-mono text-[11px]"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </td>
                    <td
                      className="px-3 py-2.5 text-[13px] font-medium"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {it.nombre}
                    </td>
                    <td
                      className="px-3 py-2.5 font-mono text-[12px] tabular-nums"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {it.orden}
                    </td>
                    <td className="px-3 py-2.5">
                      <EstadoPill activo={it.activo} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <IconBtn
                          label="Editar componente"
                          onClick={() => setEditando({ ...it })}
                        >
                          <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </IconBtn>
                        <IconBtn
                          label={it.activo ? "Desactivar" : "Activar"}
                          token={it.activo ? "--destructive" : "--success"}
                          onClick={() => toggleActivo(it)}
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
            {items.map((it, i) => (
              <li
                key={it.id}
                className="flex items-center justify-between gap-2 px-4 py-3"
                style={{
                  borderColor: "hsl(var(--border))",
                  opacity: it.activo ? 1 : 0.5,
                }}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-medium"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    <span
                      className="mr-2 font-mono text-[11px]"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {it.nombre}
                  </p>
                  <p
                    className="mt-0.5 font-mono text-[10px]"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    orden {it.orden} {!it.activo && "· inactivo"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <IconBtn
                    label="Editar componente"
                    onClick={() => setEditando({ ...it })}
                  >
                    <Pencil className="h-4 w-4" strokeWidth={1.75} />
                  </IconBtn>
                  <IconBtn
                    label={it.activo ? "Desactivar" : "Activar"}
                    token={it.activo ? "--destructive" : "--success"}
                    onClick={() => toggleActivo(it)}
                  >
                    <Power className="h-4 w-4" strokeWidth={1.75} />
                  </IconBtn>
                </div>
              </li>
            ))}
          </ul>

          {/* Footer info + CTA (replica el pie del diseño Lovable) */}
          <div
            className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5"
            style={{
              borderColor: "hsl(var(--border))",
              backgroundColor: "hsl(var(--muted) / 0.3)",
            }}
          >
            <span
              className="flex items-start gap-1.5 text-[12px] leading-relaxed"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              <Info
                className="mt-0.5 h-3 w-3 shrink-0"
                strokeWidth={1.75}
                style={{ color: "hsl(var(--info))" }}
              />
              El orden controla la secuencia de inspección física en cada OT
              nueva.
            </span>
            <button
              onClick={() =>
                setEditando({ nuevo: true, orden: 0, activo: true, nombre: "" })
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
              Agregar ítem al checklist
            </button>
          </div>
        </section>
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
              {editando.nuevo ? "Nuevo componente" : "Editar componente"}
            </h3>

            <Field label="Nombre">
              <input
                type="text"
                value={editando.nombre ?? ""}
                onChange={(e) =>
                  setEditando({ ...editando, nombre: e.target.value })
                }
                className="h-12 w-full rounded-lg border px-3 text-sm"
                style={surfaceInputStyle}
                placeholder="Ej: Filtro de aire"
              />
            </Field>

            <Field label="Orden (entero)">
              <input
                type="number"
                step={1}
                value={editando.orden ?? 0}
                onChange={(e) =>
                  setEditando({ ...editando, orden: e.target.value })
                }
                className="h-12 w-full rounded-lg border px-3 text-sm"
                style={surfaceInputStyle}
              />
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
      className="grid h-11 w-11 place-items-center rounded-md transition-colors cursor-pointer md:h-9 md:w-9"
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

function WarnBanner({ title, children }) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border p-4"
      style={{
        backgroundColor: "hsl(var(--warning) / 0.08)",
        borderColor: "hsl(var(--warning) / 0.3)",
      }}
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0"
        strokeWidth={1.75}
        style={{ color: "hsl(var(--warning))" }}
      />
      <div>
        <div
          className="text-[13px] font-medium"
          style={{ color: "hsl(var(--warning))" }}
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
