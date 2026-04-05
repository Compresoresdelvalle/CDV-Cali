import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import StatusBadge from '../../components/ui/StatusBadge'
import QRGenerator from '../../components/qr/QRGenerator'
import QRPrintLabel from '../../components/qr/QRPrintLabel'
import { formatCOP, formatDate } from '../../lib/utils'

export default function ProductoDetalle() {
  const { productoId } = useParams()
  const navigate       = useNavigate()
  const authLoading    = useAuthStore(s => s.loading)

  const [producto,    setProducto]    = useState(null)
  const [inventario,  setInventario]  = useState([])
  const [movimientos, setMovimientos] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)

  useEffect(() => {
    // Esperar a que auth termine de inicializar antes de hacer queries con RLS
    if (!productoId || authLoading) return
    let cancelled = false

    const fetchData = async () => {
      setLoading(true)
      setError(null)

      try {
        // 1. Datos del producto
        const { data: prod, error: prodErr } = await supabase
          .from('productos')
          .select('id, referencia, nombre, categoria, subcategoria, marca, modelo, descripcion, precio_venta, costo_promedio, stock_minimo, stock_maximo, unidad_medida, activo')
          .eq('id', productoId)
          .single()

        if (prodErr || !prod) throw new Error('Producto no encontrado')

        // 2. Inventario por sede
        const { data: inv } = await supabase
          .from('inventario')
          .select('id, cantidad, estado_stock, ubicacion_id, sede:sedes(id, nombre)')
          .eq('producto_id', productoId)
          .order('sede_id')

        // 3. Últimos 10 movimientos
        const { data: movs } = await supabase
          .from('movimientos')
          .select('id, fecha, tipo, cantidad, stock_anterior, stock_posterior, observaciones, sede_id')
          .eq('producto_id', productoId)
          .order('fecha', { ascending: false })
          .limit(10)

        if (!cancelled) {
          setProducto(prod)
          setInventario(inv ?? [])
          setMovimientos(movs ?? [])
          setLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message)
          setLoading(false)
        }
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [productoId, authLoading])

  if (loading) return <LoadingSkeleton />
  if (error)   return <ErrorState message={error} onBack={() => navigate(-1)} />
  if (!producto) return null

  const stockTotal = inventario.reduce((sum, i) => sum + i.cantidad, 0)

  return (
    <div className="max-w-2xl mx-auto pb-12">

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white border-b border-border px-4 py-3
                      flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-xl text-text-sub hover:text-text hover:bg-surface
                     transition-colors cursor-pointer -ml-1"
          aria-label="Volver"
        >
          <BackIcon />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-text text-sm leading-tight truncate">{producto.nombre}</p>
          <p className="text-text-muted text-xs font-mono">{producto.referencia}</p>
        </div>
        {!producto.activo && (
          <span className="text-[10px] font-semibold bg-red-100 text-red-700 px-2 py-1 rounded-full">
            Inactivo
          </span>
        )}
      </div>

      <div className="px-4 pt-5 space-y-5">

        {/* ── Tarjeta principal ────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-surface/40">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-base font-bold text-text leading-tight">{producto.nombre}</h1>
                <p className="text-text-muted text-xs font-mono mt-0.5">{producto.referencia}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {producto.categoria && <Tag>{producto.categoria}</Tag>}
                  {producto.marca && <Tag variant="accent">{producto.marca}</Tag>}
                  {producto.modelo && <Tag>{producto.modelo}</Tag>}
                </div>
              </div>
              {/* Stock total */}
              <div className="text-right flex-shrink-0">
                <p className="text-3xl font-black text-text tabular-nums">{stockTotal}</p>
                <p className="text-[10px] text-text-muted uppercase tracking-wide">total</p>
              </div>
            </div>

            {producto.descripcion && (
              <p className="text-xs text-text-sub mt-3 leading-relaxed">{producto.descripcion}</p>
            )}
          </div>

          {/* Precios */}
          <div className="grid grid-cols-2 divide-x divide-border">
            <div className="px-5 py-3.5">
              <p className="text-[10px] uppercase tracking-wide text-text-muted font-medium">Precio venta</p>
              <p className="text-base font-bold text-text mt-0.5">{formatCOP(producto.precio_venta)}</p>
            </div>
            <div className="px-5 py-3.5">
              <p className="text-[10px] uppercase tracking-wide text-text-muted font-medium">Costo promedio</p>
              <p className="text-base font-bold text-text mt-0.5">{formatCOP(producto.costo_promedio)}</p>
            </div>
          </div>

          {/* Mínimo / Máximo */}
          <div className="grid grid-cols-2 divide-x divide-border border-t border-border">
            <div className="px-5 py-3.5">
              <p className="text-[10px] uppercase tracking-wide text-text-muted font-medium">Stock mínimo</p>
              <p className="text-sm font-semibold text-text mt-0.5">{producto.stock_minimo}</p>
            </div>
            <div className="px-5 py-3.5">
              <p className="text-[10px] uppercase tracking-wide text-text-muted font-medium">Stock máximo</p>
              <p className="text-sm font-semibold text-text mt-0.5">{producto.stock_maximo}</p>
            </div>
          </div>
        </div>

        {/* ── Stock por sede ───────────────────────────────────────────── */}
        <Section title="Stock por sede" icon="🏪">
          {inventario.length === 0 ? (
            <p className="text-text-muted text-sm px-4 py-3">Sin registros de inventario</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-border">
                  <th className="px-4 py-2.5 text-xs font-semibold text-text-sub">Sede</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-text-sub text-right">Cant.</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-text-sub">Estado</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-text-sub hidden sm:table-cell">Ubicación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {inventario.map(inv => (
                  <tr key={inv.id} className="hover:bg-surface/50 transition-colors">
                    <td className="px-4 py-3 text-sm text-text">{inv.sede?.nombre}</td>
                    <td className="px-4 py-3 text-right font-bold text-text tabular-nums">{inv.cantidad}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={inv.estado_stock} size="sm" />
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted hidden sm:table-cell">
                      {inv.ubicacion_id ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* ── QR ───────────────────────────────────────────────────────── */}
        <Section title="Código QR" icon="📱">
          <div className="flex flex-col sm:flex-row items-center gap-6 px-4 py-4">
            <div className="bg-white p-4 rounded-xl border border-border shadow-sm">
              <QRGenerator value={producto.referencia} size={160} />
            </div>
            <div className="flex flex-col gap-3 items-center sm:items-start">
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wide font-medium">Referencia</p>
                <p className="text-lg font-bold font-mono text-text mt-0.5">{producto.referencia}</p>
              </div>
              <p className="text-xs text-text-sub text-center sm:text-left">
                Escanea con la app para ver el detalle del producto.
              </p>
              <QRPrintLabel referencia={producto.referencia} nombre={producto.nombre} />
            </div>
          </div>
        </Section>

        {/* ── Últimos movimientos ──────────────────────────────────────── */}
        <Section title="Últimos 10 movimientos" icon="📋">
          {movimientos.length === 0 ? (
            <p className="text-text-muted text-sm px-4 py-3">Sin movimientos registrados</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {movimientos.map(mov => (
                <li key={mov.id} className="px-4 py-3 flex items-start gap-3">
                  <MovimientoIcon tipo={mov.tipo} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-text capitalize">
                        {mov.tipo.toLowerCase().replace('_', ' ')}
                      </span>
                      <span className={`text-sm font-bold tabular-nums ${mov.cantidad >= 0 ? 'text-stock-ok' : 'text-stock-out'}`}>
                        {mov.cantidad >= 0 ? '+' : ''}{mov.cantidad}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-text-muted">
                        {mov.sede_id}
                      </span>
                      <span className="text-border text-xs">·</span>
                      <span className="text-[11px] text-text-muted tabular-nums">
                        {mov.stock_anterior} → {mov.stock_posterior}
                      </span>
                    </div>
                    {mov.observaciones && (
                      <p className="text-[11px] text-text-sub mt-1 italic truncate">{mov.observaciones}</p>
                    )}
                    <p className="text-[10px] text-text-muted mt-0.5">{formatDate(mov.fecha)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

      </div>
    </div>
  )
}

/* ─── Helpers ───────────────────────────────────────────────────────── */

function Section({ title, icon, children }) {
  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <span className="text-base">{icon}</span>
        <h2 className="text-sm font-bold text-text">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function Tag({ children, variant = 'default' }) {
  const styles = {
    default: 'bg-surface text-text-sub border border-border',
    accent:  'bg-accent/10 text-accent-dark border border-accent/30',
  }
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${styles[variant]}`}>
      {children}
    </span>
  )
}

function MovimientoIcon({ tipo }) {
  const colores = {
    COMPRA:      { bg: '#D1FAE5', color: '#065F46', symbol: '↓' },
    VENTA:       { bg: '#FEE2E2', color: '#991B1B', symbol: '↑' },
    TRASPASO:    { bg: '#DBEAFE', color: '#1E40AF', symbol: '⇄' },
    AJUSTE:      { bg: '#FEF3C7', color: '#92400E', symbol: '≈' },
    DEVOLUCION:  { bg: '#F3E8FF', color: '#6B21A8', symbol: '↩' },
    ENSAMBLE:    { bg: '#DBEAFE', color: '#1E40AF', symbol: '⚙' },
    default:     { bg: '#F4F1EB', color: '#636B74', symbol: '•' },
  }
  const cfg = colores[tipo] ?? colores.default
  return (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}
    >
      {cfg.symbol}
    </div>
  )
}

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M12.5 5 7.5 10l5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function LoadingSkeleton() {
  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 space-y-4 animate-pulse">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 bg-surface rounded-xl" />
        <div className="flex-1 space-y-1">
          <div className="h-4 bg-surface rounded w-2/3" />
          <div className="h-3 bg-surface rounded w-1/3" />
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-border h-40" />
      <div className="bg-white rounded-2xl border border-border h-32" />
      <div className="bg-white rounded-2xl border border-border h-56" />
    </div>
  )
}

function ErrorState({ message, onBack }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-8 text-center">
      <div className="text-5xl mb-4">⚠️</div>
      <p className="font-bold text-text">No se pudo cargar el producto</p>
      <p className="text-text-muted text-sm mt-1">{message}</p>
      <button
        onClick={onBack}
        className="mt-6 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold
                   hover:bg-primary-light transition-colors cursor-pointer"
      >
        Volver
      </button>
    </div>
  )
}
