import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface PopoverButtonProps {
  /** Button content. */
  label: ReactNode
  /** Accessible name and tooltip for the button. */
  title: string
  className?: string
  style?: CSSProperties
  disabled?: boolean
  /** Popover width in pixels; menus size to their content. */
  width?: number
  role?: 'menu' | 'dialog'
  /** Popover content; call `close` after acting on a choice. */
  children: (close: () => void) => ReactNode
}

/** Placement in viewport coordinates, worked out from the button when it is clicked. */
type Placement = { readonly right: number } & ({ readonly top: number } | { readonly bottom: number })

function placeBelowOrAbove(rect: DOMRect): Placement {
  const right = Math.max(8, window.innerWidth - rect.right)
  return rect.bottom > window.innerHeight * 0.6
    ? { right, bottom: window.innerHeight - rect.top + 6 }
    : { right, top: rect.bottom + 6 }
}

/**
 * A button that opens a popover in a portal, so it is not clipped by the scrolling table wrapper
 * (the shared `OpenInButton` popover is positioned inside its parent). Closes on outside click,
 * Escape, scroll and resize.
 */
export function PopoverButton({
  label,
  title,
  className,
  style: buttonStyle,
  disabled,
  width,
  role = 'dialog',
  children
}: PopoverButtonProps) {
  const [placement, setPlacement] = useState<Placement | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const open = placement !== null

  useEffect(() => {
    if (!open) return
    const close = () => setPlacement(null)
    const outside = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return
      if (panel.current?.contains(e.target) || button.current?.contains(e.target)) return
      close()
    }
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const scroll = (e: Event) => {
      if (e.target instanceof Node && panel.current?.contains(e.target)) return
      close()
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const style: CSSProperties | undefined = placement
    ? {
        top: 'auto',
        ...placement,
        position: 'fixed',
        width,
        maxHeight: '60vh',
        overflow: 'auto',
        textAlign: 'left',
        whiteSpace: 'normal'
      }
    : undefined

  return (
    <>
      <button
        ref={button}
        type="button"
        className={className ?? 'apwt-btn'}
        style={buttonStyle}
        title={title}
        aria-label={title}
        aria-haspopup={role}
        aria-expanded={open}
        disabled={disabled}
        onClick={(e) => setPlacement(open ? null : placeBelowOrAbove(e.currentTarget.getBoundingClientRect()))}
      >
        {label}
      </button>
      {style &&
        createPortal(
          <div ref={panel} className="apwt-popover" role={role} style={style}>
            {children(() => setPlacement(null))}
          </div>,
          document.body
        )}
    </>
  )
}
