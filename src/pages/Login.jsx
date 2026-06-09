import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { supabase } from "../lib/supabase";
import { usuarioDisplayName } from "../lib/user-display";
import loginBg from "../assets/login-bg.jpg";
import Logo from "../components/ui/Logo";

/* ── Role config ───────────────────────────────────────────────────────── */
const ROLE_GRADIENTS = {
  Admin: "from-blue-500 to-blue-700",
  Bodeguero: "from-amber-500 to-amber-700",
  Vendedor: "from-emerald-500 to-emerald-700",
  Tecnico: "from-violet-500 to-violet-700",
};
const ROLE_BADGE = {
  Admin: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
  Bodeguero: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  Vendedor: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  Tecnico: "bg-violet-500/10 text-violet-400 border border-violet-500/20",
};
const ROLE_LABEL = {
  Admin: "Administrador",
  Bodeguero: "Bodeguero",
  Vendedor: "Vendedor",
  Tecnico: "Técnico",
};
const SEDE_LABEL = {
  BODEGA: "Bodega Principal",
  CV: "Almacén CV",
  L3: "Almacén L3",
  CHV: "Almacén CHV",
};
/** Orden de presentación de los roles en el paso de selección. */
const ROLE_ORDER = ["Admin", "Vendedor", "Bodeguero", "Tecnico"];

const getInitials = (name = "") =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/* ── SVG icons (no lucide dependency) ─────────────────────────────────── */
function ShieldIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

/* ── Role glyph (icono por rol) ────────────────────────────────────────── */
function RoleGlyph({ rol }) {
  const p = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  if (rol === "Admin")
    return (
      <svg {...p}>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    );
  if (rol === "Vendedor")
    return (
      <svg {...p}>
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
    );
  if (rol === "Bodeguero")
    return (
      <svg {...p}>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <path d="M3.27 6.96 12 12.01l8.73-5.05" />
        <path d="M12 22.08V12" />
      </svg>
    );
  if (rol === "Tecnico")
    return (
      <svg {...p}>
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    );
  return (
    <svg {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

/* ── Role card (step 0) ────────────────────────────────────────────────── */
function RoleCard({ rol, count, onSelect }) {
  const grad = ROLE_GRADIENTS[rol] || "from-slate-500 to-slate-700";
  return (
    <button
      type="button"
      onClick={() => onSelect(rol)}
      className="w-full flex items-center gap-3 p-4 rounded-xl transition-all text-left group cursor-pointer"
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.08)";
        e.currentTarget.style.borderColor = "rgba(59,130,246,0.3)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.03)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
      }}
    >
      <div
        className={`w-11 h-11 rounded-xl bg-gradient-to-br ${grad} flex items-center justify-center text-white shadow-lg flex-shrink-0`}
      >
        <RoleGlyph rol={rol} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white/90">
          {ROLE_LABEL[rol] || rol}
        </p>
        <p className="text-[11px] text-white/40 mt-0.5">
          {count} usuario{count === 1 ? "" : "s"}
        </p>
      </div>
      <span className="text-white/30 opacity-0 group-hover:opacity-100 transition-opacity">
        <ChevronRightIcon />
      </span>
    </button>
  );
}

/* ── User card (step 1) ────────────────────────────────────────────────── */
function UserCard({ usuario, onSelect }) {
  const grad = ROLE_GRADIENTS[usuario.rol] || "from-slate-500 to-slate-700";
  const badge =
    ROLE_BADGE[usuario.rol] ||
    "bg-slate-500/10 text-slate-400 border border-slate-500/20";
  const displayName = usuarioDisplayName(usuario);
  const initials = getInitials(displayName);
  const sedeDisplay = SEDE_LABEL[usuario.sede_id] || usuario.sede_id || "";

  return (
    <button
      type="button"
      onClick={() => onSelect(usuario)}
      className="w-full flex items-center gap-3 p-3.5 rounded-xl transition-all text-left group cursor-pointer"
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.08)";
        e.currentTarget.style.borderColor = "rgba(59,130,246,0.3)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.03)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
      }}
    >
      <div
        className={`w-10 h-10 rounded-full bg-gradient-to-br ${grad} flex items-center justify-center text-xs font-bold text-white shadow-lg flex-shrink-0`}
      >
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white/90">{displayName}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${badge}`}>
            {ROLE_LABEL[usuario.rol] || usuario.rol}
          </span>
          {sedeDisplay && (
            <span className="text-[10px] text-white/35">{sedeDisplay}</span>
          )}
        </div>
      </div>
      <span className="text-white/30 opacity-0 group-hover:opacity-100 transition-opacity">
        <ChevronRightIcon />
      </span>
    </button>
  );
}

