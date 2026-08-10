/*
Device-neutral pilot input.

Device adapters only hold semantic actions or publish analogue axes. The flight loop calls
`stepFlightInput` once per rendered frame and receives one continuous intent object. Physics
never needs to know whether pitch came from an arrow key, a gamepad, a pointer, or a touch
control.

`pressed` remains public because the HUD and the manoeuvre bot are device adapters too: they
hold the exact same actions as the keyboard. Analogue sources are kept separately and mixed
by strongest deflection so adding a gamepad cannot make keyboard controls fight it.

W and S are a speed control, not a power lever. They move `commandSpeedKmh` — the airspeed
the pilot is asking for, in the same km/h the HUD already reads — and the throttle the
model consumes is derived from it. The command holds where it is left, because a number
you chose is a number you should still have thirty seconds later.

This is the arcade simplification and it is deliberate: there is no spool to reason about,
no lever position to remember, and no unit conversion between what the pilot wants and
what the instruments say. It stays honest because it is feedforward only. Drag from a hard
pull, the air brake, and reheat are all still settled by the flight model, so the aircraft
sags below its commanded speed in a turn and has to be flown back up to it.

Two separate intents sit above the stick, and the whole control scheme depends on the
player never confusing them:

  high-g          Space, or W+S held together — "turn as hard as this wing can"
  maneuver-assist Left Alt — "I am asking for post-stall control"

They are different keys because they are different regimes. High-G stays an aerodynamic
turn: more rate, more alpha, far more induced drag, and a nose that stays near the flight
path. Maneuver Assist is the consent line for PSM, where the nose is allowed to leave the
airstream entirely. Neither one implies the other, and no amount of high-G alpha opens the
post-stall envelope on its own.

W+S is the alternative high-G chord because those two keys are already under the fingers.
Held together they neither accelerate nor decelerate: `readThrottleDirection` cancels to
zero so the commanded speed holds, and the arcade air brake stands down so the chord costs
the same energy Space does — through induced drag, not through a board.
*/

import { readThrottleForAirspeedKmh } from './performance'

export const FLIGHT_BINDINGS = {
  ArrowUp: 'pitch-up',
  ArrowDown: 'pitch-down',
  ArrowLeft: 'roll-left',
  ArrowRight: 'roll-right',
  KeyQ: 'yaw-left',
  KeyE: 'yaw-right',
  KeyW: 'throttle-up',
  KeyS: 'throttle-down',
  KeyF: 'flaps',
  KeyV: 'rear-view',
  ShiftLeft: 'afterburner',
  ShiftRight: 'afterburner',
  Space: 'high-g',
  AltLeft: 'maneuver-assist',
}

const AXES = ['pitch', 'roll', 'yaw']

// The canvas is a virtual flight stick. The first few percent around its centre are quiet,
// then the curve opens progressively: small wrist movements trim the flight path while a
// deliberate move toward an edge can still command the full airframe. The reach is a share
// of the whole viewport rather than of one half, so 39% puts full deflection comfortably
// inside either edge without making the centre nervous.
const MOUSE_STICK_DEAD_ZONE = 0.08
const MOUSE_STICK_REACH = 0.39
const MOUSE_STICK_EXPO = 1.35

const RESPONSE = {
  pitch: { engage: 4.6, release: 7.5 },
  roll: { engage: 5.5, release: 8.5 },
  yaw: { engage: 3.8, release: 6.5 },
  flaps: { engage: 5, release: 7 },
  airBrake: { engage: 5, release: 8 },
}

function clampAxis(value) {
  return Math.max(-1, Math.min(1, Number(value) || 0))
}

function shapeMouseAxis(value) {
  const clamped = clampAxis(value)
  const magnitude = Math.abs(clamped)
  if (magnitude <= MOUSE_STICK_DEAD_ZONE) return 0
  const live = (magnitude - MOUSE_STICK_DEAD_ZONE) / (1 - MOUSE_STICK_DEAD_ZONE)
  return Math.sign(clamped) * (live ** MOUSE_STICK_EXPO)
}

