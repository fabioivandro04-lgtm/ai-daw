import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  shortcut?: string
  onClick?: () => void
  disabled?: boolean
  separator?: boolean
}

/** A dropdown menu: click the trigger, pick an item, Escape or click outside to close. */
export function Menu({ trigger, items, className = '' }: { trigger: ReactNode; items: MenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])
  return (
    <div className={`menu-root ${className}`} ref={ref}>
      <button className={`menu-trigger ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        {trigger}
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {items.map((it, i) =>
            it.separator ? (
              <div key={i} className="menu-sep" role="separator" />
            ) : (
              <button
                key={i}
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false)
                  it.onClick?.()
                }}
              >
                <span>{it.label}</span>
                {it.shortcut && <kbd>{it.shortcut}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
