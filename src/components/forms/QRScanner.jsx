import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../../lib/supabase'

const SCANNER_ID = 'qr-scanner-viewport'

/**
 * Modal que abre la cámara trasera y escanea un código QR.
 * Al escanear una referencia de producto, llama a onFound(productoId).
 *
 * Props:
 *   onFound:  (productoId: string) => void
 *   onClose:  () => void
 */
export default function QRScanner({ onFound, onClose }) {
  const scannerRef = useRef(null)
  const [status, setStatus]   = useState('starting') // 'starting' | 'scanning' | 'found' | 'error'
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    let scanner = null
    let stopped = false

    const startScanner = async () => {
      try {
        scanner = new Html5Qrcode(SCANNER_ID)
        scannerRef.current = scanner

        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          async (decodedText) => {
            if (stopped) return
            stopped = true
            setStatus('found')

            // Detener la cámara antes de la consulta
            try { await scanner.stop() } catch { /* ignore */ }

            // Buscar el producto por referencia
            const { data } = await supabase
              .from('productos')
              .select('id')
              .eq('referencia', decodedText.trim())
              .eq('activo', true)
              .maybeSingle()

            if (data?.id) {
              onFound(data.id)
            } else {
              setStatus('error')
              setErrorMsg(`Referencia no encontrada: ${decodedText}`)
            }
          },
          () => { /* errores de frame — ignorar */ }
        )
        if (!stopped) setStatus('scanning')
      } catch (err) {
        setStatus('error')
        setErrorMsg(err?.message ?? 'No se pudo acceder a la cámara')
      }
    }

    startScanner()

    return () => {
      stopped = true
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(() => {})
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Panel */}
      <div className="w-full sm:w-auto sm:min-w-[360px] bg-white rounded-t-2xl sm:rounded-2xl
                      shadow-2xl overflow-hidden animate-fade-up">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                 style={{ backgroundColor: '#EBF5F0' }}>
              <QRIcon />
            </div>
            <div>
              <p className="font-semibold text-text text-sm">Escáner QR</p>
              <p className="text-text-muted text-xs">
                {status === 'scanning' ? 'Apunta al código QR del producto' :
                 status === 'found'    ? 'Código encontrado ✓' :
                 status === 'error'    ? 'Error al escanear' : 'Iniciando cámara...'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-xl
                       text-text-sub hover:text-text hover:bg-surface
                       transition-colors cursor-pointer"
            aria-label="Cerrar escáner"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Viewport */}
        <div className="relative bg-black" style={{ height: 300 }}>
          {/* El div donde Html5Qrcode inyecta el video */}
          <div id={SCANNER_ID} className="w-full h-full" />

          {/* Overlay de estado */}
          {status === 'starting' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="flex flex-col items-center gap-3 text-white">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white
                                rounded-full animate-spin" />
                <p className="text-sm">Iniciando cámara…</p>
              </div>
            </div>
          )}

          {status === 'found' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="flex flex-col items-center gap-2 text-white">
                <div className="w-12 h-12 rounded-full flex items-center justify-center"
                     style={{ backgroundColor: '#0B8A57' }}>
                  <CheckIcon />
                </div>
                <p className="text-sm font-medium">Buscando producto…</p>
              </div>
            </div>
          )}
        </div>

        {/* Error / retry */}
        {status === 'error' && (
          <div className="px-5 py-4 bg-red-50 border-t border-red-100">
            <p className="text-sm text-red-700 font-medium">⚠ {errorMsg}</p>
            <p className="text-xs text-red-500 mt-1">
              Verifica que el QR corresponda a un producto del sistema.
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl text-sm font-semibold
                       bg-surface text-text-sub hover:bg-border
                       transition-colors cursor-pointer min-h-[48px]"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

function QRIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#14352A" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h.01M18 14h.01M14 18h.01M18 18h.01M14 14v4h4v-4" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4.5 4.5 13.5 13.5M13.5 4.5 4.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 13l4 4L19 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