// Translate an absolute pointer position into the same analogue stick axes a gamepad or bot
// publishes. Up is positive pitch and right is positive roll. Keeping this calculation in
// the device-neutral layer makes it testable and, more importantly, keeps the route from
// inventing a second control path around `stepFlightInput`.
export function readMouseFlightAxes(clientX, clientY, bounds = {}) {
  const width = Math.max(Number(bounds.width) || 0, 1)
  const height = Math.max(Number(bounds.height) || 0, 1)
  const centreX = (Number(bounds.left) || 0) + (width * 0.5)
  const centreY = (Number(bounds.top) || 0) + (height * 0.5)
  return {
    pitch: shapeMouseAxis((centreY - clientY) / (height * MOUSE_STICK_REACH)),
    roll: shapeMouseAxis((clientX - centreX) / (width * MOUSE_STICK_REACH)),
    yaw: 0,
  }
}

function moveToward(current, target, amount) {
  if (current < target) return Math.min(current + amount, target)
  if (current > target) return Math.max(current - amount, target)
  return target
}

function smoothAxis(current, target, response, step) {
  const returning = target === 0 || Math.sign(target) !== Math.sign(current)
    || Math.abs(target) < Math.abs(current)
  return moveToward(current, target, (returning ? response.release : response.engage) * step)
}

function digitalAxis(pressed, positive, negative) {
  return Number(pressed.has(positive)) - Number(pressed.has(negative))
}

function strongestAxis(state, axis, digital) {
  let resolved = digital
  for (const source of state.analog.values()) {
    const candidate = clampAxis(source[axis])
    if (Math.abs(candidate) > Math.abs(resolved)) resolved = candidate
  }
  return resolved
}

export function readAxes(pressed) {
  return {
    pitch: digitalAxis(pressed, 'pitch-up', 'pitch-down'),
    roll: digitalAxis(pressed, 'roll-right', 'roll-left'),
    yaw: digitalAxis(pressed, 'yaw-right', 'yaw-left'),
    flaps: Number(pressed.has('flaps')),
  }
}

export function readThrottleDirection(pressed) {
  return digitalAxis(pressed, 'throttle-up', 'throttle-down')
}

export function readAccelerate(pressed) {
  return pressed.has('throttle-up') && !pressed.has('throttle-down')
}

export function readDecelerate(pressed) {
  return pressed.has('throttle-down') && !pressed.has('throttle-up')
}

// The two speed keys held together are the high-G chord rather than two commands
// arguing. Kept private so every reader below asks the same question the same way.
function isHighGChord(pressed) {
  return pressed.has('throttle-up') && pressed.has('throttle-down')
}

// Max-performance turn intent. One dedicated action plus the W+S chord, resolved here so
// the model, the HUD and the bot all see one boolean and no key codes.
export function readHighG(pressed) {
  return pressed.has('high-g') || isHighGChord(pressed)
}

// PSM stays deliberate instead of opening during an ordinary slow, hard turn — or during a
// high-G pull, which is a different regime with a different key. Device adapters may put
// this intent on an ergonomic single key, a trigger chord, or a touch pad.
export function readPsmArm(pressed) {
  return pressed.has('maneuver-assist')
}

export function readAfterburnerCommand(pressed) {
  return pressed.has('afterburner')
}

export function readAirBrake(pressed, pitch = 0, envelope = {}) {
  // A dedicated air-brake action remains available for future HOTAS adapters, but the
  // default arcade control speaks in intent: S means slow down, so it reduces power and
  // progressively opens the brake. A committed pull gets the full brake for a high-G turn.
  if (pressed.has('air-brake')) return 1
  // W+S is a turn command, not a deceleration command. Leaving the brake open here would
  // make the chord bleed harder than Space does, and the two are advertised as the same
  // control. High-G pays its energy through induced drag either way.
  if (isHighGChord(pressed)) return 0
  if (!pressed.has('throttle-down')) return 0

  const deceleration = envelope.deceleration ?? {}
  const fullBrakePitch = deceleration.fullBrakePitch ?? 0.72
  if (pitch >= fullBrakePitch) return 1
  return Math.max(0, Math.min(1, deceleration.airBrakeLevel ?? 0.65))
}

// The commandable band is the whole dry envelope the airframe has anywhere, not the
// narrower one it happens to hold at this altitude. Clamping to the local ceiling instead
// would make the pilot's chosen number change by itself during a climb or a dive; letting
// the command stand and letting the derived throttle saturate at full power keeps the
// control honest and lets a climb simply deliver the speed that was already asked for.
export function readCommandSpeedLimits(envelope) {
  const { performance } = envelope
  return {
    min: performance.minKmh,
    max: Math.max(performance.seaLevel.dryKmh, performance.highAltitude.dryKmh),
  }
}

