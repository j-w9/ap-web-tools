/**
 * Loading the palette's example widget files (upstream `init_pallet`'s fetch chain), kept apart from
 * the palette's DOM so it can be tested.
 */
import { prop } from '../layout/json.js'
import type { WidgetPlacement } from '../layout/loader.js'

export interface PaletteFile {
  readonly url: string
  readonly pos: WidgetPlacement
}

/**
 * Fetches every file and hands its widget, placed at `pos`, to `add`. The returned promise settles
 * once every file has loaded or failed.
 *
 * Proven bug #71 (docs/bug-proofs/telemetry-dashboard.md): upstream wrapped each fetch in a promise
 * whose `reject` was never called, so one failed file left `Promise.allSettled` pending and the
 * palette was never initialised. Here a failed file settles its entry and is simply missing.
 */
export function importPaletteFiles(
  files: readonly PaletteFile[],
  fetchJson: (url: string) => Promise<unknown>,
  add: (widget: unknown) => void
): Promise<PromiseSettledResult<void>[]> {
  return Promise.allSettled(
    files.map((file) =>
      fetchJson(file.url).then((obj) => {
        // `Object.assign(obj.widget, file.pos)`, which throws for a missing widget.
        const widget = prop(obj, 'widget')
        if (widget === null || widget === undefined) throw new TypeError('Cannot convert undefined or null to object')
        add(Object.assign(widget, file.pos))
      })
    )
  )
}
