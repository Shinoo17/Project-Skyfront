/*
Device-neutral pilot input.

Device adapters only hold semantic actions or publish analogue axes. The flight loop calls
`stepFlightInput` once per rendered frame and receives one continuous intent object. Physics
never needs to know whether pitch came from an arrow key, a gamepad, a pointer, or a touch
control.

`pressed` remains public because the HUD and the manoeuvre bot are device adapters too: they
hold the exact same actions as the keyboard. Analogue sources are kept separately and mixed
by strongest deflection so adding a gamepad cannot make keyboard controls fight it.

The mouse is one of those adapters. It holds a stick whose position is the pointer's position
inside a gate on the glass — see `setMouseStick` and `moveMouseStick` below — and publishes
through the same analogue path everything else uses, so nothing downstream of
`stepFlightInput` knows a mouse exists, or whether the browser has locked it.

W and S are a speed control, not a power lever. They move `commandSpeedKmh` — the airspeed
the pilot is asking for, in the same km/h the HUD already reads — and the throttle the
model consumes is derived from it. The command holds where it is left, because a number
you chose is a number you should still have thirty seconds later.

The number row names three of those speeds outright — see `speedDetentsKmh` on the
envelope. A detent is a jump, not a hold: it snaps the command on the press and then stands
aside, so W and S trim away from it immediately and holding the key does not pin the
aircraft to it. Last press wins while several are held, because a hand mashing the row
means the key it landed on most recently.

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

import { readMaxDryCeilingKmh, readThrottleForAirspeedKmh } from './performance'

export const FLIGHT_BINDINGS = {
  ArrowUp: 'pitch-up',
  ArrowDown: 'pitch-down',
  ArrowLeft: 'roll-left',
  ArrowRight: 'roll-right',
  KeyQ: 'yaw-left',
  KeyE: 'yaw-right',
  KeyW: 'throttle-up',
  KeyS: 'throttle-down',
  Digit1: 'speed-detent-1',
  Digit2: 'speed-detent-2',
  Digit3: 'speed-detent-3',
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
How much of the screen the pilot has to cross for full stick, as a divisor on the gate radius
below. It is a continuous setting rather than three named steps because the right number is a
property of the pilot's screen and how close they sit to it, and no preset any of us picks is
going to land on it for them.

The band is narrower than the one the old travel-based stick needed, because it no longer has
to absorb an order of magnitude of mouse DPI: a position on the glass is a position on the
glass whatever the sensor under the hand is doing. At the floor the gate is roughly two
thirds of the short edge of the window and at the ceiling roughly a sixth, and both ends stay
comfortably inside the window — a gate that ran off the edge would be a full deflection the
pilot could not reach.
*/
export const MOUSE_SENSITIVITY_RANGE = { min: 0.5, max: 2, step: 0.05, default: 1 }

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
The mouse is a position on the glass, not an accumulation of travel.

Where the pointer sits inside the gate *is* where the stick sits. Middle of the screen is
neutral, top edge of the gate is full aft, and the pilot's hand is therefore a readout of the
control they are holding — the one thing a mouse can offer that a real stick's spring offers
and a relative stick cannot. Level flight is "put the pointer back in the middle", which is a
thing the hand already knows how to do, rather than a travel to retrace by eye.

This replaces a relative stick that only counted travel, and the reason that one existed no
longer holds. It was chosen because screen-up meant body pitch-up only while the camera was
unrolled, and the chase camera deliberately was not. The camera now carries the airframe's
roll in full — see the horizon note in `chaseCamera.js` — so screen-up is body pitch-up at
every attitude, and the screen is a control surface again.

Two places still lapse, and both are the camera deliberately not looking down the nose. A
held Action shot freezes in the world frame through a Cobra or a Kulbit, and rear view looks
aft, where screen-up reads as pitch-down and roll reads reversed. Neither is worth correcting
for: the first is a composed shot the pilot commits to rather than steers through, and the
second is a glance behind that inverts by construction — a stick that flipped with it would
be a control that changed meaning while the aircraft did not. The gate on the HUD stays
truthful in both cases even while the picture behind it is not.

