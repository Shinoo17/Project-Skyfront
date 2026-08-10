import assert from 'node:assert/strict'

import f22 from '../src/aircraft/f22.js'
import {
  FLIGHT_BINDINGS,
  clearAnalogFlightInput,
  createFlightInputState,
  readCommandSpeedLimits,
  readMouseFlightAxes,
  setAnalogFlightInput,
  setCommandSpeedKmh,
  stepFlightInput,
} from '../src/features/flight/flightInput.js'
import {
  readTargetAirspeedKmh,
  readThrottleForAirspeedKmh,
} from '../src/features/flight/performance.js'

const FRAME = 1 / 60
const envelope = f22.flight.envelope
// The band the range flies in. Everything below is checked at one altitude, because the
// speed-to-power map is altitude-dependent by design.
const ALTITUDE = 815
const CRUISE_KMH = readTargetAirspeedKmh(envelope.idleThrottle, ALTITUDE, 0, envelope)
const limits = readCommandSpeedLimits(envelope)
const input = createFlightInputState(CRUISE_KMH)
const step = () => stepFlightInput(input, FRAME, envelope, ALTITUDE)

// The whole arcade control rests on this round trip: the pilot names a speed, the model is
// handed the power that holds it, and nothing is lost in between.
assert.ok(
  Math.abs(readThrottleForAirspeedKmh(CRUISE_KMH, ALTITUDE, envelope) - envelope.idleThrottle) < 1e-9,
  'speed and power must be exact inverses, or a seeded sortie drifts off its own trim',
)

// The two intents are two keys, and which key is which is the whole control scheme.
assert.equal(FLIGHT_BINDINGS.Space, 'high-g',
  'Space must be the max-performance turn, not a post-stall request')
assert.equal(FLIGHT_BINDINGS.AltLeft, 'maneuver-assist',
  'Left Alt must be the deliberate post-stall control modifier')

input.pressed.add('pitch-up')
const firstPitch = step().pitch
assert.ok(firstPitch > 0 && firstPitch < 0.2, 'keyboard pitch must ramp instead of snapping')

for (let frame = 0; frame < 20; frame += 1) step()
assert.equal(input.intent.pitch, 1, 'held keyboard pitch must still reach full authority')

input.pressed.clear()

const commandBeforePsm = input.commandSpeedKmh
input.pressed.add('maneuver-assist')
const psmIntent = step()
assert.equal(psmIntent.psmArm, true, 'Maneuver Assist must arm PSM')
assert.equal(psmIntent.highG, false, 'Maneuver Assist must not also request a high-G turn')
assert.equal(psmIntent.airBrake, 0, 'Maneuver Assist must not spend energy through the brake')
assert.equal(input.commandSpeedKmh, commandBeforePsm,
  'Maneuver Assist must not move the commanded speed')
input.pressed.clear()

// Space is the other intent entirely: a turn command that arms nothing.
const commandBeforeHighG = input.commandSpeedKmh
input.pressed.add('high-g')
const highGIntent = step()
assert.equal(highGIntent.highG, true, 'Space must publish high-G turn intent')
assert.equal(highGIntent.psmArm, false, 'Space must never arm PSM')
assert.equal(highGIntent.airBrake, 0, 'Space must not open the air brake')
assert.equal(input.commandSpeedKmh, commandBeforeHighG,
  'Space must not move the commanded speed')
input.pressed.clear()
const firstRelease = step().pitch
assert.ok(firstRelease > 0 && firstRelease < 1, 'released pitch must return continuously')
for (let frame = 0; frame < 12; frame += 1) step()
assert.equal(input.intent.pitch, 0, 'released pitch must recentre')

input.pressed.add('roll-left')
input.pressed.add('roll-right')
for (let frame = 0; frame < 10; frame += 1) step()
assert.equal(input.intent.roll, 0, 'opposing digital controls must cancel')
input.pressed.clear()

/*
W+S is the alternative high-G chord, so it has to behave exactly like Space rather than
like two speed commands arguing: the same turn intent, no PSM, no brake, and a commanded
speed that simply holds where the pilot left it.
*/
const commandBeforeOpposing = input.commandSpeedKmh
input.pressed.add('throttle-up')
input.pressed.add('throttle-down')
const chord = step()
assert.equal(chord.highG, true, 'W+S must request the same high-G turn Space does')
assert.equal(chord.psmArm, false, 'W+S must never arm PSM')
assert.equal(chord.accelerate, false, 'W+S must not also read as an accelerate command')
assert.equal(chord.decelerate, false, 'W+S must not also read as a decelerate command')
assert.equal(input.commandSpeedKmh, commandBeforeOpposing,
  'opposing speed commands must cancel')
assert.equal(chord.airBrake, 0,
  'the high-G chord must pay in induced drag, not through the air brake')

// Leaving the chord by letting go of W is the transition a player actually flies: the turn
// command ends and the key still held goes back to being an ordinary slow-down.
input.pressed.delete('throttle-up')
for (let frame = 0; frame < 12; frame += 1) step()
assert.equal(input.intent.highG, false, 'releasing W must end the high-G chord')
assert.equal(input.intent.decelerate, true, 'the S still held must resume slowing down')
assert.equal(input.intent.airBrake, envelope.deceleration.airBrakeLevel,
  'the air brake must re-open once the chord is broken')
input.pressed.clear()
for (let frame = 0; frame < 12; frame += 1) step()

for (let frame = 0; frame < 12; frame += 1) step()
input.pressed.add('throttle-down')
for (let frame = 0; frame < 12; frame += 1) step()
assert.equal(input.intent.decelerate, true, 'S alone must publish decelerate intent')
assert.equal(input.intent.highG, false, 'S alone must not request a high-G turn')
assert.equal(input.intent.airBrake, envelope.deceleration.airBrakeLevel,
  'held S must settle at the progressive arcade brake level')
