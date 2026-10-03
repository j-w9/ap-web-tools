/**
 * Per-tab GCS component ids (upstream `SimpleGCS/app.js`, `claimComponentId`). Keep the system id
 * stable but give each tab its own component; Web Locks stop a duplicated tab inheriting an
 * active id. A busy id moves to the next free one.
 */

/** The `navigator.locks.request` overload used. */
export interface LockRequester {
  request(name: string, options: { ifAvailable: true }, callback: (lock: unknown) => unknown): Promise<unknown>
}

interface Lease {
  readonly id: number
  readonly release: () => void
}

export class ComponentLeases {
  private lease: Lease | null = null

  constructor(private readonly locks: LockRequester | undefined) {}

  /**
   * Reserves `preferred` or the next free id. Resolves null when `isCurrent()` turned false while
   * waiting (a newer Connect or a Disconnect), releasing anything acquired for it.
   */
  async claim(preferred: number, isCurrent: () => boolean): Promise<number | null> {
    const locks = this.locks
    if (this.lease?.id === preferred || locks === undefined) return preferred
    for (let offset = 0; offset < 255; offset++) {
      const id = 1 + ((preferred - 1 + offset) % 255)
      const lease = await new Promise<Lease | null>((resolve, reject) => {
        locks
          .request(`simplegcs.component.${id}`, { ifAvailable: true }, (lock) => {
            if (lock === null || lock === undefined) {
              resolve(null)
              return
            }
            return new Promise<void>((release) => resolve({ id, release: () => release() }))
          })
          .catch(reject)
      })
      if (!isCurrent()) {
        lease?.release()
        return null
      }
      if (lease !== null) {
        this.lease?.release()
        this.lease = lease
        return id
      }
    }
    throw new Error('All GCS component IDs are in use. Close an unused GCS tab.')
  }
}
