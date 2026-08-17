import assert from 'node:assert/strict'

import f22 from '../src/aircraft/f22.js'
import {
  FLIGHT_BINDINGS,
  centreMouseStick,
  clearAnalogFlightInput,
  createFlightInputState,
  mouseStickRadiusPx,
  moveMouseStick,
  readMouseStickAxes,
  resetFlightInput,
  setAnalogFlightInput,
  setMouseStick,
  stepFlightInput,
} from '../src/features/flight/flightInput.js'
import {
  readTargetAirspeedKmh,
  readThrottlePower,
} from '../src/features/flight/performance.js'

const FRAME = 1 / 60
const ALTITUDE = 815
const envelope = f22.flight.envelope
const initialPower = readThrottlePower(envelope.idleThrottle, envelope)
const trimSpeed = readTargetAirspeedKmh(envelope.idleThrottle, ALTITUDE, 0, envelope)
const input = createFlightInputState(initialPower)
const step = (speedKmh = trimSpeed) => stepFlightInput(
  input,
  FRAME,
  envelope,
  ALTITUDE,
  { speedKmh },
)

assert.equal(FLIGHT_BINDINGS.KeyW, 'throttle-up', 'W must request more dry power')
assert.equal(FLIGHT_BINDINGS.KeyS, 'throttle-down', 'S must request idle power')
assert.equal(FLIGHT_BINDINGS.KeyX, 'air-brake', 'X must be the independent airbrake')
assert.equal(FLIGHT_BINDINGS.Space, 'high-g', 'Space must be the High-G turn')
assert.equal(FLIGHT_BINDINGS.AltLeft, 'maneuver-assist', 'Alt must stay the PSM arm')
assert.equal(FLIGHT_BINDINGS.ShiftLeft, 'afterburner', 'Shift must request afterburner')
assert.equal(FLIGHT_BINDINGS.KeyA, 'roll-left', 'A must roll left')
assert.equal(FLIGHT_BINDINGS.KeyD, 'roll-right', 'D must roll right')
assert.equal(FLIGHT_BINDINGS.KeyF, undefined, 'F must not expose a manual flap command')

// The two are separate controls on purpose: in the band where PSM arms, a hard turn and a
// Cobra entry are the same stick, so a shared key would make every hard turn a tumble.
assert.notEqual(
  FLIGHT_BINDINGS.Space,
  FLIGHT_BINDINGS.AltLeft,
  'High-G and the PSM arm must not share a key',
)

// Digital axes are softened, while the semantic engine intents are immediate.
input.pressed.add('pitch-up')
const firstPitch = step().pitch
assert.equal('flaps' in input.intent, false, 'pilot intent must not contain a flap axis')
assert.ok(firstPitch > 0 && firstPitch < 0.2, 'keyboard pitch must ramp instead of snapping')
for (let frame = 0; frame < 20; frame += 1) step()
assert.equal(input.intent.pitch, 1, 'held pitch must reach full authority')
input.pressed.clear()
for (let frame = 0; frame < 20; frame += 1) step()
assert.equal(input.intent.pitch, 0, 'released pitch must recentre')

resetFlightInput(input, initialPower)
input.pressed.add('throttle-up')
let intent = step()
assert.equal(intent.accelerate, true, 'W must publish accelerate intent')
assert.equal(intent.decelerate, false, 'W must not publish decelerate intent')
assert.equal(intent.commandedThrottle, envelope.engineControl.militaryPower,
  'W must command MIL power, not a target speed')

input.pressed.clear()
const releasedMil = input.commandedThrottle
intent = step()
assert.ok(intent.commandedThrottle < releasedMil && intent.commandedThrottle > initialPower,
  'neutral assist must ease away from MIL instead of snapping to a fixed throttle')

input.pressed.add('throttle-down')
intent = step()
assert.equal(intent.decelerate, true, 'S must publish decelerate intent')
assert.equal(intent.commandedThrottle, envelope.engineControl.idlePower,
  'S must command idle power')
assert.equal(intent.airBrake, 0, 'S must never deploy the airbrake')

