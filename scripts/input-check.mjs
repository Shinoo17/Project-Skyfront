import assert from 'node:assert/strict'

import f22 from '../src/aircraft/f22.js'
import {
  FLIGHT_BINDINGS,
  clearAnalogFlightInput,
  createFlightInputState,
  setAnalogFlightInput,
  stepFlightInput,
} from '../src/features/flight/flightInput.js'

const FRAME = 1 / 60
const envelope = f22.flight.envelope
const input = createFlightInputState(envelope.idleThrottle)

assert.equal(FLIGHT_BINDINGS.Space, 'maneuver-assist',
  'Space must expose the ergonomic keyboard maneuver control')

input.pressed.add('pitch-up')
const firstPitch = stepFlightInput(input, FRAME, envelope).pitch
assert.ok(firstPitch > 0 && firstPitch < 0.2, 'keyboard pitch must ramp instead of snapping')

for (let frame = 0; frame < 20; frame += 1) stepFlightInput(input, FRAME, envelope)
assert.equal(input.intent.pitch, 1, 'held keyboard pitch must still reach full authority')

input.pressed.clear()

const throttleBeforePsm = input.throttle
input.pressed.add('maneuver-assist')
const psmIntent = stepFlightInput(input, FRAME, envelope)
assert.equal(psmIntent.psmArm, true, 'Maneuver Assist must arm PSM')
assert.equal(psmIntent.airBrake, 0, 'Maneuver Assist must not spend energy through the brake')
assert.equal(input.throttle, throttleBeforePsm, 'Maneuver Assist must not move the throttle')
input.pressed.clear()
const firstRelease = stepFlightInput(input, FRAME, envelope).pitch
assert.ok(firstRelease > 0 && firstRelease < 1, 'released pitch must return continuously')
for (let frame = 0; frame < 12; frame += 1) stepFlightInput(input, FRAME, envelope)
assert.equal(input.intent.pitch, 0, 'released pitch must recentre')

input.pressed.add('roll-left')
input.pressed.add('roll-right')
for (let frame = 0; frame < 10; frame += 1) stepFlightInput(input, FRAME, envelope)
assert.equal(input.intent.roll, 0, 'opposing digital controls must cancel')
input.pressed.clear()

const throttleBeforeOpposingPower = input.throttle
input.pressed.add('throttle-up')
input.pressed.add('throttle-down')
const opposingPower = stepFlightInput(input, FRAME, envelope)
assert.equal(opposingPower.psmArm, false, 'W+S must no longer arm PSM')
assert.equal(input.throttle, throttleBeforeOpposingPower, 'opposing throttle commands must cancel')
assert.ok(opposingPower.airBrake > 0, 'S must still publish slow-down intent while W is held')
input.pressed.clear()

for (let frame = 0; frame < 12; frame += 1) stepFlightInput(input, FRAME, envelope)
input.pressed.add('throttle-down')
for (let frame = 0; frame < 12; frame += 1) stepFlightInput(input, FRAME, envelope)
assert.equal(input.intent.airBrake, envelope.deceleration.airBrakeLevel,
  'held S must settle at the progressive arcade brake level')
input.pressed.add('pitch-up')
for (let frame = 0; frame < 12; frame += 1) stepFlightInput(input, FRAME, envelope)
assert.equal(input.intent.airBrake, 1, 'S plus a committed pull must command the full high-G brake')
input.pressed.clear()
for (let frame = 0; frame < 12; frame += 1) stepFlightInput(input, FRAME, envelope)
assert.equal(input.intent.pitch, 0, 'high-G pull must settle before the next device takes control')
assert.equal(input.intent.airBrake, 0, 'released S must retract the air brake')

setAnalogFlightInput(input, 'test-stick', { roll: 0.42, pitch: -0.25 })
for (let frame = 0; frame < 10; frame += 1) stepFlightInput(input, FRAME, envelope)
assert.equal(input.intent.roll, 0.42, 'analogue roll must retain its requested magnitude')
assert.equal(input.intent.pitch, -0.25, 'analogue pitch must retain its requested magnitude')
clearAnalogFlightInput(input, 'test-stick')

input.pressed.add('throttle-up')
for (let frame = 0; frame < 600; frame += 1) stepFlightInput(input, FRAME, envelope)
assert.equal(input.throttle, 1, 'throttle must clamp at full power')
input.pressed.delete('throttle-up')
input.pressed.add('throttle-down')
for (let frame = 0; frame < 600; frame += 1) stepFlightInput(input, FRAME, envelope)
assert.equal(input.throttle, envelope.minThrottle, 'throttle must clamp at the flight-idle stop')

input.pressed.clear()
input.pressed.add('throttle-up')
assert.equal(stepFlightInput(input, FRAME, envelope).accelerate, true,
  'W alone must publish engine acceleration intent for a PSM exit')

console.log('PASS input: smooth axes, progressive braking, maneuver assist, analogue intent, throttle limits')
