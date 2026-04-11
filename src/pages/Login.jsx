import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { supabase } from "../lib/supabase";

/* ── Constants ────────────────────────────────────────────────────────── */
const AVATAR_COLORS = {
  Admin: "#1d4ed8",
  Bodeguero: "#b45309",
  Vendedor: "#16a34a",
  Tecnico: "#7c3aed",
};

const ROL_LABEL = {
  Admin: "Administrador",
  Bodeguero: "Bodeguero",
  Vendedor: "Vendedor",
  Tecnico: "Técnico",
};

const SEDE_LABEL = {
  "BOD-PRINCIPAL": "Bodega Principal",
  "ALM-01": "Almacén Norte",
  "ALM-02": "Almacén Sur",
  "ALM-03": "Almacén Centro",
};

const KEYPAD = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["back", "0", "enter"],
];

/* ── Helpers ──────────────────────────────────────────────────────────── */
const getInitials = (name = "") =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const getAvatarColor = (rol) => AVATAR_COLORS[rol] || "#475569";

/* ── SVG icons ────────────────────────────────────────────────────────── */
function BackspaceSVG() {
  return (
    <svg
      width="20"
      height="16"
      viewBox="0 0 22 18"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M20.5 1H8.83A2 2 0 0 0 7.41 1.59L1.5 8l5.91 6.41A2 2 0 0 0 8.83 15H20.5a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="m14.5 5.5-4 4m0-4 4 4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronRightSVG() {
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
      aria-hidden="true"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

function ShieldSVG() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function LockSVG() {
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
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}

function ArrowLeftSVG() {
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
      aria-hidden="true"
    >
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

/* ── Keypad button ────────────────────────────────────────────────────── */
function KeyBtn({ k, onClick, disabled }) {
  const isBack = k === "back";
  const isEnter = k === "enter";
  const isNum = !isBack && !isEnter;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={isBack ? "Borrar" : isEnter ? "Entrar" : `Dígito ${k}`}
      className={`
        h-14 rounded-xl flex items-center justify-center select-none
        cursor-pointer transition-all duration-100 focus:outline-none
        ${disabled ? "opacity-40 cursor-not-allowed" : "active:scale-95"}
        ${isNum ? "bg-white/10 hover:bg-white/20 text-white text-xl font-semibold" : ""}
        ${isBack ? "bg-white/5 hover:bg-white/10 text-slate-400" : ""}
        ${isEnter ? (disabled ? "bg-slate-700 text-slate-500" : "bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm tracking-widest") : ""}
      `}
    >
      {isBack && <BackspaceSVG />}
      {isEnter && "ENTRAR"}
      {isNum && k}
    </button>
  );
}

/* ── PIN box ──────────────────────────────────────────────────────────── */
function PinBox({ filled, isNew }) {
  return (
    <div
      className={`
        w-14 h-16 rounded-xl border-2 flex items-center justify-center
        transition-all duration-150
        ${filled ? "border-blue-400 bg-white/10" : "border-white/15 bg-white/5"}
        ${isNew ? "scale-105" : "scale-100"}
      `}
    >
      {filled && (
        <div className="w-3 h-3 rounded-full bg-blue-400 transition-transform duration-100" />
      )}
    </div>
  );
}

/* ── User card ────────────────────────────────────────────────────────── */
function UserCard({ usuario, onSelect }) {
  const color = getAvatarColor(usuario.rol);
  const initials = getInitials(usuario.nombre);
  const sedeDisplay = SEDE_LABEL[usuario.sede_id] || usuario.sede_id || "";
  const rolDisplay = ROL_LABEL[usuario.rol] || usuario.rol;

  return (
    <button
      type="button"
      onClick={() => onSelect(usuario)}
      className="w-full flex items-center gap-3.5 px-4 py-3.5 border-b border-white/5 last:border-b-0 hover:bg-white/5 transition-colors text-left cursor-pointer"
    >
      {/* Avatar */}
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
        style={{ backgroundColor: color }}
      >
        {initials}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-white font-semibold text-sm leading-tight truncate">
          {usuario.nombre}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: `${color}33`, color }}
          >
            {rolDisplay}
          </span>
          {sedeDisplay && (
            <span className="text-slate-500 text-[11px]">{sedeDisplay}</span>
          )}
        </div>
      </div>

      <ChevronRightSVG />
    </button>
  );
}