// The board is an overlay: both high and low dry-power commands may coexist with it.
input.pressed.add('air-brake')
intent = step()
assert.equal(intent.commandedThrottle, envelope.engineControl.idlePower,
  'S+X must retain the idle command')
assert.equal(intent.airBrake, 1, 'S+X must deploy the board')
input.pressed.delete('throttle-down')
input.pressed.add('throttle-up')
intent = step()
assert.equal(intent.commandedThrottle, envelope.engineControl.militaryPower,
  'W+X must retain MIL power')
assert.equal(intent.airBrake, 1, 'W+X must keep the board deployed')

// High-G and the PSM arm are each other's neighbours, never each other's alias.
input.pressed.clear()
resetFlightInput(input, 0.5)
input.pressed.add('high-g')
intent = step()
assert.equal(intent.highG, true, 'Space must request the High-G envelope')
assert.equal(intent.psmArm, false, 'High-G must never arm post-stall authority on its own')
assert.equal(intent.airBrake, 0, 'High-G must not deploy the board')
input.pressed.delete('high-g')
input.pressed.add('maneuver-assist')
intent = step()
assert.equal(intent.psmArm, true, 'Alt must arm post-stall authority')
assert.equal(intent.highG, false, 'the PSM arm must not imply the High-G envelope')

// Shift is a separate reheat request and does not silently rewrite dry-power intent.
input.pressed.clear()
resetFlightInput(input, 0.55)
input.pressed.add('afterburner')
intent = step()
assert.equal(intent.afterburner, true, 'Shift must publish afterburner intent')
assert.ok(intent.commandedThrottle < 0.56,
  'afterburner must not masquerade as a W/MIL command in the input layer')

// A near-simultaneous W+S chord restores and freezes the pre-chord intent.
input.pressed.clear()
resetFlightInput(input, 0.63)
input.pressed.add('throttle-up')
step()
assert.equal(input.commandedThrottle, 1, 'the first W frame may immediately request MIL')
input.pressed.add('throttle-down')
intent = step()
assert.equal(intent.extremeManeuverActive, true, 'W+S must activate Extreme Maneuver')
assert.equal(intent.highG, true, 'Extreme Maneuver must request the High-G envelope')
assert.equal(intent.psmArm, true, 'Extreme Maneuver must arm post-stall authority')
assert.equal(intent.accelerate, false, 'the chord must override W throttle interpretation')
assert.equal(intent.decelerate, false, 'the chord must override S throttle interpretation')
assert.equal(intent.commandedThrottle, 0.63,
  'chord forgiveness must restore the power intent from before the first key')
assert.equal(intent.airBrake, 0, 'W+S must not imply the independent airbrake')

input.pressed.delete('throttle-down')
intent = step()
assert.equal(intent.extremeManeuverActive, false, 'releasing S must leave Extreme immediately')
assert.equal(intent.accelerate, true, 'the remaining W must resume accelerate intent immediately')
assert.equal(intent.commandedThrottle, 1, 'the remaining W must immediately command MIL')

input.pressed.add('throttle-down')
step()
input.pressed.delete('throttle-up')
intent = step()
assert.equal(intent.decelerate, true, 'the remaining S must resume decelerate intent immediately')
assert.equal(intent.commandedThrottle, 0, 'the remaining S must immediately command idle')

// Neutral power assist follows current parasite drag, not a remembered cruise speed.
input.pressed.clear()
resetFlightInput(input, initialPower)
for (let frame = 0; frame < 120; frame += 1) step(trimSpeed)
assert.ok(Math.abs(input.commandedThrottle - initialPower) < 1e-6,
  'neutral assist must preserve a level-flight trim')
for (let frame = 0; frame < 120; frame += 1) step(trimSpeed * 0.75)
assert.ok(input.commandedThrottle < initialPower,
  'assist power must follow the current lower drag state, not pull back to old speed')

