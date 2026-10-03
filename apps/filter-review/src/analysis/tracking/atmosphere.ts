// Port of upstream tracking/Atmosphere_model.js, itself a replication of
// ardupilot libraries/AP_Baro/AP_Baro_atmosphere.cpp. Needed to convert motor PWM back to
// throttle for multi-source throttle notch tracking.

// Note parameters are as defined in the 1976 model. These are slightly different from the
// ones in definitions.h
const RADIUS_EARTH = 6356.766e3 // Earth's radius (in m)
const R_SPECIFIC = 287.053072 // air specific gas constant (J/kg/K) in 1976 model, R_universal / M_air
const GRAVITY_MSS = 9.80665 // acceleration due to gravity in m/s/s
const SSL_AIR_DENSITY = 1.225 // kg/m^3

interface AtmosphereLayer {
  /** Geopotential height above mean sea level (m'). */
  readonly amslM: number
  /** Temperature (K). */
  readonly tempK: number
  /** Pressure (Pa). */
  readonly pressurePa: number
  /** Density (kg/m^3). */
  readonly density: number
  /** Temperature gradient (K/m'). */
  readonly tempLapse: number
}

function layer(amslM: number, tempK: number, pressurePa: number, density: number, tempLapse: number): AtmosphereLayer {
  return { amslM, tempK, pressurePa, density, tempLapse }
}

const ATMOSPHERIC_1976: readonly AtmosphereLayer[] = [
  layer(-5000, 320.65, 177687, 1.930467, -6.5e-3),
  layer(11000, 216.65, 22632.1, 0.363918, 0),
  layer(20000, 216.65, 5474.89, 8.80349e-2, 1e-3),
  layer(32000, 228.65, 868.019, 1.3225e-2, 2.8e-3),
  layer(47000, 270.65, 110.906, 1.42753e-3, 0),
  layer(51000, 270.65, 66.9389, 8.61606e-4, -2.8e-3),
  layer(71000, 214.65, 3.95642, 6.4211e-5, -2.0e-3),
  layer(84852, 186.946, 0.37338, 6.95788e-6, 0)
]

/** Table entry for a geopotential altitude (m); returns at least 1 below the top layer. */
function findLayer(altM: number): number {
  for (let idx = 1; idx < ATMOSPHERIC_1976.length; idx++) {
    if (altM < ATMOSPHERIC_1976[idx]!.amslM) return idx - 1
  }
  // Over the largest altitude return the last index
  return ATMOSPHERIC_1976.length - 1
}

function geometricToGeopotential(alt: number): number {
  return (RADIUS_EARTH * alt) / (RADIUS_EARTH + alt)
}

function temperatureForLayer(alt: number, idx: number): number {
  const l = ATMOSPHERIC_1976[idx]!
  if (l.tempLapse === 0) return l.tempK
  return l.tempK + l.tempLapse * (alt - l.amslM)
}

/** Air density (kg/m^3) at a geometric altitude above mean sea level (m). */
export function airDensityForAltitude(altAmsl: number): number {
  const alt = geometricToGeopotential(altAmsl)
  const idx = findLayer(alt)
  const l = ATMOSPHERIC_1976[idx]!
  const tempSlope = l.tempLapse
  const temp = temperatureForLayer(alt, idx)
  if (tempSlope === 0.0) {
    // Iso-thermal layer
    const fac = Math.exp((-GRAVITY_MSS / (temp * R_SPECIFIC)) * (alt - l.amslM))
    return l.density * fac
  }
  // Gradient temperature layer
  const fac = GRAVITY_MSS / (tempSlope * R_SPECIFIC)
  const tempRatio = temp / l.tempK
  return l.density * Math.pow(tempRatio, -(fac + 1))
}

/** Scale factor from equivalent to true airspeed at an altitude (m), upstream `get_EAS2TAS`. */
export function eas2tas(altitude: number): number {
  let density = airDensityForAltitude(altitude)
  if (density <= 0) {
    // above this height we are getting closer to spacecraft territory...
    density = ATMOSPHERIC_1976[ATMOSPHERIC_1976.length - 1]!.density
  }
  return Math.sqrt(SSL_AIR_DENSITY / density)
}