/* ── PIN input box ─────────────────────────────────────────────────────── */
function PinInput({ value, inputRef, onChange, onKeyDown, index }) {
  return (
    <input
      ref={inputRef}
      type="password"
      inputMode="numeric"
      maxLength={1}
      value={value}
      onChange={(e) => onChange(index, e.target.value)}
      onKeyDown={(e) => onKeyDown(index, e)}
      autoComplete="off"
      className="w-14 h-16 text-center text-2xl font-bold rounded-xl outline-none transition-all duration-200 text-white"
      style={{
        background: value ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.05)",
        border: `2px solid ${value ? "rgba(59,130,246,0.4)" : "rgba(255,255,255,0.1)"}`,
        boxShadow: value ? "0 0 20px rgba(59,130,246,0.1)" : "none",
      }}
      onFocus={(e) => {
        e.target.style.borderColor = "rgba(59,130,246,0.5)";
        e.target.style.boxShadow = "0 0 20px rgba(59,130,246,0.15)";
      }}
      onBlur={(e) => {
        e.target.style.borderColor = value
          ? "rgba(59,130,246,0.4)"
          : "rgba(255,255,255,0.1)";
        e.target.style.boxShadow = value
          ? "0 0 20px rgba(59,130,246,0.1)"
          : "none";
      }}
    />
  );
}

