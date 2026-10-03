/**
 * Browser geolocation for the map (upstream `SimpleGCS/userloc.js`): watch the position, retry
 * temporary errors every 15 s, stop on permission denial or after 50 consecutive errors.
 */
import { NO_TIMER, type Clock, type Timer } from '../clock.js'

export interface UserFix {
  readonly lat: number
  readonly lng: number
  readonly accuracy: number
}

/** The `navigator.geolocation` operations used. */
export interface GeolocationPort {
  watchPosition(
    success: (pos: GeolocationPosition) => void,
    error: (err: GeolocationPositionError) => void,
    options: PositionOptions
  ): number
  clearWatch(id: number): void
}

export interface UserLocationEvents {
  readonly toast: (message: string) => void
  /** A new fix (null: markers removed). `first` is true for the first fix after starting. */
  readonly fix: (fix: UserFix | null, first: boolean) => void
}

export class UserLocation {
  private watchId: number | null = null
  private retryTimer: Timer = NO_TIMER
  private retrying = false
  private firstFix = true
  private errorCount = 0
  readonly retryInterval = 15000
  readonly maxConsecutiveErrors = 50

  constructor(
    private readonly geolocation: GeolocationPort | undefined,
    private readonly clock: Clock,
    private readonly events: UserLocationEvents
  ) {}

  active(): boolean {
    return this.watchId !== null || this.retrying
  }

  private onPos(pos: GeolocationPosition): void {
    this.errorCount = 0
    const { latitude, longitude, accuracy } = pos.coords
    const first = this.firstFix
    this.firstFix = false
    this.events.fix({ lat: latitude, lng: longitude, accuracy }, first)
  }

  private onErr(err: GeolocationPositionError): void {
    this.errorCount++
    if (err.code === 1) {
      this.events.toast('Location permission denied')
      this.stop()
      return
    }
    if (this.errorCount >= this.maxConsecutiveErrors) {
      this.events.toast('Location unavailable after multiple attempts')
      this.stop()
      return
    }
    this.events.toast('Location error, will retry…')
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    this.retryTimer.cancel()
    if (this.watchId !== null) {
      this.geolocation?.clearWatch(this.watchId)
      this.watchId = null
    }
    this.retrying = true
    this.retryTimer = this.clock.after(this.retryInterval, () => {
      this.retryTimer = NO_TIMER
      this.retrying = false
      this.startWatch()
    })
  }

  private startWatch(): void {
    const geo = this.geolocation
    if (geo === undefined) return
    if (this.watchId !== null) geo.clearWatch(this.watchId)
    this.watchId = geo.watchPosition(
      (pos) => this.onPos(pos),
      (err) => this.onErr(err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    )
  }

  start(): void {
    if (this.geolocation === undefined) {
      this.events.toast('Geolocation not available')
      return
    }
    if (this.active()) {
      this.events.toast('Location on')
      return
    }
    this.firstFix = true
    this.errorCount = 0
    this.startWatch()
    this.events.toast('Locating…')
  }

  stop(): void {
    this.retryTimer.cancel()
    this.retryTimer = NO_TIMER
    this.retrying = false
    if (this.watchId !== null) {
      this.geolocation?.clearWatch(this.watchId)
      this.watchId = null
    }
    this.events.fix(null, false)
    this.firstFix = true
    this.errorCount = 0
    this.events.toast('Location off')
  }
}
