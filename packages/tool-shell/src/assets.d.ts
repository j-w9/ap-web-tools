declare module '*.png' {
  const url: string
  export default url
}

declare module '*.gif' {
  const url: string
  export default url
}

interface ImportMeta {
  glob<T>(pattern: string, options: { eager: true; import: 'default'; query?: string }): Record<string, T>
}
