import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'

// Teclado tipo teléfono: filas de 3 dígitos
const KEYPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['⌫', '0', '→'],
]

export default function Login() {
  const navigate    = useNavigate()
  const { login, loading: authLoading, error, clearError, session, perfil } = useAuthStore()

  const [usuarios, setUsuarios]   = useState([])
  const [nombre,   setNombre]     = useState('')
  const [pin,      setPin]        = useState('')
  const [shake,    setShake]      = useState(false)
  const [cargando, setCargando]   = useState(false)

  // Redirigir si ya tiene sesión
  useEffect(() => {
    if (session && perfil) {
      navigate(perfil.rol === 'Admin' ? '/admin' : '/ops', { replace: true })
    }
  }, [session, perfil, navigate])

  // Cargar usuarios activos de Supabase
  useEffect(() => {
    supabase
      .from('usuarios')
      .select('nombre, rol')
      .eq('activo', true)
      .order('nombre')
      .then(({ data }) => {
        if (data) setUsuarios(data)
      })
  }, [])

  // Limpiar error al cambiar usuario o PIN
  useEffect(() => {
    if (error) clearError()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nombre])

  const handleKey = useCallback((key) => {
    if (key === '⌫') {
      setPin(p => p.slice(0, -1))
      return
    }
    if (key === '→') {
      handleLogin()
      return
    }
    if (pin.length < 4) {
      setPin(p => p + key)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, nombre])

  // Auto-login al completar 4 dígitos
  useEffect(() => {
    if (pin.length === 4 && nombre) {
      handleLogin()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

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

  const rolColor = {
    Admin:     'bg-[#1A1A2E] text-white',
    Bodeguero: 'bg-[#14352A] text-white',
    Vendedor:  'bg-[#2D7A5A] text-white',
    Tecnico:   'bg-[#C8993E] text-[#151515]',
  }

  const usuarioSeleccionado = usuarios.find(u => u.nombre === nombre)

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-4">

      {/* Encabezado */}
      <div className="mb-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-3 shadow-lg">
          <span className="text-3xl">⚙️</span>
        </div>
        <h1 className="text-2xl font-bold text-primary">Compresores del Valle</h1>
        <p className="text-text-sub text-sm mt-1">Sistema de Gestión Operativa</p>
      </div>

      {/* Card de login */}
      <div className="w-full max-w-sm bg-card rounded-2xl shadow-lg p-6 border border-border">

        {/* Selector de usuario */}
        <div className="mb-5">
          <label className="block text-sm font-semibold text-text-sub mb-2 uppercase tracking-wide">
            Usuario
          </label>
          <div className="relative">
            <select
              value={nombre}
              onChange={e => { setNombre(e.target.value); setPin('') }}
              className="w-full h-14 px-4 pr-10 rounded-xl border-2 border-border bg-surface-alt text-text text-base font-medium appearance-none focus:outline-none focus:border-primary cursor-pointer"
            >
              <option value="">— Selecciona tu nombre —</option>
              {usuarios.map(u => (
                <option key={u.nombre} value={u.nombre}>{u.nombre}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-text-sub">▼</div>
          </div>
          {usuarioSeleccionado && (
            <span className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-bold ${rolColor[usuarioSeleccionado.rol] ?? 'bg-border text-text'}`}>
              {usuarioSeleccionado.rol}
            </span>
          )}
        </div>

        {/* Indicador PIN (4 círculos) */}
        <div className="mb-5">
          <label className="block text-sm font-semibold text-text-sub mb-3 uppercase tracking-wide text-center">
            PIN de acceso
          </label>
          <div className={`flex justify-center gap-4 mb-1 ${shake ? 'animate-shake' : ''}`}>
            {[0, 1, 2, 3].map(i => (
              <div
                key={i}
                className={`w-5 h-5 rounded-full border-2 transition-all duration-150 ${
                  i < pin.length
                    ? 'bg-primary border-primary scale-110'
                    : 'bg-transparent border-border'
                }`}
              />
            ))}
          </div>
          {error && (
            <p className="text-center text-stock-out text-sm font-medium mt-2">{error}</p>
          )}
        </div>

        {/* Teclado numérico tipo teléfono */}
        <div className="grid grid-cols-3 gap-3">
          {KEYPAD_ROWS.map((row, ri) =>
            row.map((key) => {
              const isDelete  = key === '⌫'
              const isConfirm = key === '→'
              const disabled  = isConfirm ? (!nombre || pin.length < 4 || cargando) : false

              return (
                <button
                  key={`${ri}-${key}`}
                  onClick={() => handleKey(key)}
                  disabled={disabled}
                  className={`
                    h-14 rounded-xl text-xl font-semibold
                    transition-all duration-100 active:scale-95
                    select-none focus:outline-none
                    ${isConfirm
                      ? 'bg-accent text-white shadow-md disabled:opacity-40 disabled:cursor-not-allowed'
                      : isDelete
                      ? 'bg-surface-alt text-text-sub text-2xl'
                      : 'bg-surface border border-border text-text hover:bg-primary hover:text-white hover:border-primary'
                    }
                  `}
                >
                  {cargando && isConfirm ? (
                    <span className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : key}
                </button>
              )
            })
          )}
        </div>

        {/* Botón "Entrar" grande (alternativo al → del teclado) */}
        <button
          onClick={handleLogin}
          disabled={!nombre || pin.length < 4 || cargando}
          className="mt-4 w-full h-14 bg-accent text-white rounded-xl text-base font-bold shadow-md
                     disabled:opacity-40 disabled:cursor-not-allowed
                     active:scale-[0.98] transition-all duration-100"
        >
          {cargando ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Verificando...
            </span>
          ) : 'Entrar'}
        </button>
      </div>

      {/* Footer */}
      <p className="mt-6 text-text-muted text-xs text-center">
        v2.0 · Compresores del Valle S.A.S.
      </p>
    </div>
  )
}