export function clampCommandSpeedKmh(speedKmh, envelope) {
  const { min, max } = readCommandSpeedLimits(envelope)
  return Math.max(min, Math.min(max, Number(speedKmh) || min))
}

export function createFlightInputState(commandSpeedKmh = 0) {
  return {
    pressed: new Set(),
    analog: new Map(),
    cameraLook: {
      active: false,
      yaw: 0,
      pitch: 0,
    },
    // The speed the pilot has asked for, and the power that currently serves it. Only the
    // first is a control; `throttle` is published for the flight model and the HUD.
    commandSpeedKmh,
    throttle: 0,
    intent: {
      pitch: 0,
      roll: 0,
      yaw: 0,
      flaps: 0,
      throttle: 0,
      airBrake: 0,
      afterburner: false,
      // The four semantic commands the flight model reads as intent rather than as axes.
      // A bot or a gamepad publishes exactly these, which is what keeps the AI flying the
      // same physics the player does.
      accelerate: false,
      decelerate: false,
      highG: false,
      psmArm: false,
    },
  }
}

// Anything that is not the keyboard — the HUD speed selector, a HOTAS detent, a touch
// control — sets the commanded speed here rather than reaching for the throttle.
export function setCommandSpeedKmh(state, speedKmh, envelope) {
  state.commandSpeedKmh = clampCommandSpeedKmh(speedKmh, envelope)
  return state.commandSpeedKmh
}

export function setAnalogFlightInput(state, source, axes = {}) {
  const next = {}
  for (const axis of AXES) next[axis] = clampAxis(axes[axis])
  state.analog.set(source, next)
}

export function clearAnalogFlightInput(state, source) {
  state.analog.delete(source)
}

export function releaseFlightInput(state) {
  state.pressed.clear()
  state.analog.clear()
  state.cameraLook.active = false
}

export function resetFlightInput(state, commandSpeedKmh = state.commandSpeedKmh) {
  releaseFlightInput(state)
  state.commandSpeedKmh = commandSpeedKmh
  state.intent.pitch = 0
  state.intent.roll = 0
  state.intent.yaw = 0
  state.intent.flaps = 0
  state.intent.airBrake = 0
  state.intent.afterburner = false
  state.intent.accelerate = false
  state.intent.decelerate = false
  state.intent.highG = false
  state.intent.psmArm = false
  return state
}

/*
`altitude` is required rather than defaulted, because the throttle that serves a given
speed depends on it and a silent sea-level fallback would quietly mis-power every caller
that forgot. Passing last frame's altitude is fine — the aircraft cannot climb far enough
in one frame to matter, and the flight model settles the difference either way.
*/
export function stepFlightInput(state, step, envelope, altitude) {
  const raw = readAxes(state.pressed)
  const targets = {
    pitch: strongestAxis(state, 'pitch', raw.pitch),
    roll: strongestAxis(state, 'roll', raw.roll),
    yaw: strongestAxis(state, 'yaw', raw.yaw),
  }

  for (const axis of AXES) {
    state.intent[axis] = smoothAxis(
      state.intent[axis],
      targets[axis],
      RESPONSE[axis],
      step,
    )
  }

  state.intent.flaps = smoothAxis(
    state.intent.flaps,
    raw.flaps,
    RESPONSE.flaps,
    step,
  )
  state.intent.airBrake = smoothAxis(
    state.intent.airBrake,
    readAirBrake(state.pressed, targets.pitch, envelope),
    RESPONSE.airBrake,
    step,
  )
  state.intent.afterburner = readAfterburnerCommand(state.pressed)
  state.intent.accelerate = readAccelerate(state.pressed)
  state.intent.decelerate = readDecelerate(state.pressed)
  state.intent.highG = readHighG(state.pressed)
  state.intent.psmArm = readPsmArm(state.pressed)

  // W and S walk the commanded speed, which then holds. Power is whatever it takes to
  // serve that number here, so the pilot never operates the engine directly.
  state.commandSpeedKmh = clampCommandSpeedKmh(
    state.commandSpeedKmh
      + (readThrottleDirection(state.pressed) * step * envelope.commandKmhPerSecond),
    envelope,
  )
  state.throttle = readThrottleForAirspeedKmh(state.commandSpeedKmh, altitude, envelope)
  state.intent.throttle = state.throttle

  return state.intent
}
