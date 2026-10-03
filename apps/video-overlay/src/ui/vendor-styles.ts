/**
 * Formio's stylesheet (upstream loads `formio.full.min.css` from cdn.form.io) holds old IE hacks
 * (`*zoom`) the build's CSS minifier rejects, so it is imported as text and added at start-up, in the
 * same `vendor` cascade layer as the other library styles. Its Font Awesome font references are
 * pointed at the bundled font files.
 */
import formioCss from 'formiojs/dist/formio.full.min.css?raw'
import eot from 'formiojs/dist/fonts/fontawesome-webfont.eot?url'
import svg from 'formiojs/dist/fonts/fontawesome-webfont.svg?url'
import ttf from 'formiojs/dist/fonts/fontawesome-webfont.ttf?url'
import woff from 'formiojs/dist/fonts/fontawesome-webfont.woff?url'
import woff2 from 'formiojs/dist/fonts/fontawesome-webfont.woff2?url'

const FONT_URLS: Readonly<Record<string, string>> = { eot, svg, ttf, woff, woff2 }

export function linkFormioStyles(): void {
  const css = formioCss
    .replace(/^@charset "UTF-8";/, '')
    .replace(
      /url\(fonts\/fontawesome-webfont\.(\w+)([^)]*)\)/g,
      (_match, ext: string, rest: string) => `url("${FONT_URLS[ext] ?? ''}${rest.replace(/^\?[^#]*/, '')}")`
    )
  const style = document.createElement('style')
  style.textContent = `@layer vendor {\n${css}\n}`
  document.head.prepend(style)
}