The surface takes the pointer while the mouse is flying, so the hand cannot walk the stick
off the canvas and into the rest of the desktop mid-turn. That removes the cursor, not the
position: `moveMouseStick` keeps the position here and walks it with the raw motion the lock
reports, clamped to the gate so there is never travel owed back. Neutral is then the middle
of the *gate* rather than a pixel on the glass, and the HUD's gate is what shows it.

One more consequence of a position, which a travel-fed stick did not have: it is live
wherever the pointer was left, so a stick parked off to one side is a deflection nobody
is holding. The dead zone below makes the middle of the gate a place rather than a point,
and a held arrow key still outranks it — `strongestAxis` needs a strictly larger deflection
to take an axis, and a key is always full — so the keyboard can always take the aircraft back.
*/
/*
The radius of the gate, as a fraction of the shorter side of the window, at 1× sensitivity.
The setting divides this and nothing else.

One radius rather than one per axis, because the gate is a disc. Shaping the axes separately
would make it a square: a diagonal would need 1.41 times the distance from the middle that a
straight pull needs, and the dead zone would become a box the pointer could leave on one axis
while still sitting inside it on the other. Both read as the aircraft answering unevenly, and
a rolling pull-up is a diagonal.
*/
const MOUSE_STICK_RADIUS = 0.34

// Fine around neutral, decisive at the edges. Squared is gentle enough that the middle third
// of the gate is small corrections rather than a lurch, which is most of what makes a pointer
// flyable at all.
const MOUSE_STICK_CURVE = 2
/*
The dead zone, as a fraction of the gate radius, and much wider than a relative stick could
afford. A relative stick has no neutral to find — it is wherever the travel left it — so a
wide dead zone there is just lost resolution. A positional one has exactly one neutral, the
middle of the screen, and the dead zone is what makes it a *place* the pointer can be put
back into rather than a point it has to be balanced on.
*/
const MOUSE_STICK_DEAD_ZONE = 0.12

export const MOUSE_STICK_GATE = {
  radius: MOUSE_STICK_RADIUS,
  deadZone: MOUSE_STICK_DEAD_ZONE,
}

function clampAxis(value) {
  return Math.max(-1, Math.min(1, Number(value) || 0))
}

/*
How far across the window the gate reaches, in pixels, for a window whose shorter side is
`extent`. Sensitivity divides the radius: turning it up shrinks the gate, so less of the
screen is a full deflection.
*/
export function mouseStickRadiusPx(extent, sensitivity = 1) {
  const short = Math.max(Number(extent) || 0, 1)
  return (short * MOUSE_STICK_RADIUS) / clampMouseSensitivity(sensitivity)
}

// Pixels from the middle of the gate into gate radii, and into the sign convention the
// aircraft uses: right is positive roll, and up the screen — a negative pixel offset — is
// positive pitch, which the inversion setting swaps.
function shapeMouseStick(stick, radius, invertPitch) {
  const pitch = stick.py / radius
  stick.live = true
  stick.x = stick.px / radius
  stick.y = invertPitch ? pitch : -pitch
  return stick
}

/*
Put the stick where the pointer is. `offsetX`/`offsetY` are pixels from the middle of the
surface, with `extent` its shorter side.

Stored unclamped on purpose. Clamping each axis here would bend the direction of a pointer
sitting off to one side, turning a pull that is mostly aft and slightly right into one that
is evenly both. `readMouseStickAxes` clamps the length instead, which keeps the direction the
pilot pointed and is what makes the gate a disc rather than a box.
*/
export function setMouseStick(state, offsetX, offsetY, {
  extent = 0,
  invertPitch = false,
  sensitivity = 1,
} = {}) {
  const stick = state.mouseStick
  stick.px = Number(offsetX) || 0
  stick.py = Number(offsetY) || 0
  return shapeMouseStick(stick, mouseStickRadiusPx(extent, sensitivity), invertPitch)
}

