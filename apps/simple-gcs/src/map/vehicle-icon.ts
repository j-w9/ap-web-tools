/** Top-view vehicle icons for the map marker (upstream `SimpleGCS/map.js`, `makeSvgIcon`). */
import type { VehicleClass } from '../vehicle/vehicle.js'

const PATHS: Readonly<Record<VehicleClass, string>> = {
  plane: `<g stroke-width="1" stroke="#333" fill="#e53935">
    <path d="M12,20 L11,17 L11,10 L10,7 L10,4 L12,2 L14,4 L14,7 L13,10 L13,17 L12,20 Z"/>
    <path d="M3,11 L11,12 L11,14 L3,13 Z"/>
    <path d="M21,11 L13,12 L13,14 L21,13 Z"/>
    <path d="M7,18 L11,17 L11,18 L7,19 Z"/>
    <path d="M17,18 L13,17 L13,18 L17,19 Z"/>
  </g>`,
  copter: `<g stroke-width="1" stroke="#333" fill="#ff9800">
    <circle cx="12" cy="12" r="3"/>
    <rect x="11" y="4" width="2" height="16" />
    <rect x="4" y="11" width="16" height="2" />
    <circle cx="12" cy="5" r="2.5" fill="#666"/>
    <circle cx="12" cy="19" r="2.5" fill="#666"/>
    <circle cx="5" cy="12" r="2.5" fill="#666"/>
    <circle cx="19" cy="12" r="2.5" fill="#666"/>
  </g>`,
  rover: `<g stroke-width="1" stroke="#333" fill="#4caf50">
    <rect x="7" y="6" width="10" height="12" rx="2"/>
    <rect x="5" y="7" width="3" height="4" fill="#333" rx="0.5"/>
    <rect x="16" y="7" width="3" height="4" fill="#333" rx="0.5"/>
    <rect x="5" y="13" width="3" height="4" fill="#333" rx="0.5"/>
    <rect x="16" y="13" width="3" height="4" fill="#333" rx="0.5"/>
    <path d="M12,6 L10,9 L12,8 L14,9 Z" fill="#fff"/>
  </g>`,
  boat: `<g stroke-width="1" stroke="#333" fill="#2196f3">
    <path d="M12,4 L8,10 L8,18 Q12,20 12,20 Q12,20 16,18 L16,10 L12,4 Z"/>
    <rect x="10" y="11" width="4" height="5" fill="#1976d2" rx="0.5"/>
    <path d="M12,4 L11,7 L12,6 L13,7 Z" fill="#fff"/>
  </g>`
}

/** SVG markup of the icon rotated by `rotateDeg`. */
export function vehicleSvg(kind: VehicleClass, rotateDeg: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" style="transform: rotate(${rotateDeg}deg); transform-origin: center;">${PATHS[kind]}</svg>`
}
