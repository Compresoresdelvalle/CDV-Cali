import { useState, useEffect, useRef } from "react";
import { supabase } from "../../../lib/supabase";
import { safeError } from "../../../lib/utils";
import { useConfirm } from "../../../components/ui/ConfirmDialog";

export default function ChecklistOT() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [editando, setEditando] = useState(null); // item o {nuevo:true}
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);
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
    const orden = Number.isFinite(Number(editando.orden))
      ? Number(editando.orden)
      : 0;
    setSaving(true);
    setErrorMsg("");
    setOkMsg("");
    try {
      const payload = { nombre, orden, activo: editando.activo ?? true };
      if (editando.nuevo) {
        const { error } = await supabase
          .from("checklist_componentes")
          .insert(payload);
        if (error) throw error;
        setOkMsg(`Componente "${nombre}" creado`);
      } else {
        const { error } = await supabase
          .from("checklist_componentes")
          .update(payload)
          .eq("id", editando.id);
        if (error) throw error;
        setOkMsg(`Componente "${nombre}" actualizado`);
      }
      setEditando(null);
      await cargar();
    } catch (err) {
      setErrorMsg(safeError(err, "Error al guardar"));
    } finally {
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
      setOkMsg(`Componente ${it.activo ? "desactivado" : "activado"}`);
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

      <div
        className="rounded-lg border px-3 py-2 text-xs"
        style={{
          backgroundColor: "hsl(var(--info) / 0.08)",
          borderColor: "hsl(var(--info) / 0.4)",
          color: "hsl(var(--info))",
        }}
      >
        ℹ️ Componentes que aparecen en el checklist al recibir un equipo en
        Órdenes de Trabajo. Lo no marcado en una OT = no llegó (soporte legal).
      </div>

      <div className="flex justify-between items-center">
        <p
          className="text-xs"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {loading ? "Cargando…" : `${items.length} componentes`}
        </p>
        <button
          onClick={() =>
            setEditando({ nuevo: true, orden: 0, activo: true, nombre: "" })
          }
          className="text-xs px-3 py-2 rounded-lg cursor-pointer min-h-[48px]"
          style={{
            backgroundColor: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
          }}
        >
          + Nuevo componente
        </button>
      </div>

      {loading ? (
        <div className="space-y-1.5">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="rounded-lg p-2 animate-pulse border h-10"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            />
          ))}
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5" role="list">
          {items.map((it) => (
            <li
              key={it.id}
              className="rounded-lg border px-3 py-2 flex items-center justify-between gap-2"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
                opacity: it.activo ? 1 : 0.5,
              }}
            >
              <div className="min-w-0 flex-1">
                <p
                  className="text-sm font-medium truncate"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {it.nombre}
                </p>
                <p
                  className="text-[10px] font-mono"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  orden {it.orden} {!it.activo && "· inactivo"}
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => setEditando({ ...it })}
                  className="text-xs px-2 py-1.5 rounded-lg border cursor-pointer min-h-[44px]"
                  style={{
                    borderColor: "hsl(var(--primary))",
                    color: "hsl(var(--primary))",
                  }}
                >
                  Editar
                </button>
                <button
                  onClick={() => toggleActivo(it)}
                  className="text-xs px-2 py-1.5 rounded-lg border cursor-pointer min-h-[44px]"
                  style={{
                    borderColor: it.activo
                      ? "hsl(var(--destructive))"
                      : "hsl(var(--success))",
                    color: it.activo
                      ? "hsl(var(--destructive))"
                      : "hsl(var(--success))",
                  }}
                >
                  {it.activo ? "Desactivar" : "Activar"}
                </button>
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
              {editando.nuevo ? "Nuevo componente" : "Editar componente"}
            </h3>

            <label className="block">
              <span
                className="block text-xs font-medium mb-1"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Nombre
              </span>
              <input
                type="text"
                value={editando.nombre ?? ""}
                onChange={(e) =>
                  setEditando({ ...editando, nombre: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border text-sm min-h-[48px]"
                style={{
                  backgroundColor: "hsl(var(--background))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
                placeholder="Ej: Filtro de aire"
              />
            </label>

            <label className="block">
              <span
                className="block text-xs font-medium mb-1"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Orden (entero)
              </span>
              <input
                type="number"
                step={1}
                value={editando.orden ?? 0}
                onChange={(e) =>
                  setEditando({ ...editando, orden: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border text-sm min-h-[48px]"
                style={{
                  backgroundColor: "hsl(var(--background))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
              />
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditando(null)}
                disabled={saving}
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
                disabled={saving}
                className="text-sm px-4 py-2 rounded-lg cursor-pointer min-h-[48px] disabled:opacity-50"
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
