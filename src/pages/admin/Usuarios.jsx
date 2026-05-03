import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import { useConfirm } from "../../components/ui/ConfirmDialog";

const ROLES = ["Admin", "Bodeguero", "Vendedor", "Tecnico"];

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [sedes, setSedes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [editando, setEditando] = useState(null); // user object or null
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
      const [u, s] = await Promise.all([
        supabase
          .from("usuarios")
          .select("id, nombre, rol, sede_id, activo")
          .order("nombre"),
        supabase
          .from("sedes")
          .select("id, nombre")
          .eq("activa", true)
          .order("nombre"),
      ]);
      if (!mountedRef.current) return;
      if (u.error) throw u.error;
      if (s.error) throw s.error;
      setUsuarios(u.data ?? []);
      setSedes(s.data ?? []);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar usuarios"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  const guardar = async () => {
    if (!editando) return;
    setErrorMsg("");
    setOkMsg("");
    try {
      const update = {
        nombre: editando.nombre.trim(),
        rol: editando.rol,
        sede_id: editando.sede_id,
        activo: editando.activo,
      };
      const { error } = await supabase
        .from("usuarios")
        .update(update)
        .eq("id", editando.id);
      if (error) throw error;
      setOkMsg(`Usuario "${editando.nombre}" actualizado`);
      setEditando(null);
      await cargar();
    } catch (err) {
      setErrorMsg(safeError(err, "Error al guardar"));
    }
  };

  const toggleActivo = async (u) => {
    // Anti-lockout: el Admin no puede desactivarse a sí mismo
    if (u.id === perfil?.id && u.activo) {
      setErrorMsg("No puedes desactivarte a ti mismo (lockout)");
      return;
    }
    const ok = await confirm({
      titulo: `${u.activo ? "Desactivar" : "Activar"} usuario`,
      mensaje: `${u.activo ? "Desactivar" : "Activar"} a ${u.nombre}?${u.activo ? " Si tiene sesión activa será cerrada en su próxima request." : ""}`,
      confirmLabel: u.activo ? "Desactivar" : "Activar",
      danger: u.activo,
    });
    if (!ok) return;
    setErrorMsg("");
    try {
      const { error } = await supabase
        .from("usuarios")
        .update({ activo: !u.activo })
        .eq("id", u.id);
      if (error) throw error;
      setOkMsg(`Usuario ${u.activo ? "desactivado" : "activado"}`);
      await cargar();
    } catch (err) {
      setErrorMsg(safeError(err, "Error"));
    }
  };

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Gestión de usuarios"
        description={loading ? "Cargando…" : `${usuarios.length} usuarios`}
      />

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
        ℹ️ Crear usuarios nuevos requiere agregarlos primero en Supabase Auth
        (Dashboard → Authentication → Users). Aquí se gestiona{" "}
        <strong>rol, sede y estado activo</strong>.
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
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
          {usuarios.map((u) => (
            <li
              key={u.id}
              className="rounded-lg border p-3"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
                opacity: u.activo ? 1 : 0.6,
              }}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p
                      className="text-sm font-semibold"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {u.nombre}
                    </p>
                    <span
                      className="px-2 py-0.5 rounded text-xs font-medium"
                      style={{
                        backgroundColor:
                          u.rol === "Admin"
                            ? "hsl(var(--primary) / 0.15)"
                            : "hsl(var(--muted) / 0.4)",
                        color:
                          u.rol === "Admin"
                            ? "hsl(var(--primary))"
                            : "hsl(var(--muted-foreground))",
                      }}
                    >
                      {u.rol}
                    </span>
                    {!u.activo && (
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
                    Sede:{" "}
                    {sedes.find((s) => s.id === u.sede_id)?.nombre ??
                      u.sede_id ??
                      "—"}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => setEditando({ ...u })}
                    className="text-xs px-3 py-2 rounded-lg border cursor-pointer"
                    style={{
                      borderColor: "hsl(var(--primary))",
                      color: "hsl(var(--primary))",
                    }}
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => toggleActivo(u)}
                    className="text-xs px-3 py-2 rounded-lg border cursor-pointer"
                    style={{
                      borderColor: u.activo
                        ? "hsl(var(--destructive))"
                        : "hsl(var(--success))",
                      color: u.activo
                        ? "hsl(var(--destructive))"
                        : "hsl(var(--success))",
                    }}
                  >
                    {u.activo ? "Desactivar" : "Activar"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Modal edit */}
      {editando && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => setEditando(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5"
            style={{ backgroundColor: "hsl(var(--card))" }}
          >
            <h2
              className="text-lg font-semibold mb-4"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Editar usuario
            </h2>
            <div className="space-y-3">
              <Field label="Nombre">
                <input
                  type="text"
                  value={editando.nombre}
                  onChange={(e) =>
                    setEditando({ ...editando, nombre: e.target.value })
                  }
                  className="w-full h-12 px-3 rounded-lg border text-sm"
                  style={inputStyle}
                />
              </Field>
              <Field label="Rol">
                <select
                  disabled={editando.id === perfil?.id}
                  title={
                    editando.id === perfil?.id
                      ? "No puedes cambiar tu propio rol"
                      : undefined
                  }
                  value={editando.rol}
                  onChange={(e) =>
                    setEditando({ ...editando, rol: e.target.value })
                  }
                  className="w-full h-12 px-3 rounded-lg border text-sm"
                  style={inputStyle}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sede">
                <select
                  disabled={editando.id === perfil?.id}
                  title={
                    editando.id === perfil?.id
                      ? "No puedes cambiar tu propia sede"
                      : undefined
                  }
                  value={editando.sede_id ?? ""}
                  onChange={(e) =>
                    setEditando({ ...editando, sede_id: e.target.value })
                  }
                  className="w-full h-12 px-3 rounded-lg border text-sm"
                  style={inputStyle}
                >
                  <option value="">— Sin asignar —</option>
                  {sedes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editando.activo}
                  onChange={(e) =>
                    setEditando({ ...editando, activo: e.target.checked })
                  }
                  className="w-5 h-5"
                />
                <span
                  className="text-sm"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  Usuario activo
                </span>
              </label>
            </div>
            <div className="flex gap-2 pt-4">
              <button
                onClick={() => setEditando(null)}
                className="flex-1 h-12 rounded-lg text-sm font-medium border cursor-pointer"
                style={{
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={guardar}
                className="flex-1 h-12 rounded-lg text-sm font-medium cursor-pointer"
                style={{
                  backgroundColor: "hsl(var(--primary))",
                  color: "hsl(var(--primary-foreground))",
                }}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog />
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
