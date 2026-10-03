import type { ReactNode } from 'react'
import { AlertTriangle, CircleCheck, Info } from 'lucide-react'

export type NoticeVariant = 'info' | 'warning' | 'success'

export interface NoticeProps {
  variant?: NoticeVariant
  /** Optional bold first line. */
  title?: ReactNode
  /** Live-region role. Defaults to `alert` for warnings and `status` otherwise, as on CustomBuild. */
  role?: 'alert' | 'status' | 'note'
  className?: string
  children?: ReactNode
}

const ICONS = { info: Info, warning: AlertTriangle, success: CircleCheck } as const

/**
 * A tinted message box for information, warnings and success, styled like CustomBuild's
 * banners (blue, yellow, green). Errors use `ErrorBanner`.
 */
export function Notice({ variant = 'info', title, role, className, children }: NoticeProps) {
  const Icon = ICONS[variant]
  return (
    <div
      className={`apwt-notice apwt-notice--${variant}${className ? ` ${className}` : ''}`}
      role={role ?? (variant === 'warning' ? 'alert' : 'status')}
    >
      <Icon aria-hidden="true" />
      <div className="apwt-notice__body">
        {title != null && <strong className="apwt-notice__title">{title}</strong>}
        {children}
      </div>
    </div>
  )
}
