/**
 * Long-press gesture for guided repositioning (upstream `SimpleGCS/map.js`,
 * `_setupLongPressReposition`): hold one pointer still on the map for 600 ms. A second pointer
 * cancels the whole gesture until every pointer is lifted; moving more than 10 px, leaving the map,
 * cancelling or window blur also cancel. Framework-free: the map component forwards DOM events.
 */
import type { Clock, Timer } from '../clock.js'

export interface Point {
  readonly x: number
  readonly y: number
}

export interface GesturePointer {
  readonly pointerId: number
  readonly button: number
  readonly pointerType: string
  /** Container point of the event (Leaflet `mouseEventToContainerPoint`). */
  readonly point: Point
  /** True when the target is a control, popup, the video panel or a form element. */
  readonly excluded: boolean
  preventDefault(): void
}

export const HOLD_MS = 600
export const MOVE_PX_TOL = 10

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

export class LongPressDetector {
  private pressTimer: Timer | null = null
  private start: Point | null = null
  private last: Point | null = null
  private activeId: number | null = null
  private readonly pointers = new Set<number>()

  constructor(
    private readonly clock: Clock,
    /** Called with the container point held. */
    private readonly onHold: (point: Point) => void,
    private readonly distanceTo: (a: Point, b: Point) => number = distance
  ) {}

  private clearAll(): void {
    this.pressTimer?.cancel()
    this.pressTimer = null
    this.activeId = null
    this.start = this.last = null
  }

  /** Window `pointerdown`, capture phase: counts every pointer, including ones over controls. */
  windowPointerDown(ev: Pick<GesturePointer, 'pointerId'>): void {
    this.pointers.add(ev.pointerId)
    if (this.pointers.size > 1) this.clearAll()
  }

  /** Map container `pointerdown`. */
  pointerDown(ev: GesturePointer): void {
    if (this.pointers.size > 1) return
    if (ev.button !== 0 || ev.excluded) return
    if (ev.pointerType === 'touch') ev.preventDefault()
    this.activeId = ev.pointerId
    this.start = this.last = ev.point
    this.pressTimer = this.clock.after(HOLD_MS, () => {
      const point = this.last
      if (point === null) return
      this.onHold(point)
      this.clearAll()
    })
  }

  pointerMove(ev: Pick<GesturePointer, 'pointerId' | 'pointerType' | 'point' | 'preventDefault'>): void {
    if (ev.pointerId !== this.activeId) return
    if (ev.pointerType === 'touch') ev.preventDefault()
    this.last = ev.point
    if (this.start !== null && this.distanceTo(this.start, this.last) > MOVE_PX_TOL) this.clearAll()
  }

  /** Leaving the map itself (not child layers redrawn under the pointer) cancels. */
  pointerLeave(ev: Pick<GesturePointer, 'pointerId'>): void {
    if (ev.pointerId === this.activeId) this.clearAll()
  }

  /** Window `pointerup`/`pointercancel`, capture phase: releases can happen outside the map. */
  windowPointerEnd(ev: Pick<GesturePointer, 'pointerId'>): void {
    this.pointers.delete(ev.pointerId)
    if (ev.pointerId === this.activeId) this.clearAll()
  }

  blur(): void {
    this.pointers.clear()
    this.clearAll()
  }

  dispose(): void {
    this.blur()
  }
}
