import { AlertTriangle } from 'lucide-react'

/** Inline error message, as on CustomBuild. Renders nothing when `message` is null. */
export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="apwt-error" role="alert">
      <AlertTriangle />
      {message}
    </p>
  )
}
