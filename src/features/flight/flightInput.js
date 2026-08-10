/*
Device-neutral pilot input.

Device adapters only hold semantic actions or publish analogue axes. The flight loop calls
`stepFlightInput` once per rendered frame and receives one continuous intent object. Physics
never needs to know whether pitch came from an arrow key, a gamepad, a pointer, or a touch
control.

`pressed` remains public because the HUD and the manoeuvre bot are device adapters too: they
hold the exact same actions as the keyboard. Analogue sources are kept separately and mixed
by strongest deflection so adding a gamepad cannot make keyboard controls fight it.

The mouse is one of those adapters. It holds a relative stick that only mouse *travel* moves —
see `moveMouseStick` below — and publishes through the same analogue path everything else
uses, so nothing downstream of `stepFlightInput` knows a mouse exists.

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

const MOUSE_FLIGHT_ENABLED_KEY = 'f22-flight-mouse-stick-enabled'
const MOUSE_PITCH_INVERTED_KEY = 'f22-flight-mouse-pitch-inverted'
const MOUSE_SENSITIVITY_KEY = 'f22-flight-mouse-sensitivity'

/*
How much stick the pilot gets per centimetre of desk, as a plain multiplier on the travel
below. It is a continuous setting rather than three named steps because the right number is
a property of the pilot's hardware and grip — mouse DPI alone spans an order of magnitude —
and no preset any of us picks is going to land on it for them.

The band is wide enough to cover that spread from both ends and closed at both: below the
floor a full roll stops fitting on any desk, and above the ceiling the dead zone is the only
thing between neutral and full deflection, which is not a control any more.
*/
export const MOUSE_SENSITIVITY_RANGE = { min: 0.25, max: 3, step: 0.05, default: 1 }

export function clampMouseSensitivity(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return MOUSE_SENSITIVITY_RANGE.default
  return Math.max(MOUSE_SENSITIVITY_RANGE.min, Math.min(MOUSE_SENSITIVITY_RANGE.max, number))
}

const RESPONSE = {
  pitch: { engage: 4.6, release: 7.5 },
  roll: { engage: 5.5, release: 8.5 },
  yaw: { engage: 3.8, release: 6.5 },
  flaps: { engage: 5, release: 7 },
  airBrake: { engage: 5, release: 8 },
}

// A stick fed by mouse travel is already a continuous signal. The response above exists to
// soften the 0→1 step a key makes, and stacking it on top of a signal that never steps is
// pure latency — about a fifth of a second between the hand moving and the nose answering,
// which is most of what "not following the mouse" actually was. Sources that declare
// themselves direct get a filter tight enough to take the numerical edge off a frame-to-frame
// jump and no tighter. The keyboard, and the manoeuvre bot, keep the feel they were tuned on.
const DIRECT_RESPONSE = {
  pitch: { engage: 16, release: 18 },
  roll: { engage: 18, release: 20 },
  yaw: { engage: 14, release: 16 },
}

/*
The mouse is a relative stick, not a position on the glass.

Only travel counts: move the hand right and the stick goes right, and where the pointer
happens to sit on the desktop never enters into it. That is what lets the surface capture the
pointer — with nothing to read off an absolute position, there is no edge of the screen to run
out of, and a roll can be held for as long as the wrist keeps moving.

It also settles the question the old absolute stick got wrong. Screen up meant body pitch-up
only while the camera was unrolled and looking down the nose, and the Action camera is
deliberately neither: it follows less than half the bank and freezes its shot in the world
frame during a post-stall manoeuvre. A stick has no such problem, because a stick is not a
place on the screen — up is pull, right is roll right, and no camera can rotate that.

The stick holds where it is left, exactly as the airframe's real one would. That is why the
HUD draws it: with nothing on the desk to feel, the gate on the glass is the only way the
pilot knows how much they are holding, and centring it by eye is how they fly level again.
*/
// Pixels of travel for full deflection at 1× sensitivity. Around a third of a 1080p screen's
// width, which puts a full-authority roll inside one comfortable sweep without making small
// corrections impossible to place. The setting scales this and nothing else.
const MOUSE_STICK_TRAVEL = 460
// A gentle expo. The old curve was steeper and combined with the smoothing above it made the
// first third of the stick feel like nothing at all.
const MOUSE_STICK_EXPO = 1.25
// Small enough to be invisible in flight, large enough that a mouse resting on a slightly
// uneven desk does not hold a bank.
const MOUSE_STICK_DEAD_ZONE = 0.035

function clampAxis(value) {
  return Math.max(-1, Math.min(1, Number(value) || 0))
}

function shapeStickAxis(value) {
  const clamped = clampAxis(value)
  const magnitude = Math.abs(clamped)
  if (magnitude <= MOUSE_STICK_DEAD_ZONE) return 0
  const live = (magnitude - MOUSE_STICK_DEAD_ZONE) / (1 - MOUSE_STICK_DEAD_ZONE)
  return Math.sign(clamped) * (live ** MOUSE_STICK_EXPO)
}

