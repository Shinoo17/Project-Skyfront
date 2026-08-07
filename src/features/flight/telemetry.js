/*
The contract between the flight loop and the HUD.

One plain object, created once per sortie and mutated in place by `useFrame`. It is never
React state: the scene writes it every frame and the HUD reads it from its own animation
frame, so a 60 FPS range costs zero renders. `live` stays false until the terrain and the
aircraft have both loaded, which is what the HUD shows dashes for.

Airspeed is published in km/h and Mach from the aircraft's supplied performance table.
Altitude, clearance, range distance, and vertical speed remain in world units because the
terrain has no declared real-world scale; the HUD does not invent feet or metres for them.

`camera`, `position` and `forward` are live Three objects, not copies: the HUD projects its
own symbology through the same camera the scene renders with, which is the only way the
pitch ladder can stay registered with the terrain behind it. They stay null until the
aircraft is flying, which is the same condition `live` reports.
*/
export const EMPTY_TELEMETRY = {
  altitude: 0,
  // Airflow state from the flight model: angle of attack and sideslip in degrees, wing
  // load factor in G, and body rates in degrees per second. `maneuver` is the detector's
  // name for the current regime — it labels the physics, it never drives them.
  aoa: 0,
  sideslip: 0,
  gLoad: 1,
  pitchRate: 0,
  rollRate: 0,
  yawRate: 0,
  highAoA: false,
  airBrake: false,
  thrustVector: 0,
  maneuver: 'normal',
  // Live Vector3, the true velocity — the flight path marker projects along this, which
  // is what lets it drift away from the boresight at high AoA. Null until flying.
  velocity: null,
  // Live Vector3 accelerations for the debug arrows; null until flying.
  liftForce: null,
  dragForce: null,
  thrustForce: null,
  // The burner publishes what it has worth reading: whether it is alight, how much of it
  // is alight, how much reserve is left to feed it, that reserve as the seconds of burn it
  // is actually worth, the seconds a burnt-out burner still owes before it will relight,
  // and one word naming the state — 'off', 'spooling', 'engaged', or 'depleted'.
  afterburner: false,
  afterburnerLevel: 0,
  afterburnerReserve: 1,
  afterburnerSeconds: 0,
  afterburnerCooldown: 0,
  afterburnerState: 'off',
  engineCoreLevel: 0,
  camera: null,
  ceiling: 0,
  edge: 0,
  fps: 0,
  forward: null,
  flaps: 0,
  groundClearance: 0,
  heading: 0,
  live: false,
  mach: 0,
  pitch: 0,
  position: null,
  positionX: 0,
  positionZ: 0,
  resetCause: '',
  roll: 0,
  sinceReset: 999,
  speed: 0,
  throttle: 0,
  verticalSpeed: 0,
}

export function createTelemetry() {
  return { ...EMPTY_TELEMETRY }
}
