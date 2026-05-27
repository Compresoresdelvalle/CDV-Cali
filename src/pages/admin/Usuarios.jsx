import { useState, useEffect, useRef, useMemo } from "react";
import { Plus, Pencil, Shield, Search, Power, Mail } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { safeError } from "../../lib/utils";
import { useAuthStore } from "../../stores/authStore";
import { useDebounce } from "../../hooks/useDebounce";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import {
  rolToken,
  sedeToken,
  iniciales,
  pillStyle,
  surfaceInputStyle,
  permisosResumen,
  ultimaConexionLabel,
} from "../../lib/admin-config-ui";

const ROLES = ["Admin", "Bodeguero", "Vendedor", "Tecnico"];

export default function Usuarios() {
  const perfil = useAuthStore((s) => s.perfil);
  const [usuarios, setUsuarios] = useState([]);
  const [sedes, setSedes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [editando, setEditando] = useState(null); // user object or null
  const [search, setSearch] = useState("");
  const busqueda = useDebounce(search, 400);
  const mountedRef = useRef(true);
  const guardandoRef = useRef(false);
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
          .select("id, nombre, rol, sede_id, activo, ultimo_login")
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
    if (!editando.nombre.trim()) {
      setErrorMsg("El nombre es obligatorio.");
      return;
    }
    // Anti-lockout: bloquear la auto-desactivación también desde el modal
    // (el servidor lo refuerza vía trg_usuarios_inmutables).
    if (editando.id === perfil?.id && !editando.activo) {
      setErrorMsg("No puedes desactivar tu propio usuario (lockout).");
      return;
    }
    if (guardandoRef.current) return;
    guardandoRef.current = true;
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
      setOkMsg(`Usuario "${editando.nombre.trim()}" actualizado`);
      setEditando(null);
      await cargar();
    } catch (err) {
      setErrorMsg(safeError(err, "Error al guardar"));
    } finally {
      guardandoRef.current = false;
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

  const nombreSede = (sedeId) =>
    sedes.find((s) => s.id === sedeId)?.nombre ?? sedeId ?? "—";

  // Filtrado client-side por nombre/rol/sede (debounced 400ms)
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return usuarios;
    return usuarios.filter((u) =>
      `${u.nombre} ${u.rol} ${nombreSede(u.sede_id)}`.toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarios, busqueda, sedes]);

  const counts = useMemo(
    () => ({
      total: usuarios.length,
      activos: usuarios.filter((u) => u.activo).length,
      admin: usuarios.filter((u) => u.rol === "Admin").length,
      vendedor: usuarios.filter((u) => u.rol === "Vendedor").length,
      bodeguero: usuarios.filter((u) => u.rol === "Bodeguero").length,
      tecnico: usuarios.filter((u) => u.rol === "Tecnico").length,
    }),
    [usuarios],
  );

  // Anti-lockout: único Admin activo no puede auto-desactivarse / cambiar rol.
  const adminsActivos = counts.admin
    ? usuarios.filter((u) => u.rol === "Admin" && u.activo).length
    : 0;
  const esUnicoAdmin = (u) =>
    u.rol === "Admin" && u.activo && adminsActivos === 1;

  return (
    <div className="flex flex-col gap-6 px-5 pb-8 pt-6 sm:px-7 animate-fade-in">
      {/* Page head */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="m-0 mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Admin · Usuarios
          </p>
          <h1
            className="m-0 text-[24px] font-semibold leading-tight tracking-[-0.018em]"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Gestión de usuarios
          </h1>
          <p
            className="mt-1 text-[13px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {loading ? (
              "Cargando…"
            ) : (
              <>
                <CountNum>{counts.total}</CountNum> usuarios ·{" "}
                <CountNum>{counts.activos}</CountNum> activos ·{" "}
                <CountNum>{counts.admin}</CountNum> Admin ·{" "}
                <CountNum>{counts.vendedor}</CountNum> Vendedores ·{" "}
                <CountNum>{counts.bodeguero}</CountNum> Bodegueros ·{" "}
                <CountNum>{counts.tecnico}</CountNum> Técnico
              </>
            )}
          </p>
        </div>
        {/* Alta de usuarios vive en Supabase Auth (ver banner). Se expone el
            CTA del diseño Lovable como deshabilitado para mantener fidelidad. */}
        <button
          type="button"
          disabled
          title="La creación de cuentas se hace en Supabase Auth (ver aviso)"
          className="inline-flex h-11 items-center gap-1.5 rounded-md px-4 text-[12.5px] font-semibold opacity-50 cursor-not-allowed"
          style={{
            backgroundColor: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
          }}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Nuevo usuario
        </button>
      </div>

      {errorMsg && <Banner type="destructive">{errorMsg}</Banner>}
      {okMsg && <Banner type="success">{okMsg}</Banner>}

      {/* Banner alta de usuarios (Supabase Auth) */}
      <InfoBanner
        icon={Shield}
        title="Crear usuarios nuevos requiere Supabase Auth"
      >
        Agrega primero la cuenta en Supabase (Dashboard → Authentication →
        Users). Aquí se gestiona <b>rol, sede y estado activo</b>. Un único
        Admin activo no puede desactivar su propia cuenta ni cambiar su rol
        (protección anti-lockout, reforzada en el servidor).
      </InfoBanner>

      {/* Toolbar de búsqueda */}
      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-[320px]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            style={{ color: "hsl(var(--muted-foreground))" }}
            strokeWidth={1.75}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, rol o sede…"
            aria-label="Buscar usuarios"
            className="h-11 w-full rounded-md border pl-9 pr-3 text-[13px] focus:outline-none"
            style={surfaceInputStyle}
          />
        </div>
      </div>

      {loading ? (
        <SkeletonList />
      ) : filtrados.length === 0 ? (
        <Empty icon="👤">
          {busqueda ? "Sin usuarios que coincidan" : "Sin usuarios"}
        </Empty>
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
                    "",
                    "Nombre",
                    "Rol",
                    "Sede default",
                    "Estado",
                    "Última conexión",
                    "Permisos resumen",
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
                {filtrados.map((u) => {
                  const token = rolToken(u.rol);
                  const locked = esUnicoAdmin(u) && u.id === perfil?.id;
                  return (
                    <tr
                      key={u.id}
                      className="border-t align-middle"
                      style={{
                        borderColor: "hsl(var(--border) / 0.6)",
                        opacity: u.activo ? 1 : 0.55,
                      }}
                    >
                      <td className="px-3 py-3">
                        <span
                          className="grid h-8 w-8 place-items-center rounded-full font-mono text-[11px] font-semibold"
                          style={pillStyle(token)}
                        >
                          {iniciales(u.nombre)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <p
                          className="text-[13px] font-medium"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {u.nombre}
                        </p>
                        {/* Email vive en auth.users (no en `usuarios`): estado
                            vacío honesto, no se inventa una dirección. */}
                        <p
                          className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11px]"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          <Mail className="h-3 w-3" strokeWidth={1.75} />
                          gestionado en Auth
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className="inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium leading-none"
                          style={pillStyle(token)}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: `hsl(var(${token}))` }}
                          />
                          {u.rol}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className="inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[11.5px] font-medium tracking-[0.02em]"
                          style={{
                            borderColor: "hsl(var(--border))",
                            backgroundColor: "hsl(var(--muted) / 0.4)",
                            color: "hsl(var(--muted-foreground))",
                          }}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{
                              backgroundColor: `hsl(var(${sedeToken(u.sede_id)}))`,
                            }}
                          />
                          {nombreSede(u.sede_id)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <EstadoPill activo={u.activo} />
                      </td>
                      <td
                        className="px-3 py-3 font-mono text-[11.5px]"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {ultimaConexionLabel(u.ultimo_login)}
                      </td>
                      <td
                        className="px-3 py-3 text-[12px] leading-[1.4]"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {permisosResumen(u.rol)}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <IconBtn
                            label="Editar usuario"
                            onClick={() => setEditando({ ...u })}
                          >
                            <Pencil
                              className="h-3.5 w-3.5"
                              strokeWidth={1.75}
                            />
                          </IconBtn>
                          <IconBtn
                            label={u.activo ? "Desactivar" : "Activar"}
                            token={u.activo ? "--destructive" : "--success"}
                            disabled={locked}
                            title={
                              locked
                                ? "Eres el único Admin activo: no puedes desactivar tu cuenta"
                                : undefined
                            }
                            onClick={() => toggleActivo(u)}
                          >
                            <Power className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </IconBtn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="divide-y md:hidden" role="list">
            {filtrados.map((u) => {
              const token = rolToken(u.rol);
              const locked = esUnicoAdmin(u) && u.id === perfil?.id;
              return (
                <li
                  key={u.id}
                  className="px-4 py-3.5"
                  style={{
                    borderColor: "hsl(var(--border))",
                    opacity: u.activo ? 1 : 0.55,
                  }}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-mono text-[12px] font-semibold"
                      style={pillStyle(token)}
                    >
                      {iniciales(u.nombre)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className="text-sm font-semibold"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {u.nombre}
                        </p>
                        <span
                          className="inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium leading-none"
                          style={pillStyle(token)}
                        >
                          {u.rol}
                        </span>
                        <EstadoPill activo={u.activo} />
                      </div>
                      <p
                        className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            backgroundColor: `hsl(var(${sedeToken(u.sede_id)}))`,
                          }}
                        />
                        {nombreSede(u.sede_id)}
                        <span style={{ color: "hsl(var(--border))" }}>·</span>
                        {ultimaConexionLabel(u.ultimo_login)}
                      </p>
                      <p
                        className="mt-0.5 text-[11px] leading-[1.4]"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {permisosResumen(u.rol)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setEditando({ ...u })}
                      className="h-11 flex-1 rounded-lg border text-xs font-semibold cursor-pointer"
                      style={{
                        borderColor: "hsl(var(--primary))",
                        color: "hsl(var(--primary))",
                      }}
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => toggleActivo(u)}
                      disabled={locked}
                      title={
                        locked
                          ? "Eres el único Admin activo: no puedes desactivar tu cuenta"
                          : undefined
                      }
                      className="h-11 flex-1 rounded-lg border text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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
                </li>
              );
            })}
          </ul>

          {/* Footer resumen por sede */}
          <FooterResumen usuarios={usuarios} sedes={sedes} />
        </section>
      )}

      {/* Modal edit */}
      {editando && (
        <ModalEditar
          editando={editando}
          setEditando={setEditando}
          guardar={guardar}
          sedes={sedes}
          esYo={editando.id === perfil?.id}
        />
      )}
      <ConfirmDialog />
    </div>
  );
}

