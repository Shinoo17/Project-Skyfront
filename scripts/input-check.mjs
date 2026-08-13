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
assert.equal(FLIGHT_BINDINGS.Space, 'air-brake', 'Space must be the independent airbrake')
assert.equal(FLIGHT_BINDINGS.ShiftLeft, 'afterburner', 'Shift must request afterburner')
assert.equal(FLIGHT_BINDINGS.KeyA, 'roll-left', 'A must roll left')
assert.equal(FLIGHT_BINDINGS.KeyD, 'roll-right', 'D must roll right')

// Digital axes are softened, while the semantic engine intents are immediate.
input.pressed.add('pitch-up')
const firstPitch = step().pitch
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

// Space is an overlay: both high and low dry-power commands may coexist with the board.
input.pressed.add('air-brake')
intent = step()
assert.equal(intent.commandedThrottle, envelope.engineControl.idlePower,
  'S+Space must retain the idle command')
assert.equal(intent.airBrake, 1, 'S+Space must deploy the board')
input.pressed.delete('throttle-down')
input.pressed.add('throttle-up')
intent = step()
assert.equal(intent.commandedThrottle, envelope.engineControl.militaryPower,
  'W+Space must retain MIL power')
assert.equal(intent.airBrake, 1, 'W+Space must keep the board deployed')

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

console.log('PASS input: W/S power intent, independent Shift/Space, W+S Extreme chord and'
  + ' forgiveness, soft parasite-drag assist, smooth digital and analogue controls')