/* ── Main Login component ─────────────────────────────────────────────── */
export default function Login() {
  const navigate = useNavigate();
  const {
    login,
    loading: authLoading,
    error,
    clearError,
    session,
    perfil,
  } = useAuthStore();

  const [usuarios, setUsuarios] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [pin, setPin] = useState("");
  const [cargando, setCargando] = useState(false);
  const [phase, setPhase] = useState("select"); // 'select' | 'pin'
  const [shaking, setShaking] = useState(false);
  const [lastDot, setLastDot] = useState(-1);

  const handleLoginRef = useRef(null);

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
      .select("nombre, rol, sede_id")
      .eq("activo", true)
      .order("nombre")
      .then(({ data }) => {
        if (data) setUsuarios(data);
        setLoadingUsers(false);
      });
  }, []);

  /* Clear error on user change */
  useEffect(() => {
    clearError();
  }, [selectedUser]); // eslint-disable-line

  /* Login handler */
  const handleLogin = useCallback(async () => {
    if (!selectedUser || pin.length < 4 || cargando) return;
    setCargando(true);
    clearError();
    const ok = await login(selectedUser.nombre, pin);
    setCargando(false);
    if (!ok) {
      setPin("");
      setShaking(true);
      setTimeout(() => setShaking(false), 450);
    }
  }, [selectedUser, pin, cargando, login, clearError]);

  handleLoginRef.current = handleLogin;

  /* Auto-submit at 4 digits */
  useEffect(() => {
    if (pin.length === 4 && selectedUser && phase === "pin") {
      handleLoginRef.current();
    }
  }, [pin]); // eslint-disable-line

  /* Keypad handler */
  const handleKey = useCallback(
    (k) => {
      if (cargando) return;
      if (k === "back") {
        setPin((p) => p.slice(0, -1));
        return;
      }
      if (k === "enter") {
        handleLoginRef.current();
        return;
      }
      if (pin.length < 4) {
        setLastDot(pin.length);
        setTimeout(() => setLastDot(-1), 180);
        setPin((p) => p + k);
      }
    },
    [pin, cargando],
  );

  const selectUser = (u) => {
    setSelectedUser(u);
    setPin("");
    clearError();
    setPhase("pin");
  };

  const backToSelect = () => {
    setPhase("select");
    setSelectedUser(null);
    setPin("");
    clearError();
  };

  /* Loading screen */
  if (authLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: "#0f172a" }}
      >
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <div
      className="min-h-screen flex flex-col md:flex-row md:h-screen md:overflow-hidden relative"
      style={{
        backgroundImage:
          "url('https://images.unsplash.com/photo-1565378935735-a9a52ccee3ac?auto=format&fit=crop&w=2070&q=80')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundColor: "#0a1628",
      }}
    >
      {/* Dark overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "rgba(0,0,0,0.55)" }}
      />

      {/* ── Left: branding overlay (desktop) ──────────────────────────── */}
      <div className="hidden md:flex flex-col justify-between flex-1 relative z-10 px-12 py-12">
        {/* Logo */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold"
              style={{ backgroundColor: "#2563EB" }}
            >
              CV
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-tight tracking-wide uppercase">
                Compresores del Valle
              </p>
              <p className="text-white/40 text-[10px] tracking-widest uppercase">
                S.A.S.
              </p>
            </div>
          </div>
        </div>

        {/* Headline */}
        <div>
          <h1
            className="text-white font-black leading-none mb-3"
            style={{ fontSize: "clamp(2.5rem, 4vw, 4rem)" }}
          >
            Sistema de Gestión
            <br />
            <span style={{ color: "#60a5fa" }}>Operativa</span>
          </h1>
          <p className="text-white/50 text-sm leading-relaxed max-w-xs">
            Plataforma integral para el control de inventario, ventas, compras,
            logística y servicio técnico.
          </p>

          {/* Stats */}
          <div className="flex gap-8 mt-8">
            {[
              { value: "4", label: "Sedes" },
              { value: "+2.500", label: "Productos" },
              { value: "17", label: "Módulos" },
            ].map(({ value, label }) => (
              <div key={label}>
                <p className="text-white text-2xl font-black leading-none">
                  {value}
                </p>
                <p className="text-white/40 text-xs mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="text-white/20 text-xs">
          © 2025 Compresores del Valle S.A.S. · Cali, Colombia
        </p>
      </div>

      {/* ── Right: dark glass panel ────────────────────────────────────── */}
      <div
        className="relative z-10 flex flex-col w-full md:w-[420px] lg:w-[440px] flex-shrink-0"
        style={{
          backgroundColor: "rgba(15,23,42,0.96)",
          backdropFilter: "blur(20px)",
        }}
      >
        <div className="flex-1 flex flex-col justify-center px-8 py-10">
          {/* ══ PHASE 1 — Select user ══════════════════════════════════ */}
          {phase === "select" && (
            <div>
              {/* Header */}
              <div className="flex flex-col items-center mb-8">
                <div className="text-blue-400 mb-3">
                  <ShieldSVG />
                </div>
                <h2 className="text-white text-2xl font-bold">
                  Iniciar sesión
                </h2>
                <p className="text-slate-500 text-sm mt-1">
                  Seleccione su usuario para continuar
                </p>
              </div>

              {/* User cards */}
              <div
                className="rounded-xl overflow-hidden border border-white/8"
                style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
              >
                {loadingUsers ? (
                  <div className="flex items-center justify-center py-10">
                    <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : usuarios.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-8">
                    Sin usuarios disponibles
                  </p>
                ) : (
                  usuarios.map((u) => (
                    <UserCard
                      key={u.nombre}
                      usuario={u}
                      onSelect={selectUser}
                    />
                  ))
                )}
              </div>
            </div>
          )}

          {/* ══ PHASE 2 — Enter PIN ════════════════════════════════════ */}
          {phase === "pin" && selectedUser && (
            <div>
              {/* Back button */}
              <button
                type="button"
                onClick={backToSelect}
                className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm mb-6 transition-colors cursor-pointer"
              >
                <ArrowLeftSVG />
                Cambiar usuario
              </button>

              {/* Selected user display */}
              <div className="flex flex-col items-center mb-8">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold mb-3"
                  style={{ backgroundColor: getAvatarColor(selectedUser.rol) }}
                >
                  {getInitials(selectedUser.nombre)}
                </div>
                <h3 className="text-white text-lg font-bold">
                  {selectedUser.nombre}
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: `${getAvatarColor(selectedUser.rol)}33`,
                      color: getAvatarColor(selectedUser.rol),
                    }}
                  >
                    {ROL_LABEL[selectedUser.rol] || selectedUser.rol}
                  </span>
                  {selectedUser.sede_id && (
                    <span className="text-slate-500 text-xs">
                      {SEDE_LABEL[selectedUser.sede_id] || selectedUser.sede_id}
                    </span>
                  )}
                </div>
              </div>

              {/* PIN label */}
              <div className="flex items-center justify-center gap-1.5 text-slate-400 text-sm mb-4">
                <LockSVG />
                <span>Ingrese su PIN de acceso</span>
              </div>

              {/* PIN boxes */}
              <div
                className={`flex justify-center gap-3 mb-2 ${shaking ? "animate-pulse" : ""}`}
              >
                {[0, 1, 2, 3].map((i) => (
                  <PinBox
                    key={i}
                    filled={i < pin.length}
                    isNew={i === lastDot}
                  />
                ))}
              </div>

              {/* Error */}
              <div className="min-h-[1.5rem] mb-4 flex items-center justify-center">
                {error && (
                  <p className="text-red-400 text-sm font-medium text-center">
                    {error}
                  </p>
                )}
              </div>

              {/* Keypad */}
              <div
                className="rounded-xl p-3"
                style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
              >
                <div className="grid grid-cols-3 gap-2">
                  {KEYPAD.map((row, ri) =>
                    row.map((k) => (
                      <KeyBtn
                        key={`${ri}-${k}`}
                        k={k}
                        onClick={() => handleKey(k)}
                        disabled={
                          cargando ||
                          (k === "enter" &&
                            (!selectedUser || pin.length < 4)) ||
                          (k === "back" && pin.length === 0)
                        }
                      />
                    )),
                  )}
                </div>
              </div>

              {/* Loading indicator */}
              {cargando && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-slate-400 text-sm">Verificando...</span>
                </div>
              )}

              {/* Hint */}
              {!cargando && !error && (
                <p className="text-slate-600 text-xs text-center mt-3">
                  PIN de prueba: 1234
                </p>
              )}
            </div>
          )}
        </div>

        {/* Panel footer */}
        <p className="text-slate-700 text-xs text-center pb-5">
          v2.0 · Uso interno
        </p>
      </div>
    </div>
  );
}