/* ── Modal de edición ─────────────────────────────────────────────────── */
function ModalEditar({ editando, setEditando, guardar, sedes, esYo }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={() => setEditando(null)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full overflow-y-auto rounded-t-2xl border p-5 sm:max-w-md sm:rounded-2xl"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <h2
          className="mb-4 text-lg font-semibold"
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
              className="h-12 w-full rounded-lg border px-3 text-sm"
              style={surfaceInputStyle}
            />
          </Field>
          <Field label="Rol">
            <select
              disabled={esYo}
              title={esYo ? "No puedes cambiar tu propio rol" : undefined}
              value={editando.rol}
              onChange={(e) =>
                setEditando({ ...editando, rol: e.target.value })
              }
              className="h-12 w-full rounded-lg border px-3 text-sm disabled:opacity-50"
              style={surfaceInputStyle}
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
              disabled={esYo}
              title={esYo ? "No puedes cambiar tu propia sede" : undefined}
              value={editando.sede_id ?? ""}
              onChange={(e) =>
                setEditando({ ...editando, sede_id: e.target.value })
              }
              className="h-12 w-full rounded-lg border px-3 text-sm disabled:opacity-50"
              style={surfaceInputStyle}
            >
              <option value="">— Sin asignar —</option>
              {sedes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </Field>
          <label
            className="flex items-center gap-2 cursor-pointer"
            title={esYo ? "No puedes desactivar tu propio usuario" : undefined}
          >
            <input
              type="checkbox"
              checked={editando.activo}
              disabled={esYo}
              onChange={(e) =>
                setEditando({ ...editando, activo: e.target.checked })
              }
              className="h-5 w-5"
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
            className="h-12 flex-1 rounded-lg border text-sm font-medium cursor-pointer"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            className="h-12 flex-1 rounded-lg text-sm font-medium cursor-pointer transition-opacity hover:opacity-90"
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
  );
}

/* ── Footer resumen por sede ──────────────────────────────────────────── */
function FooterResumen({ usuarios, sedes }) {
  const porSede = sedes
    .map((s) => ({
      id: s.id,
      nombre: s.nombre,
      n: usuarios.filter((u) => u.sede_id === s.id).length,
    }))
    .filter((x) => x.n > 0);

  // Última actividad = login más reciente entre todos los usuarios (dato real).
  const ultima = usuarios
    .map((u) => u.ultimo_login)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5"
      style={{
        borderColor: "hsl(var(--border))",
        backgroundColor: "hsl(var(--muted) / 0.3)",
      }}
    >
      <span
        className="flex flex-wrap items-center gap-x-1 gap-y-1 font-mono text-[11.5px]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {usuarios.length} usuarios
        {porSede.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1">
            <span style={{ color: "hsl(var(--border))" }}>·</span>
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: `hsl(var(${sedeToken(s.id)}))` }}
            />
            {s.nombre} <b style={{ color: "hsl(var(--foreground))" }}>{s.n}</b>
          </span>
        ))}
      </span>
      <span
        className="text-[11.5px]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        Última actividad:{" "}
        <span className="font-mono" style={{ color: "hsl(var(--foreground))" }}>
          {ultimaConexionLabel(ultima)}
        </span>
      </span>
    </div>
  );
}

/* ── Helpers de presentación ──────────────────────────────────────────── */
function CountNum({ children }) {
  return (
    <span
      className="font-mono tabular-nums"
      style={{ color: "hsl(var(--foreground))" }}
    >
      {children}
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

function IconBtn({ children, label, onClick, token, disabled, title }) {
  const color = token ? `hsl(var(${token}))` : "hsl(var(--muted-foreground))";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className="grid h-9 w-9 place-items-center rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ color }}
      onMouseEnter={(e) => {
        if (!disabled)
          e.currentTarget.style.backgroundColor = "hsl(var(--muted) / 0.5)";
      }}
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

function InfoBanner({ icon, title, children }) {
  const Icon = icon;
  return (
    <div
      className="flex items-start gap-3 rounded-lg border p-4"
      style={{
        backgroundColor: "hsl(var(--info) / 0.08)",
        borderColor: "hsl(var(--info) / 0.3)",
      }}
    >
      <Icon
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
        className="mb-1.5 block text-xs font-medium"
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

function SkeletonList() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => (
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
  );
}
