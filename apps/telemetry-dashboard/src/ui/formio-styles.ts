/**
 * Formio's stylesheet, added as the original page added it: after Font Awesome 6, so Formio's
 * Font Awesome 4.7 rules (`.fa`, used by its builder icons) take precedence. It is injected as
 * text because it contains old IE hacks (`*zoom`) the build's CSS minifier rejects; its relative
 * font URLs are pointed at the bundled font files.
 */
import formioCss from 'formiojs/dist/formio.full.min.css?raw'
import eot from 'formiojs/dist/fonts/fontawesome-webfont.eot?url'
import svg from 'formiojs/dist/fonts/fontawesome-webfont.svg?url'
import ttf from 'formiojs/dist/fonts/fontawesome-webfont.ttf?url'
import woff from 'formiojs/dist/fonts/fontawesome-webfont.woff?url'
import woff2 from 'formiojs/dist/fonts/fontawesome-webfont.woff2?url'

const FONTS: Readonly<Record<string, string>> = { eot, svg, ttf, woff, woff2 }

export function installFormioStyles(): void {
  const style = document.createElement('style')
  style.dataset.source = 'formiojs'
  style.textContent = formioCss.replace(/url\(fonts\/fontawesome-webfont\.(eot|svg|ttf|woff2?)/g, (match, ext: string) => {
    const url = FONTS[ext]
    return url === undefined ? match : `url(${url}`
  })
  document.head.append(style)
}