input.pressed.add('pitch-up')
for (let frame = 0; frame < 12; frame += 1) step()
assert.equal(input.intent.airBrake, 1, 'S plus a committed pull must command the full high-G brake')
input.pressed.clear()
for (let frame = 0; frame < 12; frame += 1) step()
assert.equal(input.intent.pitch, 0, 'high-G pull must settle before the next device takes control')
assert.equal(input.intent.airBrake, 0, 'released S must retract the air brake')

setAnalogFlightInput(input, 'test-stick', { roll: 0.42, pitch: -0.25 })
for (let frame = 0; frame < 10; frame += 1) step()
assert.equal(input.intent.roll, 0.42, 'analogue roll must retain its requested magnitude')
assert.equal(input.intent.pitch, -0.25, 'analogue pitch must retain its requested magnitude')
clearAnalogFlightInput(input, 'test-stick')

// The canvas mouse is another analogue stick, not a private rotation path. Its centre is
// quiet, the axes have the same signs as the keyboard, and the authored curve preserves
// fine control before reaching full authority near the edge.
{
  const bounds = { left: 100, top: 50, width: 1000, height: 800 }
  assert.deepEqual(
    readMouseFlightAxes(600, 450, bounds),
    { pitch: 0, roll: 0, yaw: 0 },
    'mouse at canvas centre must be a neutral stick',
  )
  assert.deepEqual(
    readMouseFlightAxes(600, 50, bounds),
    { pitch: 1, roll: 0, yaw: 0 },
    'mouse up must command full positive pitch without yaw',
  )
  assert.deepEqual(
    readMouseFlightAxes(600, 50, bounds, { invertPitch: true }),
    { pitch: -1, roll: 0, yaw: 0 },
    'inverted mouse pitch must reverse pitch without changing roll or yaw',
  )
  assert.deepEqual(
    readMouseFlightAxes(1100, 450, bounds),
    { pitch: 0, roll: 1, yaw: 0 },
    'mouse right must command full positive roll without yaw',
  )
  assert.equal(
    readMouseFlightAxes(625, 450, bounds).roll,
    0,
    'mouse stick must have a quiet dead zone around the centre',
  )
  const fine = readMouseFlightAxes(750, 350, bounds)
  assert.ok(fine.pitch > 0 && fine.pitch < 0.5, 'mouse pitch curve must retain fine control')
  assert.ok(fine.roll > 0 && fine.roll < 0.5, 'mouse roll curve must retain fine control')
  setAnalogFlightInput(input, 'mouse-stick', fine)
  for (let frame = 0; frame < 12; frame += 1) step()
  assert.equal(input.intent.pitch, fine.pitch, 'mouse pitch must reach the shared flight intent')
  assert.equal(input.intent.roll, fine.roll, 'mouse roll must reach the shared flight intent')
  clearAnalogFlightInput(input, 'mouse-stick')
  for (let frame = 0; frame < 12; frame += 1) step()
}

/*
W and S name a speed. The three things that matter about that: the command holds where it
was left, it moves at a rate a player can aim with, and it stops at the ends of the band.
*/
setCommandSpeedKmh(input, CRUISE_KMH, envelope)
input.pressed.add('throttle-up')
step()
assert.ok(input.commandSpeedKmh > CRUISE_KMH, 'W must raise the commanded speed')
assert.ok(
  Math.abs((input.commandSpeedKmh - CRUISE_KMH) - (FRAME * envelope.commandKmhPerSecond)) < 1e-9,
  'the command must walk at exactly the authored rate, so a tap is a predictable amount',
)

input.pressed.clear()
const held = input.commandSpeedKmh
for (let frame = 0; frame < 600; frame += 1) step()
assert.equal(input.commandSpeedKmh, held,
  'a released speed command must hold — this is a selector, not a spring')

input.pressed.add('throttle-up')
for (let frame = 0; frame < 600; frame += 1) step()
assert.equal(input.commandSpeedKmh, limits.max, 'the command must stop at the top of the band')
assert.equal(input.throttle, 1, 'a command at or above the local ceiling must ask for full power')
input.pressed.delete('throttle-up')
input.pressed.add('throttle-down')
for (let frame = 0; frame < 600; frame += 1) step()
assert.equal(input.commandSpeedKmh, limits.min, 'the command must stop at the bottom of the band')
assert.equal(input.throttle, envelope.minThrottle,
  'the slowest command must ask for the flight-idle stop')

// Altitude changes what a speed costs, not what the pilot asked for. Same command, thinner
// air, less power — and the number on the HUD never moves by itself.
input.pressed.clear()
setCommandSpeedKmh(input, 900, envelope)
const lowPower = stepFlightInput(input, FRAME, envelope, 0).throttle
const highPower = stepFlightInput(input, FRAME, envelope, ALTITUDE).throttle
assert.equal(input.commandSpeedKmh, 900, 'altitude must never move the commanded speed')
assert.ok(highPower < lowPower,
  'the same speed must cost less power where the dry ceiling is higher')

setCommandSpeedKmh(input, CRUISE_KMH, envelope)
input.pressed.add('throttle-up')
const accelerating = step()
assert.equal(accelerating.accelerate, true,
  'W alone must publish engine acceleration intent for a PSM exit')
assert.equal(accelerating.decelerate, false, 'W alone must not read as a decelerate command')
assert.equal(accelerating.highG, false, 'W alone must not request a high-G turn')

console.log('PASS input: smooth axes, progressive braking, high-G on Space and W+S,'
  + ' post-stall on Left Alt, analogue intent, speed command that holds, bounded band,'
  + ' altitude-aware power')