// Analogue and mouse sources still share the same device-neutral stick path.
setAnalogFlightInput(input, 'test-stick', { roll: 0.42, pitch: -0.25 })
for (let frame = 0; frame < 20; frame += 1) step()
assert.equal(input.intent.roll, 0.42, 'analogue roll must retain its magnitude')
assert.equal(input.intent.pitch, -0.25, 'analogue pitch must retain its magnitude')
clearAnalogFlightInput(input, 'test-stick')
for (let frame = 0; frame < 20; frame += 1) step()

const radius = mouseStickRadiusPx(1000, 1)
assert.equal(radius, 340, 'the mouse gate must retain its authored radius')
setMouseStick(input, 0, -radius, { extent: 1000 })
assert.equal(readMouseStickAxes(input.mouseStick).pitch, 1,
  'top of the mouse gate must be full pitch-up')
moveMouseStick(input, 0, radius * 2, { extent: 1000 })
assert.equal(readMouseStickAxes(input.mouseStick).pitch, -1,
  'one gate traversal must reach full opposite pitch')
centreMouseStick(input)
assert.deepEqual(readMouseStickAxes(input.mouseStick), { pitch: 0, roll: 0, yaw: 0 },
  'centring the live mouse stick must publish neutral axes')

/*
The stick against the camera's bank share, which is the one place two sign conventions from
different files have to agree.

The stick is a position on the glass and that only means anything while screen-up is body
pitch-up. Under Roll On the camera takes the whole bank and the two are the same axis; under
Hybrid and Off they are not, and `chase.screenRoll` — how far the airframe appears rotated
inside the frame — is the angle the drawn vector has to be turned by to get back to the
airframe's own frame.

`camera-check` proves the camera publishes that angle with the right magnitude and sign. What
it cannot prove is that this end of the wire turns the stick the *same* way, and a correction
applied backwards is the worst available outcome: it would double the error instead of
cancelling it, so a pilot pulling toward the top of the screen from a bank would roll further
over rather than toward level. Every existing assertion above would still pass, because they
all run at the zero-correction default.

So the test is the whole chain in miniature. Bank right — a positive screen roll, because a
positive angle about the follow axis is clockwise on screen — and pull straight up the glass.
The aircraft must answer with left roll, toward level, and with less pitch than a pull from
level would have given.
*/
{
  const stick = { live: true, x: 0, y: 1 }
  const level = readMouseStickAxes(stick, 0)
  assert.equal(level.pitch, 1, 'no correction must leave a screen-up pull as full pitch-up')
  assert.equal(level.roll, 0, 'no correction must leave a screen-up pull free of roll')

  const banked = readMouseStickAxes(stick, Math.PI / 4)
  assert.ok(
    banked.roll < -0.6,
    `a screen-up pull under a right bank must roll left toward level, got ${banked.roll}`,
  )
  assert.ok(
    banked.pitch > 0 && banked.pitch < level.pitch,
    `a screen-up pull under a right bank must keep some pitch-up, got ${banked.pitch}`,
  )
  assert.ok(
    Math.abs(Math.hypot(banked.pitch, banked.roll) - Math.hypot(level.pitch, level.roll)) < 1e-9,
    'the correction is a rotation and must not change how much stick is being held',
  )

  // A knife edge is the limit case: body up lies along screen right, so pointing at the top
  // of the screen is a request for pure roll and nothing else.
  const knifeEdge = readMouseStickAxes(stick, Math.PI / 2)
  assert.ok(
    Math.abs(knifeEdge.roll + 1) < 1e-9 && Math.abs(knifeEdge.pitch) < 1e-9,
    `a screen-up pull at ninety degrees of bank must be pure left roll, got ${JSON.stringify(knifeEdge)}`,
  )
}

const engine = envelope.engineControl
for (const key of [
  'engineSpoolUpRate',
  'engineSpoolDownRate',
  'militaryPower',
  'afterburnerMultiplier',
  'autoPowerAssistStrength',
  'extremeChordWindow',
]) {
  assert.ok(Number.isFinite(engine[key]), `engine tuning must expose ${key}`)
}

console.log('PASS input: W/S power intent, independent Shift/X, separate Space High-G and'
  + ' forgiveness, soft parasite-drag assist, smooth digital and analogue controls')
