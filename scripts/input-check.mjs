import assert from 'node:assert/strict'

import f22 from '../src/aircraft/f22.js'
import {
  clearAnalogFlightInput,
  createFlightInputState,
  setAnalogFlightInput,
  stepFlightInput,
} from '../src/features/flight/flightInput.js'

const FRAME = 1 / 60
const envelope = f22.flight.envelope
const input = createFlightInputState(envelope.idleThrottle)

input.pressed.add('pitch-up')
const firstPitch = stepFlightInput(input, FRAME, envelope).pitch
assert.ok(firstPitch > 0 && firstPitch < 0.2, 'keyboard pitch must ramp instead of snapping')

for (let frame = 0; frame < 20; frame += 1) stepFlightInput(input, FRAME, envelope)
assert.equal(input.intent.pitch, 1, 'held keyboard pitch must still reach full authority')

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

console.log('PASS input: smooth digital axes, analogue intent, cancellation, throttle limits')
