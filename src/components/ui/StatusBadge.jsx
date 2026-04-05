/**
 * Badge de estado de stock — alto contraste, visible sin leer texto.
 * Props:
 *   status: 'OK' | 'Bajo' | 'Agotado' | 'Sobrestock'
 *   size: 'sm' | 'md' (default 'md')
 */

const CONFIG = {
  OK: {
    label: 'OK',
    bg:     '#D1FAE5',   // verde muy claro
    text:   '#065F46',   // verde oscuro
    border: '#6EE7B7',
    dot:    '#0B8A57',
  },
  Bajo: {
    label: 'Bajo',
    bg:     '#FEF3C7',
    text:   '#92400E',
    border: '#FCD34D',
    dot:    '#C47F17',
  },
  Agotado: {
    label: 'Agotado',
    bg:     '#FEE2E2',
    text:   '#991B1B',
    border: '#FCA5A5',
    dot:    '#C0392B',
  },
  Sobrestock: {
    label: 'Sobre',
    bg:     '#DBEAFE',
    text:   '#1E40AF',
    border: '#93C5FD',
    dot:    '#2563EB',
  },
}

export default function StatusBadge({ status, size = 'md' }) {
  const cfg = CONFIG[status] ?? CONFIG.OK
  const isSmall = size === 'sm'

  return (
    <span
      style={{
        backgroundColor: cfg.bg,
        color:            cfg.text,
        border:           `1px solid ${cfg.border}`,
      }}
      className={`
        inline-flex items-center gap-1 rounded-full font-semibold leading-none
        ${isSmall ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'}
      `}
    >
      <span
        style={{ backgroundColor: cfg.dot }}
        className={`rounded-full flex-shrink-0 ${isSmall ? 'w-1.5 h-1.5' : 'w-2 h-2'}`}
      />
      {cfg.label}
    </span>
  )
}
