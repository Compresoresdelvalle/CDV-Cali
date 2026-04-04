import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'

/* ─────────────────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────────────────── */
const ROL_CONFIG = {
  Admin:     { bg: '#0D2318', text: '#FFFFFF' },
  Bodeguero: { bg: '#14352A', text: '#FFFFFF' },
  Vendedor:  { bg: '#A37A28', text: '#FFFFFF' },
  Tecnico:   { bg: '#1d4ed8', text: '#FFFFFF' },
}

const KEYPAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['back', '0', 'enter'],
]

/* ─────────────────────────────────────────────────────────────────────────
   SVG ICONS  (no emojis)
───────────────────────────────────────────────────────────────────────── */
function GearSVG({ size = 40, className = '' }) {
  const cx = 20, cy = 20
  const teeth = [0, 60, 120, 180, 240, 300].map(deg => {
    const r = (deg * Math.PI) / 180
    return {
      x1: (cx + 6.5 * Math.cos(r)).toFixed(2),
      y1: (cy + 6.5 * Math.sin(r)).toFixed(2),
      x2: (cx + 9.5 * Math.cos(r)).toFixed(2),
      y2: (cy + 9.5 * Math.sin(r)).toFixed(2),
    }
  })
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none"
         xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      {/* Hex frame */}
      <polygon points="20,2 35,11 35,29 20,38 5,29 5,11"
               stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.45" />
      {/* Gear body */}
      <circle cx="20" cy="20" r="5" stroke="currentColor" strokeWidth="2" />
      {/* Teeth */}
      {teeth.map((t, i) => (
        <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      ))}
      {/* Hub */}
      <circle cx="20" cy="20" r="1.5" fill="currentColor" />
    </svg>
  )
}