/*
The same stick, driven by motion instead of position, for a pointer the browser has locked.

A locked pointer has no position — the OS cursor is gone and `clientX`/`clientY` freeze — so
the position is kept here and walked by the raw motion the lock reports. What the pilot holds
is still a place inside the gate, which is the whole point: neutral remains somewhere the hand
can be brought back to rather than a travel to retrace by eye.

The held position is clamped to the gate on every step, by length rather than per axis. Both
halves of that matter. Unclamped, a hand shoved a metre to the left would have to travel the
same metre back before the nose answered — the windup a real stick's spring exists to prevent.
Clamped per axis instead, the gate would quietly become a box and a corner would take further
to reach than a straight pull.
*/
export function moveMouseStick(state, deltaX, deltaY, {
  extent = 0,
  invertPitch = false,
  sensitivity = 1,
} = {}) {
  const stick = state.mouseStick
  // Recomputed per step rather than cached, so a resized window or a moved sensitivity
  // slider simply re-clamps what is held instead of stranding it outside a smaller gate.
  const radius = mouseStickRadiusPx(extent, sensitivity)
  const px = stick.px + (Number(deltaX) || 0)
  const py = stick.py + (Number(deltaY) || 0)
  const magnitude = Math.hypot(px, py)
  const scale = magnitude > radius ? radius / magnitude : 1
  stick.px = px * scale
  stick.py = py * scale
  return shapeMouseStick(stick, radius, invertPitch)
}

// Back to neutral with the pointer still on the surface — the aircraft stops being asked for
// anything, which is a different thing from the pointer leaving. Free look uses this: the
// camera is being aimed, so the stick is not being flown. The held position goes with it, or
// a locked pointer would resume from a deflection the hand had let go of.
export function centreMouseStick(state) {
  state.mouseStick.px = 0
  state.mouseStick.py = 0
  state.mouseStick.x = 0
  state.mouseStick.y = 0
}

// The surface has taken the pointer. Live and centred, in that order, so the gate on the HUD
// is up and reading neutral from the first frame rather than appearing on the first twitch of
// the hand — the pilot has just given up their cursor and needs to see what replaced it.
export function engageMouseStick(state) {
  centreMouseStick(state)
  state.mouseStick.live = true
}

// The pointer has left the surface. Centred as well as dropped, so the aircraft is not left
// holding the deflection the pointer had when it crossed the edge.
export function clearMouseStick(state) {
  state.mouseStick.live = false
  centreMouseStick(state)
}

