import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'

/* ─── Icono SVG de engranaje/compresor ─────────────────────────────────── */
function GearIcon({ size = 48, className = '' }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 48 48"
      fill="none" xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M24 30a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"
        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
      />
      <path
        d="M38.4 26.4a2 2 0 0 0 .4 2.2l.14.14a2.42 2.42 0 0 1 0 3.42l-2.16 2.16a2.42 2.42 0 0 1-3.42 0l-.14-.14a2 2 0 0 0-2.2-.4 2 2 0 0 0-1.22 1.84v.2A2.42 2.42 0 0 1 27.38 38H24.6a2.42 2.42 0 0 1-2.42-2.42v-.2a2 2 0 0 0-1.3-1.84 2 2 0 0 0-2.2.4l-.14.14a2.42 2.42 0 0 1-3.42 0l-2.16-2.16a2.42 2.42 0 0 1 0-3.42l.14-.14a2 2 0 0 0 .4-2.2 2 2 0 0 0-1.84-1.22h-.2A2.42 2.42 0 0 1 9 22.38V19.6a2.42 2.42 0 0 1 2.42-2.42h.2a2 2 0 0 0 1.84-1.3 2 2 0 0 0-.4-2.2l-.14-.14a2.42 2.42 0 0 1 0-3.42l2.16-2.16a2.42 2.42 0 0 1 3.42 0l.14.14a2 2 0 0 0 2.2.4A2 2 0 0 0 22.06 6.6v-.2A2.42 2.42 0 0 1 24.48 4h2.78a2.42 2.42 0 0 1 2.42 2.42v.2a2 2 0 0 0 1.3 1.84 2 2 0 0 0 2.2-.4l.14-.14a2.42 2.42 0 0 1 3.42 0l2.16 2.16a2.42 2.42 0 0 1 0 3.42l-.14.14a2 2 0 0 0-.4 2.2 2 2 0 0 0 1.84 1.22h.2A2.42 2.42 0 0 1 42.8 19.68v2.78a2.42 2.42 0 0 1-2.42 2.42h-.2a2 2 0 0 0-1.78 1.52Z"
        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

/* ─── Icono de usuario (dropdown) ──────────────────────────────────────── */
function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 13c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/* ─── Icono de chevron ──────────────────────────────────────────────────── */
function ChevronIcon({ open }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"
      className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
    >
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ─── Icono backspace ───────────────────────────────────────────────────── */
function BackspaceIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 6H9.828a2 2 0 0 0-1.414.586L3 12l5.414 5.414A2 2 0 0 0 9.828 18H21a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <path d="m15 10-4 4m0-4 4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

/* ─── Teclado numérico tipo teléfono ────────────────────────────────────── */
const KEYPAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['⌫', '0', '↵'],
]

const ROL_BADGE = {
  Admin:     'bg-[#14352A] text-white',
  Bodeguero: 'bg-[#1E5740] text-white',
  Vendedor:  'bg-[#C8993E]/20 text-[#A37A28]',
  Tecnico:   'bg-[#2563EB]/15 text-[#1d4ed8]',
}

/* ─── Dropdown custom de usuarios ──────────────────────────────────────── */
function UserDropdown({ usuarios, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const selected = usuarios.find(u => u.nombre === value)

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full h-14 px-4 flex items-center justify-between gap-2 rounded-xl border-2 transition-colors duration-150 cursor-pointer text-left
          ${open ? 'border-primary bg-primary/5' : 'border-border bg-white hover:border-primary/50'}
        `}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="flex items-center gap-3 min-w-0">
          <span className={`flex-shrink-0 ${selected ? 'text-primary' : 'text-text-muted'}`}>
            <UserIcon />
          </span>
          {selected ? (
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-text truncate">{selected.nombre}</span>
              <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none mt-0.5 ${ROL_BADGE[selected.rol] ?? 'bg-border text-text-sub'}`}>
                {selected.rol}
              </span>
            </span>
          ) : (
            <span className="text-text-muted text-sm">Selecciona tu nombre...</span>
          )}
        </span>
        <span className={`flex-shrink-0 ${open ? 'text-primary' : 'text-text-muted'}`}>
          <ChevronIcon open={open} />
        </span>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-50 top-[calc(100%+4px)] left-0 right-0 bg-white rounded-xl border border-border shadow-card overflow-hidden py-1"
        >
          {usuarios.map(u => (
            <li key={u.nombre} role="option" aria-selected={u.nombre === value}>
              <button
                type="button"
                onClick={() => { onChange(u.nombre); setOpen(false) }}
                className={`w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-surface transition-colors cursor-pointer
                  ${u.nombre === value ? 'bg-primary/5' : ''}`}
              >
                <span className="text-text-sub"><UserIcon /></span>
                <span>
                  <span className="block text-sm font-medium text-text">{u.nombre}</span>
                  <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none mt-0.5 ${ROL_BADGE[u.rol] ?? 'bg-border text-text-sub'}`}>
                    {u.rol}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ─── Componente principal ──────────────────────────────────────────────── */
export default function Login() {
  const navigate = useNavigate()
  const { login, loading: authLoading, error, clearError, session, perfil } = useAuthStore()

  const [usuarios,  setUsuarios]  = useState([])
  const [nombre,    setNombre]    = useState('')
  const [pin,       setPin]       = useState('')
  const [shake,     setShake]     = useState(false)
  const [cargando,  setCargando]  = useState(false)
  const [newDot,    setNewDot]    = useState(null)   // índice del dot recién llenado

  /* Redirigir si ya tiene sesión */
  useEffect(() => {
    if (session && perfil) {
      navigate(perfil.rol === 'Admin' ? '/admin' : '/ops', { replace: true })
    }
  }, [session, perfil, navigate])

  /* Cargar usuarios activos (anon policy lo permite) */
  useEffect(() => {
    supabase
      .from('usuarios')
      .select('nombre, rol')
      .eq('activo', true)
      .order('nombre')
      .then(({ data }) => { if (data) setUsuarios(data) })
  }, [])

  /* Limpiar error al cambiar de usuario */
  useEffect(() => { if (error) clearError() }, [nombre]) // eslint-disable-line

  /* Manejar tecla del keypad */
  const handleKey = useCallback((key) => {
    if (cargando) return
    if (key === '⌫') { setPin(p => p.slice(0, -1)); return }
    if (key === '↵') { handleLogin(); return }
    if (pin.length < 4) {
      const newPin = pin + key
      setNewDot(newPin.length - 1)
      setPin(newPin)
      setTimeout(() => setNewDot(null), 200)
    }
  }, [pin, cargando, nombre]) // eslint-disable-line

  /* Auto-submit al 4° dígito */
  useEffect(() => {
    if (pin.length === 4 && nombre) handleLogin()
  }, [pin]) // eslint-disable-line

  const handleLogin = async () => {
    if (!nombre || pin.length < 4 || cargando) return
    setCargando(true)
    clearError()
    const ok = await login(nombre, pin)
    setCargando(false)
    if (!ok) {
      setShake(true)
      setPin('')
      setTimeout(() => setShake(false), 450)
    }
  }

  const handleNombre = (n) => { setNombre(n); setPin('') }

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-surface">

      {/* ══ PANEL IZQUIERDO — Branding (visible en lg+) ══════════════════ */}
      <div
        className="hidden lg:flex lg:w-[45%] xl:w-[42%] flex-col relative overflow-hidden"
        style={{ background: 'linear-gradient(155deg, #14352A 0%, #0D2318 60%, #081910 100%)' }}
      >
        {/* Patrón de fondo sutil */}
        <div className="absolute inset-0 bg-noise opacity-30 pointer-events-none" />

        {/* Líneas decorativas geométricas */}
        <div className="absolute top-0 right-0 w-px h-full bg-white/5" />
        <div className="absolute bottom-0 left-12 right-12 h-px bg-white/10" />
        <div
          className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-5"
          style={{ background: 'radial-gradient(circle, #C8993E 0%, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-32 -left-16 w-80 h-80 rounded-full opacity-5"
          style={{ background: 'radial-gradient(circle, #2D7A5A 0%, transparent 70%)' }}
        />

        {/* Contenido centrado verticalmente */}
        <div className="relative z-10 flex flex-col justify-between h-full px-12 py-14">

          {/* Logo + empresa */}
          <div>
            <div className="flex items-center gap-4 mb-12">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #C8993E 0%, #A37A28 100%)', boxShadow: '0 4px 20px rgba(200,153,62,0.35)' }}
              >
                <GearIcon size={32} className="text-white" />
              </div>
              <div>
                <p className="font-brand font-700 text-white text-xl tracking-wide leading-tight uppercase" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                  Compresores del Valle
                </p>
                <p className="text-white/40 text-xs tracking-widest uppercase" style={{ letterSpacing: '0.15em' }}>
                  S.A.S.
                </p>
              </div>
            </div>

            {/* Tagline */}
            <div>
              <h1
                className="text-white leading-none mb-4"
                style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 'clamp(2.5rem, 3.5vw, 3.5rem)', lineHeight: 1.05, letterSpacing: '-0.01em' }}
              >
                Sistema de<br />Gestión<br />Operativa
              </h1>
              <p className="text-white/50 text-sm leading-relaxed max-w-[280px]">
                Control de inventario, ventas y operaciones
                para la sede principal y almacenes.
              </p>
            </div>
          </div>

          {/* Stats decorativos */}
          <div className="space-y-4">
            <div className="h-px bg-white/10 mb-6" />
            {[
              { label: 'Productos en catálogo', value: '2.000+' },
              { label: 'Sedes conectadas',      value: '4' },
              { label: 'Usuarios operativos',   value: '6' },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-white/40 text-xs">{label}</span>
                <span
                  className="text-white font-semibold text-sm"
                  style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, letterSpacing: '0.02em' }}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══ PANEL DERECHO — Formulario de acceso ═════════════════════════ */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-10 sm:px-10 min-h-screen lg:min-h-0 relative">

        {/* Header móvil / tablet (oculto en lg) */}
        <div className="lg:hidden flex flex-col items-center mb-8 animate-fade-up" style={{ animationDelay: '0ms' }}>
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'linear-gradient(135deg, #14352A 0%, #0D2318 100%)', boxShadow: '0 6px 24px rgba(20,53,42,0.25)' }}
          >
            <GearIcon size={32} className="text-[#C8993E]" />
          </div>
          <h1
            className="text-center text-primary"
            style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: '1.75rem', letterSpacing: '-0.01em' }}
          >
            Compresores del Valle
          </h1>
          <p className="text-text-muted text-sm mt-1">Sistema de Gestión Operativa</p>
        </div>

        {/* Card de login */}
        <div
          className="w-full max-w-[400px] bg-white rounded-2xl p-7 sm:p-8 animate-fade-up"
          style={{ boxShadow: '0 8px 48px rgba(0,0,0,0.10)', animationDelay: '60ms' }}
        >
          {/* Título del formulario */}
          <div className="mb-6">
            <h2 className="text-text font-semibold text-lg">Acceso al sistema</h2>
            <p className="text-text-muted text-sm mt-0.5">Selecciona tu usuario e ingresa tu PIN</p>
          </div>

          {/* Selector de usuario */}
          <div className="mb-5 animate-fade-up" style={{ animationDelay: '120ms' }}>
            <label className="block text-xs font-semibold text-text-sub uppercase tracking-widest mb-2">
              Usuario
            </label>
            <UserDropdown
              usuarios={usuarios}
              value={nombre}
              onChange={handleNombre}
            />
          </div>

          {/* Indicador PIN */}
          <div className="mb-5 animate-fade-up" style={{ animationDelay: '180ms' }}>
            <label className="block text-xs font-semibold text-text-sub uppercase tracking-widest mb-3">
              PIN de acceso
            </label>

            {/* 4 círculos indicadores */}
            <div className={`flex justify-center gap-4 mb-2 ${shake ? 'animate-shake' : ''}`}>
              {[0, 1, 2, 3].map(i => (
                <div
                  key={i}
                  className="relative w-4 h-4"
                >
                  {/* Círculo base (vacío) */}
                  <div
                    className={`absolute inset-0 rounded-full border-2 transition-all duration-200
                      ${i < pin.length ? 'border-primary' : 'border-border bg-surface'}`}
                  />
                  {/* Relleno con animación */}
                  {i < pin.length && (
                    <div
                      className={`absolute inset-[3px] rounded-full bg-primary ${i === newDot ? 'animate-fill-dot' : ''}`}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Mensaje de error */}
            {error && (
              <p className="text-center text-stock-out text-sm font-medium mt-2 animate-fade-up">
                {error}
              </p>
            )}
          </div>

          {/* Teclado numérico */}
          <div className="grid grid-cols-3 gap-2.5 mb-5 animate-fade-up" style={{ animationDelay: '240ms' }}>
            {KEYPAD.map((row, ri) =>
              row.map((key) => {
                const isBack    = key === '⌫'
                const isConfirm = key === '↵'
                const disabled  = isConfirm
                  ? (!nombre || pin.length < 4 || cargando)
                  : isBack
                  ? (pin.length === 0)
                  : false

                return (
                  <button
                    key={`${ri}-${key}`}
                    type="button"
                    onClick={() => handleKey(key)}
                    disabled={disabled}
                    aria-label={isBack ? 'Borrar' : isConfirm ? 'Entrar' : key}
                    className={`
                      relative h-[56px] rounded-xl flex items-center justify-center
                      font-semibold text-xl select-none
                      transition-all duration-100 active:scale-95 focus:outline-none
                      focus-visible:ring-2 focus-visible:ring-primary/50
                      ${isConfirm
                        ? `text-white disabled:opacity-35 disabled:cursor-not-allowed
                           disabled:shadow-none cursor-pointer`
                        : isBack
                        ? 'bg-surface text-text-sub disabled:opacity-30 cursor-pointer'
                        : 'bg-surface border border-border text-text hover:border-primary/40 hover:bg-primary/5 cursor-pointer'
                      }
                    `}
                    style={isConfirm ? {
                      background: disabled
                        ? '#9CA3AB'
                        : 'linear-gradient(135deg, #C8993E 0%, #A37A28 100%)',
                      boxShadow: disabled ? 'none' : '0 3px 12px rgba(200,153,62,0.35)',
                    } : isBack ? {} : {
                      boxShadow: '0 1px 0 0 #DDD9D0',
                    }}
                  >
                    {cargando && isConfirm ? (
                      <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin block" />
                    ) : isBack ? (
                      <BackspaceIcon />
                    ) : isConfirm ? (
                      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.05em', fontSize: '1rem', fontWeight: 700 }}>
                        ENTRAR
                      </span>
                    ) : (
                      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: '1.5rem', lineHeight: 1 }}>
                        {key}
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>

          {/* Botón "Entrar" accesible extra para teclado físico */}
          <button
            type="button"
            onClick={handleLogin}
            disabled={!nombre || pin.length < 4 || cargando}
            className="w-full h-14 rounded-xl font-semibold text-white text-base
                       transition-all duration-150 active:scale-[0.985]
                       disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none
                       focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-accent
                       animate-fade-up"
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 700,
              fontSize: '1.0625rem',
              letterSpacing: '0.06em',
              background: 'linear-gradient(135deg, #C8993E 0%, #A37A28 100%)',
              boxShadow: '0 4px 18px rgba(200,153,62,0.35)',
              animationDelay: '300ms',
            }}
          >
            {cargando ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin block" />
                VERIFICANDO...
              </span>
            ) : 'INGRESAR AL SISTEMA'}
          </button>
        </div>

        {/* Footer */}
        <p className="mt-6 text-text-muted text-xs text-center animate-fade-up" style={{ animationDelay: '360ms' }}>
          Compresores del Valle S.A.S. · v2.0 · Uso interno
        </p>
      </div>
    </div>
  )
}
