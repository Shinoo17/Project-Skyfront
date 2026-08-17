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
  // The stall progression as two continuous numbers rather than a mode: `stallBlend` is the
  // approach to the stall, `postStallBlend` how far past it the wing already is.
  stallBlend: 0,
  postStallBlend: 0,
  postStallActive: false,
  // How much of the max-performance turn is engaged, 0..1. A different control and a
  // different regime from `psmBlend` below: this one stays inside the conventional
  // envelope and pays for itself in drag.
  highGBlend: 0,
  flightRegime: 'normal',
  departureBlend: 0,
  // Explicit arcade PSM state. `high-aoa` is the Maneuver Assist consent phase;
  // hold/flip/reversal keep the attitude player-owned, and only `recovery` adds a smooth
  // nose-to-path hand-back.
  psmPhase: 'normal',
  psmBlend: 0,
  psmFloatBlend: 0,
  gravityScale: 1,
  // Control authority split by where it comes from, 0..1. The surfaces answer to dynamic
  // pressure and to separation; the nozzles answer to engine thrust. Losing one is a very
  // different aircraft from losing both.
  aeroAuthority: 0,
  vectorAuthority: 0,
  // Lift and drag as scalar accelerations, for the readout. The full vectors are below.
  lift: 0,
  drag: 0,
  // Climb or dive angle of the velocity itself, and the total angle between the nose and the
  // flight path. Degrees.
  flightPath: 0,
  noseOffPath: 0,
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
  camera: null,
  /*
  What the camera rig did with all of that, for the debug overlay and for nothing else.

  `cameraState` is the name of the behaviour in force — see the label derivation at the end
  of the rig, which reports what the camera did rather than instructing it. The three vectors
  are live objects owned by the rig: the follow axis it composed on, the airframe's up before
  the roll setting took its share, and where the boom wanted to be before the terrain
  shortened it. `cameraRollDeg` and `cameraScreenRollDeg` are the airframe's bank and how much
  of it survived to the screen, which is the pair the pointer stick is corrected by.
  */
  cameraState: 'normal-chase',
  cameraForward: null,
  cameraBodyUp: null,
  cameraDesired: null,
  cameraRollDeg: 0,
  cameraScreenRollDeg: 0,
  cameraCollision: false,
  // Where the pointer sits inside the gate, in gate radii per axis and unclamped, or null
  // when the mouse is not flying the aircraft. The HUD draws the gate from it: the pointer
  // itself says where the stick is, and the gate says how much of that the aircraft is given.
  mouseStick: null,
  ceiling: 0,
  edge: 0,
  fps: 0,
  forward: null,
  maneuverSurface: 0,
  leadingEdgeDeflection: 0,
  trailingEdgeDeflection: 0,
  flaperonDeflection: 0,
  maneuverSurfaceEffectiveness: 1,
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
  acceleration: 0,
  forwardSpeed: 0,
  backwardFlight: false,
  commandedThrottle: 0,
  engineThrottle: 0,
  thrust: 0,
  parasiteDrag: 0,
  inducedDrag: 0,
  airbrakeDrag: 0,
  totalDrag: 0,
  airbrakeAmount: 0,
  afterburnerActive: false,
  currentG: 1,
  extremeManeuverActive: false,
  verticalSpeed: 0,
}

export function createTelemetry() {
  return { ...EMPTY_TELEMETRY }
}
