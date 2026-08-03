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
  // The burner publishes what it has worth reading: whether it is alight, how much of it
  // is alight, how much reserve is left to feed it, that reserve as the seconds of burn it
  // is actually worth, the seconds a burnt-out burner still owes before it will relight,
  // and one word naming the state — 'off', 'engaged', or 'depleted'.
  afterburner: false,
  afterburnerLevel: 0,
  afterburnerReserve: 1,
  afterburnerSeconds: 0,
  afterburnerCooldown: 0,
  afterburnerState: 'off',
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