function PersonSVG({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="6.5" r="2.8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.5 15c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ChevronSVG({ open }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"
         className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BackspaceSVG() {
  return (
    <svg width="22" height="18" viewBox="0 0 22 18" fill="none" aria-hidden="true">
      <path d="M20.5 1H8.83A2 2 0 0 0 7.41 1.59L1.5 8l5.91 6.41A2 2 0 0 0 8.83 15H20.5a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2Z"
            stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <path d="m14.5 5.5-4 4m0-4 4 4"
            stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

function CheckSVG() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2.5 7l3.5 3.5 5.5-6.5"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   ROLE BADGE
───────────────────────────────────────────────────────────────────────── */
function RolBadge({ rol }) {
  const cfg = ROL_CONFIG[rol] ?? { bg: '#636B74', text: '#fff' }
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wide leading-none flex-shrink-0"
      style={{ backgroundColor: cfg.bg, color: cfg.text }}
    >
      {rol}
    </span>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   CUSTOM USER DROPDOWN
   Only rendered in Phase 1 — no keypad below, z-index issue is impossible
───────────────────────────────────────────────────────────────────────── */
function UserDropdown({ usuarios, value, onChange, loading }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const selected = usuarios.find(u => u.nombre === value)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Seleccionar usuario"
        onClick={() => !loading && setOpen(o => !o)}
        className={`
          w-full h-14 px-4 rounded-xl border-2 flex items-center gap-3
          cursor-pointer text-left transition-all duration-150
          focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14352A]/30
          ${open
            ? 'border-[#14352A] bg-white shadow-lg'
            : 'border-[#E2DED5] bg-white hover:border-[#14352A]/50'
          }
        `}
      >
        <span className={selected ? 'text-[#14352A]' : 'text-[#9CA3AB]'}>
          <PersonSVG size={18} />
        </span>
        <span className="flex-1 min-w-0">
          {loading ? (
            <span className="text-[#9CA3AB] text-sm flex items-center gap-2">
              <span className="w-3 h-3 border border-[#9CA3AB] border-t-transparent rounded-full animate-spin inline-block" />
              Cargando usuarios...
            </span>
          ) : selected ? (
            <span className="flex items-center gap-2.5 min-w-0">
              <span className="text-[#151515] font-semibold text-sm truncate">{selected.nombre}</span>
              <RolBadge rol={selected.rol} />
            </span>
          ) : (
            <span className="text-[#9CA3AB] text-sm">Selecciona tu nombre...</span>
          )}
        </span>
        <span className={`flex-shrink-0 transition-colors ${open ? 'text-[#14352A]' : 'text-[#9CA3AB]'}`}>
          <ChevronSVG open={open} />
        </span>
      </button>

      {/* Dropdown list — z-[9999] safe because there's no keypad in Phase 1 */}
      {open && !loading && (
        <ul
          role="listbox"
          aria-label="Lista de usuarios"
          className="absolute top-[calc(100%+6px)] left-0 right-0 bg-white rounded-xl border border-[#E2DED5] overflow-hidden py-1"
          style={{
            zIndex: 9999,
            boxShadow: '0 16px 48px rgba(0,0,0,0.14), 0 4px 12px rgba(0,0,0,0.08)',
          }}
        >
          {usuarios.length === 0 ? (
            <li className="px-4 py-3 text-sm text-[#9CA3AB] text-center">Sin usuarios disponibles</li>
          ) : (
            usuarios.map(u => {
              const isSel = u.nombre === value
              return (
                <li key={u.nombre} role="option" aria-selected={isSel}>
                  <button
                    type="button"
                    onClick={() => { onChange(u.nombre); setOpen(false) }}
                    className={`
                      w-full px-4 py-3.5 flex items-center gap-3 text-left
                      cursor-pointer transition-colors duration-100
                      ${isSel ? 'bg-[#14352A]/[0.06]' : 'hover:bg-[#F4F1EB]'}
                    `}
                  >
                    <span className={isSel ? 'text-[#14352A]' : 'text-[#9CA3AB]'}>
                      <PersonSVG size={16} />
                    </span>
                    <span className="flex-1 min-w-0 font-medium text-sm text-[#151515] truncate">
                      {u.nombre}
                    </span>
                    <RolBadge rol={u.rol} />
                    {isSel && <span className="text-[#14352A] flex-shrink-0"><CheckSVG /></span>}
                  </button>
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   PIN DOT
───────────────────────────────────────────────────────────────────────── */
function PinDot({ filled, isNew }) {
  return (
    <div
      className={`w-6 h-6 rounded-full border-2 flex items-center justify-center
        transition-colors duration-200
        ${filled ? 'border-[#14352A]' : 'border-[#D5D0C8] bg-[#F4F1EB]'}`}
    >
      {/* Scale from 0→1 on fill, brief 1.15 pop on the newest dot */}
      <div
        className={`w-3 h-3 rounded-full bg-[#14352A] origin-center
          transition-transform duration-150
          ${filled ? (isNew ? 'scale-110' : 'scale-100') : 'scale-0'}`}
      />
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   KEYPAD BUTTON
───────────────────────────────────────────────────────────────────────── */
function KeyBtn({ k, onClick, disabled }) {
  const isBack  = k === 'back'
  const isEnter = k === 'enter'
  const isNum   = !isBack && !isEnter

  const common = `
    h-[56px] rounded-xl flex items-center justify-center select-none
    cursor-pointer transition-all duration-100 focus:outline-none
    focus-visible:ring-2 focus-visible:ring-[#14352A]/25
    ${disabled ? 'opacity-40 cursor-not-allowed' : 'active:translate-y-[2px]'}
  `

  /* Styles */
  const numStyle = {
    backgroundColor: 'white',
    border: '1px solid #E2DED5',
    boxShadow: disabled ? 'none' : '0 3px 0 #C2BCB4, 0 1px 0 #D8D4CC',
    color: '#151515',
  }
  const backStyle = {
    backgroundColor: '#DEDAD3',
    boxShadow: disabled ? 'none' : '0 2px 0 #B8B5AE',
    color: '#636B74',
  }
  const enterStyle = {
    background: disabled
      ? 'linear-gradient(135deg, #9CA3AB 0%, #636B74 100%)'
      : 'linear-gradient(135deg, #C8993E 0%, #A37A28 100%)',
    boxShadow: disabled ? 'none' : '0 3px 0 #7D5E1A',
    color: 'white',
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={isBack ? 'Borrar' : isEnter ? 'Entrar' : `Dígito ${k}`}
      className={common}
      style={isEnter ? enterStyle : isBack ? backStyle : numStyle}
    >
      {isBack  && <BackspaceSVG />}
      {isEnter && (
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: '0.85rem', letterSpacing: '0.1em' }}>
          ENTRAR
        </span>
      )}
      {isNum && (
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: '1.5rem', lineHeight: 1 }}>
          {k}
        </span>
      )}
    </button>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   BRANDING PANEL  (desktop/tablet left side)
───────────────────────────────────────────────────────────────────────── */
function BrandPanel() {
  return (
    <div
      className="relative overflow-hidden flex flex-col h-full"
      style={{ background: 'linear-gradient(158deg, #14352A 0%, #0D2318 55%, #07160D 100%)' }}
    >
      {/* Hex tile pattern */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 0.045,
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='52' height='60' viewBox='0 0 52 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M26 2L50 15.5V44.5L26 58L2 44.5V15.5Z' fill='none' stroke='white' stroke-width='1'/%3E%3C/svg%3E")`,
          backgroundSize: '52px 60px',
        }}
      />

      {/* Radial glows */}
      <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full pointer-events-none"
           style={{ background: 'radial-gradient(circle, rgba(200,153,62,0.18) 0%, transparent 70%)' }} />
      <div className="absolute -bottom-24 -left-16 w-64 h-64 rounded-full pointer-events-none"
           style={{ background: 'radial-gradient(circle, rgba(45,122,90,0.12) 0%, transparent 70%)' }} />

      {/* Content */}
      <div className="relative z-10 flex flex-col h-full px-10 py-12 justify-between">

        {/* Logo + title */}
        <div>
          <div className="flex items-center gap-4 mb-10">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{
                background: 'linear-gradient(135deg, #C8993E 0%, #A37A28 100%)',
                boxShadow: '0 6px 28px rgba(200,153,62,0.38)',
              }}
            >
              <GearSVG size={30} className="text-white" />
            </div>
            <div>
              <p className="text-white leading-tight"
                 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: '1.15rem', letterSpacing: '0.01em' }}>
                Compresores del Valle
              </p>
              <p className="text-white/35 text-[11px] tracking-[0.2em] uppercase">S.A.S.</p>
            </div>
          </div>

          {/* Headline */}
          <div>
            <h1
              className="text-white leading-none mb-4"
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontWeight: 700,
                fontSize: 'clamp(2rem, 2.8vw, 3.25rem)',
                lineHeight: 1.04,
                letterSpacing: '-0.01em',
              }}
            >
              Sistema de<br />Gestión<br />Operativa
            </h1>
            <p className="text-white/45 text-sm leading-relaxed"
               style={{ maxWidth: '26ch' }}>
              Control en tiempo real de inventario, ventas y operaciones para todas las sedes.
            </p>
          </div>
        </div>

        {/* Stats */}
        <div>
          <div className="h-px bg-white/10 mb-5" />
          {[
            { label: 'Productos en catálogo', value: '2.000+' },
            { label: 'Sedes conectadas',       value: '4' },
            { label: 'Usuarios operativos',    value: '6' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between mb-3 last:mb-0">
              <span className="text-white/35 text-xs">{label}</span>
              <span className="text-white font-semibold"
                    style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: '0.875rem', letterSpacing: '0.04em' }}>
                {value}
              </span>
            </div>
          ))}
          <p className="text-white/20 text-[10px] mt-6 leading-none">v2.0 · Uso interno · © 2026</p>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   MAIN LOGIN COMPONENT
───────────────────────────────────────────────────────────────────────── */
export default function Login() {
  const navigate = useNavigate()
  const { login, loading: authLoading, error, clearError, session, perfil } = useAuthStore()

  const [usuarios,     setUsuarios]     = useState([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [nombre,       setNombre]       = useState('')
  const [pin,          setPin]          = useState('')
  const [cargando,     setCargando]     = useState(false)
  const [phase,        setPhase]        = useState('select') // 'select' | 'pin'
  const [shaking,      setShaking]      = useState(false)
  const [lastDot,      setLastDot]      = useState(-1)

  /* Stable ref for handleLogin (used inside handleKey callback) */
  const handleLoginRef = useRef(null)

  /* ── Redirect if already authed ─────────────────────────────────── */
  useEffect(() => {
    if (!authLoading && session && perfil) {
      navigate(perfil.rol === 'Admin' ? '/admin' : '/ops', { replace: true })
    }
  }, [authLoading, session, perfil, navigate])

  /* ── Load users (anon RLS policy allows this) ────────────────────── */
  useEffect(() => {
    supabase
      .from('usuarios')
      .select('nombre, rol')
      .eq('activo', true)
      .order('nombre')
      .then(({ data }) => {
        if (data) setUsuarios(data)
        setLoadingUsers(false)
      })
  }, [])

  /* ── Clear error on user change ──────────────────────────────────── */
  useEffect(() => { clearError() }, [nombre]) // eslint-disable-line

  /* ── Login handler ───────────────────────────────────────────────── */
  const handleLogin = useCallback(async () => {
    if (!nombre || pin.length < 4 || cargando) return
    setCargando(true)
    clearError()
    const ok = await login(nombre, pin)
    setCargando(false)
    if (!ok) {
      setPin('')
      setShaking(true)
      setTimeout(() => setShaking(false), 450)
    }
  }, [nombre, pin, cargando, login, clearError])

  /* Keep ref in sync */
  handleLoginRef.current = handleLogin

  /* ── Auto-submit at 4 digits ─────────────────────────────────────── */
  useEffect(() => {
    if (pin.length === 4 && nombre && phase === 'pin') {
      handleLoginRef.current()
    }
  }, [pin]) // eslint-disable-line

  /* ── Keypad handler ──────────────────────────────────────────────── */
  const handleKey = useCallback((k) => {
    if (cargando) return
    if (k === 'back')  { setPin(p => p.slice(0, -1)); return }
    if (k === 'enter') { handleLoginRef.current(); return }
    if (pin.length < 4) {
      setLastDot(pin.length)
      setTimeout(() => setLastDot(-1), 180)
      setPin(p => p + k)
    }
  }, [pin, cargando])

  const selectedUser = usuarios.find(u => u.nombre === nombre)

  /* ── Loading screen ──────────────────────────────────────────────── */
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F4F1EB] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#14352A] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  /* ─────────────────────────────────────────────────────────────────
     RENDER
  ───────────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen flex flex-col md:flex-row md:h-screen md:overflow-hidden">

      {/* ── Mobile compact header (< md) ─────────────────────────── */}
      <div
        className="md:hidden flex items-center gap-4 px-5 py-5 flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, #14352A 0%, #081910 100%)' }}
      >
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #C8993E 0%, #A37A28 100%)', boxShadow: '0 4px 16px rgba(200,153,62,0.4)' }}
        >
          <GearSVG size={26} className="text-white" />
        </div>
        <div>
          <p className="text-white font-bold leading-tight"
             style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: '1.2rem' }}>
            Compresores del Valle
          </p>
          <p className="text-white/50 text-xs">Sistema de Gestión Operativa</p>
        </div>
      </div>

      {/* ── Desktop/Tablet branding panel (>= md) ────────────────── */}
      <div
        className="hidden md:block flex-shrink-0"
        style={{ width: 'clamp(290px, 42%, 460px)' }}
      >
          <div className="h-full">
          <BrandPanel />
        </div>
      </div>

      {/* ── Form panel ───────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-[#F4F1EB] px-5 py-10 sm:px-10 md:overflow-y-auto">
        <div className="w-full max-w-[400px]">

          {/* Card — NO overflow:hidden so dropdown can escape if needed */}
          <div
            className="bg-white rounded-2xl px-7 py-8"
            style={{ boxShadow: '0 8px 48px rgba(0,0,0,0.09), 0 2px 6px rgba(0,0,0,0.05)' }}
          >

            {/* ══ PHASE 1 — Select user ══════════════════════════ */}
            {phase === 'select' && (
              <div>
                <div className="mb-7">
                  <h2
                    className="text-[#151515] mb-1.5"
                    style={{
                      fontFamily: "'Barlow Condensed', sans-serif",
                      fontWeight: 700,
                      fontSize: '1.9rem',
                      lineHeight: 1.1,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    Bienvenido
                  </h2>
                  <p className="text-[#636B74] text-sm">
                    Selecciona tu usuario para continuar
                  </p>
                </div>

                <div className="mb-5">
                  <label
                    className="block text-[10px] font-bold text-[#636B74] uppercase tracking-[0.15em] mb-2"
                  >
                    Usuario
                  </label>

                  {/*
                    ★ BUG 1 FIX: Dropdown only renders in Phase 1.
                    No keypad exists in this phase → z-index conflict is impossible.
                    The dropdown list uses z-[9999] for maximum safety.
                  */}
                  <UserDropdown
                    usuarios={usuarios}
                    value={nombre}
                    onChange={setNombre}
                    loading={loadingUsers}
                  />
                </div>

                {/* Continue button */}
                <button
                  type="button"
                  onClick={() => nombre && setPhase('pin')}
                  disabled={!nombre || loadingUsers}
                  className="w-full h-14 rounded-xl font-bold text-white
                             cursor-pointer transition-all duration-150
                             active:scale-[0.985]
                             disabled:opacity-40 disabled:cursor-not-allowed
                             focus:outline-none focus-visible:ring-2
                             focus-visible:ring-[#14352A]/40 focus-visible:ring-offset-2"
                  style={{
                    fontFamily: "'Barlow Condensed', sans-serif",
                    fontWeight: 700,
                    fontSize: '1rem',
                    letterSpacing: '0.08em',
                    background: nombre && !loadingUsers
                      ? 'linear-gradient(135deg, #14352A 0%, #0D2318 100%)'
                      : '#9CA3AB',
                    boxShadow: nombre && !loadingUsers
                      ? '0 4px 18px rgba(20,53,42,0.28)'
                      : 'none',
                  }}
                >
                  CONTINUAR →
                </button>
              </div>
            )}

            {/* ══ PHASE 2 — Enter PIN ════════════════════════════ */}
            {phase === 'pin' && (
              <div>
                {/*
                  ★ Selected user chip — click anywhere to go back.
                  No dropdown visible in this phase.
                */}
                <button
                  type="button"
                  onClick={() => { setPhase('select'); setPin(''); clearError() }}
                  className="w-full flex items-center gap-3 mb-6 p-3 rounded-xl
                             border border-[#E2DED5] text-left cursor-pointer
                             hover:border-[#14352A]/30 hover:bg-[#F9F7F4]
                             transition-all duration-150
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14352A]/25"
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: ROL_CONFIG[selectedUser?.rol]?.bg ?? '#14352A' }}
                  >
                    <span className="text-white"><PersonSVG size={17} /></span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[#151515] font-semibold text-sm leading-tight truncate">
                      {selectedUser?.nombre}
                    </p>
                    <RolBadge rol={selectedUser?.rol} />
                  </div>
                  <span className="text-xs text-[#14352A] font-semibold flex-shrink-0 opacity-70">
                    Cambiar ›
                  </span>
                </button>

                {/* PIN label */}
                <label className="block text-[10px] font-bold text-[#636B74] uppercase tracking-[0.15em] mb-4 text-center">
                  PIN de 4 dígitos
                </label>

                {/* PIN dots */}
                <div className={`flex justify-center gap-4 mb-2 ${shaking ? 'animate-shake' : ''}`}>
                  {[0, 1, 2, 3].map(i => (
                    <PinDot key={i} filled={i < pin.length} isNew={i === lastDot} />
                  ))}
                </div>

                {/* Error message */}
                <div className="min-h-[1.5rem] mb-4 flex items-center justify-center">
                  {error && (
                    <p className="text-[#C0392B] text-sm font-medium text-center">{error}</p>
                  )}
                </div>

                {/*
                  ATM-style keypad:
                  - Indented background = physical recess
                  - White keys with bottom shadow = raised physical buttons
                  - Gold gradient on ENTER = premium confirm action
                */}
                <div
                  className="rounded-xl p-3"
                  style={{
                    backgroundColor: '#EAE6DF',
                    boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.07), inset 0 1px 2px rgba(0,0,0,0.05)',
                  }}
                >
                  <div className="grid grid-cols-3 gap-2.5">
                    {KEYPAD.map((row, ri) =>
                      row.map(k => (
                        <KeyBtn
                          key={`${ri}-${k}`}
                          k={k}
                          onClick={() => handleKey(k)}
                          disabled={
                            cargando ||
                            (k === 'enter' && (!nombre || pin.length < 4)) ||
                            (k === 'back'  && pin.length === 0)
                          }
                        />
                      ))
                    )}
                  </div>
                </div>

                {/* Spinner overlay on ENTER while loading */}
                {cargando && (
                  <div className="flex items-center justify-center gap-2 mt-4 text-[#14352A]">
                    <span className="w-4 h-4 border-2 border-[#14352A] border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm font-medium text-[#636B74]">Verificando...</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <p className="text-center text-[#9CA3AB] text-xs mt-5">
            Compresores del Valle S.A.S. · v2.0 · Uso interno
          </p>
        </div>
      </div>
    </div>
  )
}