/*
Shape the stick into the same analogue axes a gamepad or the bot publishes. Null when the
mouse is not flying, which the caller reads as "clear this source" rather than as a neutral
stick — the two are different, and only the first leaves the keyboard alone.

The shaping is radial: the length is clamped to the gate, the dead zone is taken off it, the
curve is applied to what is left, and the direction is carried through untouched. That is the
whole reason the disc is a disc — a diagonal reaches full deflection at exactly the same
distance from the middle as a straight pull, and the corner of the envelope a barrel roll
lives in is reached by pointing at it rather than by finding a corner of a box.
*/
export function readMouseStickAxes(stick) {
  if (!stick?.live) return null
  const neutral = { pitch: 0, roll: 0, yaw: 0 }
  const magnitude = Math.hypot(stick.x, stick.y)
  if (magnitude < 1e-6) return neutral

  const travel = Math.min(magnitude, 1)
  if (travel <= MOUSE_STICK_DEAD_ZONE) return neutral

  const live = (travel - MOUSE_STICK_DEAD_ZONE) / (1 - MOUSE_STICK_DEAD_ZONE)
  const scale = (live ** MOUSE_STICK_CURVE) / magnitude
  return {
    pitch: clampAxis(stick.y * scale),
    roll: clampAxis(stick.x * scale),
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

// The speed detents, in the order `envelope.speedDetentsKmh` lists them. Actions rather
// than key codes, so a gamepad d-pad or a touch button reaches the same three speeds.
const SPEED_DETENT_CONTROLS = ['speed-detent-1', 'speed-detent-2', 'speed-detent-3']

/*
Which named speed is currently being asked for, or null for none.

`pressed` is a Set and a Set iterates in insertion order, so walking it rather than the
detent list is what makes the most recent press win: a pilot who holds 2 and then hits 3
gets 3, instead of nothing until the first key comes back up.
*/
export function readSpeedDetentKmh(pressed, envelope) {
  const detents = envelope.speedDetentsKmh
  if (!detents?.length) return null
  let selected = null
  for (const control of pressed) {
    const index = SPEED_DETENT_CONTROLS.indexOf(control)
    if (index < 0) continue
    const speedKmh = detents[index]
    if (Number.isFinite(speedKmh)) selected = speedKmh
  }
  return selected
}

/*
The one detent key that went down this step, or null.

The edge is tracked on the keys rather than on the speed they name, and it has to be. A
latched speed cannot tell a press from a release: hold 2, add 3, then let 3 go, and the row
is naming 780 again — a different number from the latched 1100, which a speed latch reads as
a fresh press and acts on. Nobody pressed anything. Watching the keys, releasing 3 adds no
new control, so nothing happens and the command stays where the pilot last put it.

The last new control wins for the same reason `readSpeedDetentKmh` does.
*/
function readPressedSpeedDetent(pressed, held) {
  let selected = null
  for (const control of pressed) {
    if (SPEED_DETENT_CONTROLS.includes(control) && !held.has(control)) selected = control
  }
  return selected
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
//
// "Anywhere" is `readMaxDryCeilingKmh` rather than the table's high-altitude column,
// because `maxPerformanceMix` means that column is no longer somewhere the aircraft can
// get to. A command past this one would be a number that saturates the throttle at every
// height on every map — a stretch of travel that does nothing.
export function readCommandSpeedLimits(envelope) {
  return {
    min: envelope.performance.minKmh,
    max: Math.max(envelope.performance.seaLevel.dryKmh, readMaxDryCeilingKmh(envelope)),
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
    // Where the pointer sits inside the gate. `px`/`py` are pixels from the middle — the raw
    // position, which a locked pointer has to be walked into and a free one simply reports —
    // and `x`/`y` are the same thing in gate radii, which is what everything downstream reads.
    // Stored unclamped in radii: `readMouseStickAxes` clamps the length rather than the axes,
    // so the direction survives. `live` is whether the mouse is flying the aircraft at all;
    // the surface sets it while it holds the pointer and drops it when it loses it.
    mouseStick: {
      live: false,
      px: 0,
      py: 0,
      x: 0,
      y: 0,
    },
    // The speed the pilot has asked for, and the power that currently serves it. Only the
    // first is a control; `throttle` is published for the flight model and the HUD.
    commandSpeedKmh,
    throttle: 0,
    // Which detent keys were down last step, kept only so the next one can tell a fresh
    // press from a key still being held. A detent that stayed applied would be a hold rather
    // than a jump, and W/S could not trim away from it.
    heldDetents: new Set(),
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
  state.heldDetents.clear()
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
  //
  // A detent overrides the walk on the step its key goes down and on no other, so keeping it
  // held is a walk again from the next step and W and S trim off the named speed with
  // nothing to fight.
  const detent = readPressedSpeedDetent(state.pressed, state.heldDetents)
  const detentKmh = detent
    ? envelope.speedDetentsKmh?.[SPEED_DETENT_CONTROLS.indexOf(detent)]
    : null
  state.heldDetents.clear()
  for (const control of SPEED_DETENT_CONTROLS) {
    if (state.pressed.has(control)) state.heldDetents.add(control)
  }
  state.commandSpeedKmh = clampCommandSpeedKmh(
    Number.isFinite(detentKmh)
      ? detentKmh
      : state.commandSpeedKmh
        + (readThrottleDirection(state.pressed) * step * envelope.commandKmhPerSecond),
    envelope,
  )
  state.throttle = readThrottleForAirspeedKmh(state.commandSpeedKmh, altitude, envelope)
  state.intent.throttle = state.throttle

  return state.intent
}