/* ── Main Login ────────────────────────────────────────────────────────── */
export default function Login() {
  const navigate = useNavigate();
  const {
    login,
    loading: authLoading,
    error: storeError,
    clearError,
    session,
    perfil,
  } = useAuthStore();

  const [usuarios, setUsuarios] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [selectedRole, setSelectedRole] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [pin, setPin] = useState(["", "", "", ""]);
  const [localError, setLocalError] = useState("");
  const [shake, setShake] = useState(false);
  const [cargando, setCargando] = useState(false);

  const inputRefs = useRef([]);

  /* Roles disponibles (con conteo) derivados de los usuarios cargados */
  const rolesDisponibles = useMemo(() => {
    const counts = {};
    for (const u of usuarios) counts[u.rol] = (counts[u.rol] || 0) + 1;
    const ordenados = ROLE_ORDER.filter((r) => counts[r]);
    const otros = Object.keys(counts).filter((r) => !ROLE_ORDER.includes(r));
    return [...ordenados, ...otros].map((rol) => ({ rol, count: counts[rol] }));
  }, [usuarios]);

  /* Usuarios del rol seleccionado */
  const usuariosDelRol = useMemo(
    () => usuarios.filter((u) => u.rol === selectedRole),
    [usuarios, selectedRole],
  );

  /* Redirect if already authed */
  useEffect(() => {
    if (!authLoading && session && perfil) {
      navigate(perfil.rol === "Admin" ? "/admin" : "/ops", { replace: true });
    }
  }, [authLoading, session, perfil, navigate]);

  /* Load users */
  useEffect(() => {
    supabase
      .from("usuarios")
      .select("id, nombre, rol, sede_id")
      .eq("activo", true)
      .order("nombre")
      .then(({ data, error }) => {
        if (error) {
          setLocalError(
            "No se pudieron cargar los usuarios. Revisa tu conexión.",
          );
        } else if (data) {
          setUsuarios(data);
        }
        setLoadingUsers(false);
      })
      .catch(() => {
        setLocalError(
          "No se pudieron cargar los usuarios. Revisa tu conexión.",
        );
        setLoadingUsers(false);
      });
  }, []);

  /* Clear errors when user changes */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalError("");
    clearError();
  }, [selectedUser]); // eslint-disable-line

  /* Auto-focus first input when user selected */
  useEffect(() => {
    if (selectedUser) {
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  }, [selectedUser]);

  const doLogin = useCallback(
    async (fullPin) => {
      if (!selectedUser || cargando) return;
      setCargando(true);
      setLocalError("");
      clearError();
      const ok = await login(selectedUser, fullPin);
      setCargando(false);
      if (!ok) {
        setLocalError("PIN incorrecto. Intente de nuevo.");
        setShake(true);
        setTimeout(() => {
          setShake(false);
          setPin(["", "", "", ""]);
          inputRefs.current[0]?.focus();
        }, 500);
      }
    },
    [selectedUser, cargando, login, clearError],
  );

  const handlePinChange = (index, value) => {
    if (!/^\d*$/.test(value)) return;
    const newPin = [...pin];
    newPin[index] = value.slice(-1);
    setPin(newPin);
    setLocalError("");

    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }
    if (index === 3 && value) {
      const full = newPin.join("");
      if (full.length === 4) doLogin(full);
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === "Backspace" && !pin[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const selectRole = (rol) => {
    setSelectedRole(rol);
    setSelectedUser(null);
    setPin(["", "", "", ""]);
    setLocalError("");
    clearError();
  };

  const backToRole = () => {
    setSelectedRole(null);
    setSelectedUser(null);
    setPin(["", "", "", ""]);
    setLocalError("");
    clearError();
  };

  const selectUser = (u) => {
    setSelectedUser(u);
    setPin(["", "", "", ""]);
    setLocalError("");
    clearError();
  };

  const backToSelect = () => {
    setSelectedUser(null);
    setPin(["", "", "", ""]);
    setLocalError("");
    clearError();
  };

  const displayError = localError || storeError;

  /* Loading screen */
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const selectedGrad = selectedUser
    ? ROLE_GRADIENTS[selectedUser.rol] || "from-slate-500 to-slate-700"
    : "";
  const selectedBadge = selectedUser ? ROLE_BADGE[selectedUser.rol] || "" : "";
  const selectedDisplayName = selectedUser
    ? usuarioDisplayName(selectedUser)
    : "";

  return (
    <div className="min-h-screen flex relative overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0">
        <img src={loginBg} alt="" className="w-full h-full object-cover" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, rgba(15,23,42,0.92) 0%, rgba(15,23,42,0.82) 50%, rgba(30,58,100,0.88) 100%)",
          }}
        />
      </div>

      {/* Decorative grid */}
      <div className="absolute inset-0 opacity-[0.04] bg-grid pointer-events-none" />

      {/* Left branding (desktop) */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative z-10">
        <div className="flex items-center gap-3">
          <Logo className="w-11 h-11 shadow-lg shadow-blue-500/25" />
          <div>
            <h1 className="text-xl font-bold text-white">COMPRESORES</h1>
            <p className="text-[10px] tracking-[0.35em] uppercase text-white/50">
              del Valle S.A.S.
            </p>
          </div>
        </div>

        <div className="space-y-8">
          <div>
            <h2 className="text-4xl font-bold leading-tight text-white">
              Sistema de Gestión
              <br />
              <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                Operativa
              </span>
            </h2>
            <p className="mt-4 text-base leading-relaxed max-w-md text-white/60">
              Plataforma integral para el control de inventario, ventas,
              compras, logística y servicio técnico.
            </p>
          </div>
          <div className="flex gap-8">
            {[
              { label: "Sedes", value: "4" },
              { label: "Productos", value: "+2,500" },
              { label: "Módulos", value: "17" },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="text-2xl font-bold text-white">{stat.value}</p>
                <p className="text-xs text-white/40">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-white/25">
          © 2026 Compresores del Valle S.A.S. · Cali, Colombia
        </p>
      </div>

      {/* Right login panel */}
      <div className="flex-1 flex items-center justify-center p-6 relative z-10">
        <div className="w-full max-w-md">
          {/* Glass card */}
          <div
            className="backdrop-blur-xl rounded-2xl border p-8 shadow-2xl"
            style={{
              backgroundColor: "rgba(255,255,255,0.05)",
              borderColor: "rgba(255,255,255,0.1)",
              boxShadow:
                "0 25px 50px -12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)",
            }}
          >
            {/* Mobile logo */}
            <div className="lg:hidden text-center mb-8">
              <Logo className="w-16 h-16 mx-auto mb-3 shadow-lg shadow-blue-500/25" />
              <h1 className="text-lg font-bold text-white">
                COMPRESORES DEL VALLE
              </h1>
              <p className="text-[10px] tracking-[0.3em] text-white/40">
                S.A.S.
              </p>
            </div>

            {/* ── STEP 0: Select role ─────────────────────────────────── */}
            {!selectedRole && (
              <div className="space-y-6 animate-fade-in">
                <div className="text-center space-y-2">
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center mx-auto text-blue-400"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(59,130,246,0.15), rgba(59,130,246,0.05))",
                      border: "1px solid rgba(59,130,246,0.2)",
                    }}
                  >
                    <ShieldIcon />
                  </div>
                  <h2 className="text-lg font-semibold text-white">
                    Iniciar sesión
                  </h2>
                  <p className="text-sm text-white/50">¿Cuál es tu rol?</p>
                </div>

                <div className="space-y-2">
                  {loadingUsers ? (
                    <div className="flex items-center justify-center py-10">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : rolesDisponibles.length === 0 ? (
                    <p className="text-center text-sm text-white/40 py-6">
                      No hay usuarios disponibles.
                    </p>
                  ) : (
                    rolesDisponibles.map(({ rol, count }) => (
                      <RoleCard
                        key={rol}
                        rol={rol}
                        count={count}
                        onSelect={selectRole}
                      />
                    ))
                  )}
                </div>
              </div>
            )}

            {/* ── STEP 1: Select user (filtrado por rol) ──────────────── */}
            {selectedRole && !selectedUser && (
              <div className="space-y-6 animate-fade-in">
                <button
                  type="button"
                  onClick={backToRole}
                  className="text-sm flex items-center gap-1 text-white/40 hover:text-white/80 transition-colors cursor-pointer"
                >
                  ← Cambiar rol
                </button>

                <div className="text-center space-y-2">
                  <div
                    className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${
                      ROLE_GRADIENTS[selectedRole] ||
                      "from-slate-500 to-slate-700"
                    } flex items-center justify-center mx-auto text-white shadow-lg`}
                  >
                    <RoleGlyph rol={selectedRole} />
                  </div>
                  <h2 className="text-lg font-semibold text-white">
                    {ROLE_LABEL[selectedRole] || selectedRole}
                  </h2>
                  <p className="text-sm text-white/50">Selecciona tu usuario</p>
                </div>

                <div className="space-y-2">
                  {usuariosDelRol.map((u) => (
                    <UserCard key={u.id} usuario={u} onSelect={selectUser} />
                  ))}
                </div>
              </div>
            )}

            {/* ── STEP 2: PIN entry ───────────────────────────────────── */}
            {selectedUser && (
              <div className="space-y-8 animate-fade-in">
                <button
                  type="button"
                  onClick={backToSelect}
                  className="text-sm flex items-center gap-1 text-white/40 hover:text-white/80 transition-colors cursor-pointer"
                >
                  ← Cambiar usuario
                </button>

                <div className="text-center space-y-4">
                  <div
                    className={`w-16 h-16 rounded-full bg-gradient-to-br ${selectedGrad} flex items-center justify-center mx-auto text-xl font-bold text-white shadow-xl`}
                  >
                    {getInitials(selectedDisplayName)}
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      {selectedDisplayName}
                    </h2>
                    <div className="flex items-center justify-center gap-2 mt-1">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full ${selectedBadge}`}
                      >
                        {ROLE_LABEL[selectedUser.rol] || selectedUser.rol}
                      </span>
                      {selectedUser.sede_id && (
                        <span className="text-xs text-white/40">
                          {SEDE_LABEL[selectedUser.sede_id] ||
                            selectedUser.sede_id}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="flex items-center justify-center gap-1.5 text-white/50 text-sm">
                    <LockIcon />
                    <span>Ingrese su PIN de acceso</span>
                  </div>

                  <div
                    className={`flex justify-center gap-3 ${shake ? "animate-shake" : ""}`}
                  >
                    {pin.map((digit, i) => (
                      <PinInput
                        key={i}
                        index={i}
                        value={digit}
                        inputRef={(el) => {
                          inputRefs.current[i] = el;
                        }}
                        onChange={handlePinChange}
                        onKeyDown={handleKeyDown}
                      />
                    ))}
                  </div>

                  {displayError && (
                    <div className="flex items-center justify-center gap-2 text-sm text-red-400 animate-fade-in">
                      <AlertIcon />
                      {displayError}
                    </div>
                  )}

                  {cargando && (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm text-white/40">
                        Verificando...
                      </span>
                    </div>
                  )}

                  {import.meta.env.DEV && !cargando && !displayError && (
                    <p className="text-center text-xs text-white/30">
                      PIN de prueba:{" "}
                      <span className="font-mono font-medium text-white/50">
                        1234
                      </span>
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <p className="lg:hidden text-center mt-6 text-[10px] text-white/20">
            © 2026 Compresores del Valle S.A.S.
          </p>
        </div>
      </div>
    </div>
  );
}
