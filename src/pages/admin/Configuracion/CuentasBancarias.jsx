import { useState, useEffect, useRef } from "react";
import { supabase } from "../../../lib/supabase";
import { safeError } from "../../../lib/utils";
import { useConfirm } from "../../../components/ui/ConfirmDialog";

const TIPOS = ["Ahorros", "Corriente", "Digital"];

export default function CuentasBancarias() {
  const [cuentas, setCuentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [editando, setEditando] = useState(null); // cuenta o {nuevo:true}
  const [saving, setSaving] = useState(false);
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

  return (
    <div className="space-y-3">
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

      <div className="flex justify-between items-center">
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
          className="text-xs px-3 py-2 rounded-lg cursor-pointer min-h-[40px]"
          style={{
            backgroundColor: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
          }}
        >
          + Nueva cuenta
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="rounded-xl p-4 animate-pulse border h-16"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            />
          ))}
        </div>
      ) : (
        <ul className="space-y-2" role="list">
          {cuentas.map((c) => (
            <li
              key={c.id}
              className="rounded-lg border p-3"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
                opacity: c.activo ? 1 : 0.6,
              }}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p
                      className="text-sm font-semibold"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {c.banco}
                    </p>
                    <span
                      className="px-2 py-0.5 rounded text-xs font-medium"
                      style={{
                        backgroundColor: "hsl(var(--muted) / 0.4)",
                        color: "hsl(var(--muted-foreground))",
                      }}
                    >
                      {c.tipo}
                    </span>
                    {c.marca_iva && (
                      <span
                        className="px-2 py-0.5 rounded text-xs font-medium"
                        style={{
                          backgroundColor:
                            c.marca_iva === "con_iva"
                              ? "hsl(var(--info) / 0.15)"
                              : "hsl(var(--warning) / 0.15)",
                          color:
                            c.marca_iva === "con_iva"
                              ? "hsl(var(--info))"
                              : "hsl(var(--warning))",
                        }}
                      >
                        {c.marca_iva === "con_iva" ? "Con IVA" : "Sin IVA"}
                      </span>
                    )}
                    {!c.activo && (
                      <span
                        className="px-2 py-0.5 rounded text-xs font-medium"
                        style={{
                          backgroundColor: "hsl(var(--destructive) / 0.15)",
                          color: "hsl(var(--destructive))",
                        }}
                      >
                        Inactivo
                      </span>
                    )}
                  </div>
                  <p
                    className="text-xs font-mono"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {c.numero}
                    {c.titular ? ` · ${c.titular}` : ""}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => setEditando({ ...c })}
                    className="text-xs px-3 py-2 rounded-lg border cursor-pointer min-h-[40px]"
                    style={{
                      borderColor: "hsl(var(--primary))",
                      color: "hsl(var(--primary))",
                    }}
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => toggleActivo(c)}
                    className="text-xs px-3 py-2 rounded-lg border cursor-pointer min-h-[40px]"
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
              </div>
            </li>
          ))}
        </ul>
      )}

      {editando && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => !saving && setEditando(null)}
        >
          <div
            className="rounded-xl border p-5 w-full max-w-md space-y-3"
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
                className="w-full px-3 py-2 rounded-lg border text-sm min-h-[40px]"
                style={{
                  backgroundColor: "hsl(var(--background))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
                placeholder="Ej: Bancolombia"
              />
            </Field>

            <Field label="Tipo">
              <select
                value={editando.tipo}
                onChange={(e) =>
                  setEditando({ ...editando, tipo: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border text-sm min-h-[40px]"
                style={{
                  backgroundColor: "hsl(var(--background))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
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
                className="w-full px-3 py-2 rounded-lg border text-sm font-mono min-h-[40px]"
                style={{
                  backgroundColor: "hsl(var(--background))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
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
                className="w-full px-3 py-2 rounded-lg border text-sm min-h-[40px]"
                style={{
                  backgroundColor: "hsl(var(--background))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
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
                className="w-full px-3 py-2 rounded-lg border text-sm min-h-[40px]"
                style={{
                  backgroundColor: "hsl(var(--background))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
              >
                <option value="">— Sin marca —</option>
                <option value="con_iva">Con IVA</option>
                <option value="sin_iva">Sin IVA</option>
              </select>
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditando(null)}
                disabled={saving}
                className="text-sm px-4 py-2 rounded-lg border cursor-pointer min-h-[40px] disabled:opacity-50"
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
                className="text-sm px-4 py-2 rounded-lg cursor-pointer min-h-[40px] disabled:opacity-50"
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

function Field({ label, children }) {
  return (
    <label className="block">
      <span
        className="block text-xs font-medium mb-1"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