/*
Move the virtual stick by one mouse movement, in the raw `movementX`/`movementY` a captured
pointer reports. Right is positive roll; pushing the mouse away from the pilot — negative
`movementY` — is positive pitch, the sense a stick has, and the inversion setting swaps it.

The two axes clamp independently rather than to a circle: full roll while already at full
pitch is a control the airframe genuinely has, and gating it into a disc would take away the
corner of the envelope a barrel roll lives in.
*/
export function moveMouseStick(state, movementX, movementY, {
  invertPitch = false,
  sensitivity = 1,
} = {}) {
  const stick = state.mouseStick
  const scale = clampMouseSensitivity(sensitivity) / MOUSE_STICK_TRAVEL
  const pitchStep = (Number(movementY) || 0) * scale
  stick.live = true
  stick.x = clampAxis(stick.x + ((Number(movementX) || 0) * scale))
  stick.y = clampAxis(stick.y + (invertPitch ? pitchStep : -pitchStep))
  return stick
}

// Back to neutral with the stick still in the pilot's hand — the aircraft stops being asked
// for anything, which is a different thing from the pointer letting go of the surface.
export function centreMouseStick(state) {
  state.mouseStick.x = 0
  state.mouseStick.y = 0
}

// The surface has taken the pointer. Live from this instant rather than from the first
// movement, so the gate is on the glass before the pilot has moved anything — it is the only
// confirmation they get that the click did what it said.
export function captureMouseStick(state) {
  centreMouseStick(state)
  state.mouseStick.live = true
}

// The pointer has left the aircraft entirely. Centred as well as dropped, so re-entering the
// surface never starts with a deflection the pilot did not ask for and cannot see.
export function clearMouseStick(state) {
  state.mouseStick.live = false
  centreMouseStick(state)
}

// Shape the held stick into the same analogue axes a gamepad or the bot publishes. Null when
// the mouse is not flying, which the caller reads as "clear this source" rather than as a
// neutral stick — the two are different, and only the first leaves the keyboard alone.
export function readMouseStickAxes(stick) {
  if (!stick?.live) return null
  return {
    pitch: shapeStickAxis(stick.y),
    roll: shapeStickAxis(stick.x),
    yaw: 0,
  }
}

function readStoredBoolean(key, fallback) {
  try {
    const stored = window.localStorage.getItem(key)
    if (stored === 'true') return true
    if (stored === 'false') return false
  } catch {
    // Privacy modes may refuse storage; a usable in-session default still matters more.
  }
  return fallback
}

function writeStoredBoolean(key, value) {
  try {
    window.localStorage.setItem(key, String(Boolean(value)))
  } catch {
    // The current session still uses the choice even when the browser cannot remember it.
  }
}

export function readMouseFlightEnabled() {
  return readStoredBoolean(MOUSE_FLIGHT_ENABLED_KEY, true)
}

export function writeMouseFlightEnabled(value) {
  writeStoredBoolean(MOUSE_FLIGHT_ENABLED_KEY, value)
}

export function readMousePitchInverted() {
  return readStoredBoolean(MOUSE_PITCH_INVERTED_KEY, false)
}

export function writeMousePitchInverted(value) {
  writeStoredBoolean(MOUSE_PITCH_INVERTED_KEY, value)
}

export function readMouseSensitivity() {
  try {
    const stored = window.localStorage.getItem(MOUSE_SENSITIVITY_KEY)
    // A stored value from an older or hand-edited entry is clamped rather than trusted; the
    // one number that must never come back is one that makes the aircraft unflyable.
    if (stored !== null && Number.isFinite(Number(stored))) return clampMouseSensitivity(stored)
  } catch {
    // Privacy modes may refuse storage; a usable in-session default still matters more.
  }
  return MOUSE_SENSITIVITY_RANGE.default
}

export function writeMouseSensitivity(value) {
  try {
    window.localStorage.setItem(MOUSE_SENSITIVITY_KEY, String(clampMouseSensitivity(value)))
  } catch {
    // The current session still uses the choice even when the browser cannot remember it.
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

// Scratch, not a fresh object: this runs three times a frame for every aircraft on the
// range. Read it before the next call — nothing here holds onto it.
const STRONGEST = { value: 0, direct: false }
function strongestAxis(state, axis, digital) {
  STRONGEST.value = digital
  STRONGEST.direct = false
  for (const source of state.analog.values()) {
    const candidate = clampAxis(source[axis])
    if (Math.abs(candidate) > Math.abs(STRONGEST.value)) {
      STRONGEST.value = candidate
      STRONGEST.direct = source.direct === true
    }
  }
  return STRONGEST
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
    // The virtual stick the captured pointer holds, −1..1 on each axis. `live` is whether the
    // mouse is flying the aircraft at all; the surface sets it when it captures the pointer
    // and drops it the moment the capture ends.
    mouseStick: {
      live: false,
      x: 0,
      y: 0,
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

// `direct` says this source already publishes a continuous, closed-loop signal and wants the
// tight filter rather than the key-softening one. Mouse aim sets it; a bot flying scripted
// axes deliberately does not, so its manoeuvres keep the response they were authored against.
export function setAnalogFlightInput(state, source, axes = {}, { direct = false } = {}) {
  const next = { direct }
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
  clearMouseStick(state)
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
  const targets = { pitch: 0, roll: 0, yaw: 0 }

  for (const axis of AXES) {
    // Resolved and consumed one axis at a time: `strongestAxis` hands back shared scratch,
    // and which response an axis gets depends on which source actually won it.
    const resolved = strongestAxis(state, axis, raw[axis])
    targets[axis] = resolved.value
    state.intent[axis] = smoothAxis(
      state.intent[axis],
      resolved.value,
      resolved.direct ? DIRECT_RESPONSE[axis] : RESPONSE[axis],
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
