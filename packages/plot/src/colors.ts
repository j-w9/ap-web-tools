/** Plotly's default categorical colour cycle, as hex strings. */
export const DEFAULT_COLORS: readonly string[] = [
  '#1f77b4',
  '#ff7f0e',
  '#2ca02c',
  '#d62728',
  '#9467bd',
  '#8c564b',
  '#e377c2',
  '#7f7f7f',
  '#bcbd22',
  '#17becf'
]

/** Colour `i` of the default cycle, wrapping around. */
export function defaultColor(i: number): string {
  return DEFAULT_COLORS[((i % DEFAULT_COLORS.length) + DEFAULT_COLORS.length) % DEFAULT_COLORS.length] as string
}

/** Append an alpha channel (0..1) to a `#rrggbb` colour. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
  return hex + a.toString(16).padStart(2, '0')
}
