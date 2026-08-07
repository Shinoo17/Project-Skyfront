/*
Guards the propulsion contracts that are easy to break while tuning manoeuvres:

  - every authored dry throttle still trims at its named steady speed;
  - dry acceleration rises monotonically with throttle at one flight condition;
  - the engine keeps making thrust above trim speed while drag supplies the deceleration;
  - an A/B request spools the core through the ignition threshold instead of lighting at idle;
  - residual A/B thrust during spool-down continues to spend reserve and cannot cool yet.
*/

import assert from 'node:assert/strict'
import { Vector3 } from 'three'

import f22 from '../src/aircraft/f22.js'
import {
  FLIGHT_FIXED_STEP,
  createFlightState,
  resetFlightState,
  stepFlight,
} from '../src/features/flight/flightModel.js'
import {
  createAfterburnerState,
  readDragKmhPerSecond,
  readPropulsionKmhPerSecond,
  readTargetAirspeedKmh,
  readThrottlePower,
  stepAfterburner,
} from '../src/features/flight/performance.js'

const envelope = f22.flight.envelope
const altitude = 815
const throttles = [envelope.minThrottle, 0.18, envelope.idleThrottle, 0.7, 1]

for (const throttle of throttles) {
  const core = readThrottlePower(throttle, envelope)
  const speed = readTargetAirspeedKmh(throttle, altitude, 0, envelope)
  const net = readPropulsionKmhPerSecond(core, 0, envelope)
    - readDragKmhPerSecond(speed, altitude, envelope)
  assert.ok(Math.abs(net) < 1e-9, `dry trim drifted at throttle ${throttle}: ${net}`)
}

const testSpeed = 600
const dryNet = throttles.map((throttle) => {
  const core = readThrottlePower(throttle, envelope)
  return readPropulsionKmhPerSecond(core, 0, envelope)
    - readDragKmhPerSecond(testSpeed, altitude, envelope)
})
for (let index = 1; index < dryNet.length; index += 1) {
  assert.ok(dryNet[index] > dryNet[index - 1], 'dry acceleration must rise with throttle')
}

const fullDryThrust = readPropulsionKmhPerSecond(1, 0, envelope)
const aboveTrimNet = fullDryThrust - readDragKmhPerSecond(2350, altitude, envelope)
assert.ok(fullDryThrust > 0, 'the engine must keep producing thrust above dry trim speed')
assert.ok(aboveTrimNet < 0, 'drag must decelerate the aircraft above dry trim speed')

const flight = createFlightState()
resetFlightState(
  flight,
  new Vector3(0, altitude, 0),
  readTargetAirspeedKmh(envelope.minThrottle, altitude, 0, envelope),
  envelope,
  envelope.minThrottle,
)
const command = {
  pitch: 0,
  roll: 0,
  yaw: 0,
  flaps: 0,
  throttle: envelope.minThrottle,
  airBrake: false,
  highAoA: false,
  afterburnerCommanded: true,
  burnerLevel: 0,
}
let ignitionSeconds = 0
while (flight.engineCoreLevel < envelope.afterburner.ignitionCorePower && ignitionSeconds < 2) {
  stepFlight(flight, command, envelope, FLIGHT_FIXED_STEP)
  ignitionSeconds += FLIGHT_FIXED_STEP
}
assert.ok(ignitionSeconds > 0.25 && ignitionSeconds < 1, `unexpected core spool: ${ignitionSeconds}s`)

const burner = createAfterburnerState()
for (let index = 0; index < 30; index += 1) {
  stepAfterburner(burner, { commanded: true, step: 1 / 60 }, envelope)
}
const reserveAtRelease = burner.reserve
assert.ok(burner.level > 0, 'burner must have residual level before spool-down check')
stepAfterburner(burner, { commanded: false, step: 1 / 60 }, envelope)
assert.ok(burner.reserve < reserveAtRelease, 'spool-down thrust must continue spending reserve')
assert.equal(burner.cooling, 0, 'cooldown must not start while residual reheat remains')

console.log(
  `PASS propulsion: ${throttles.length} trims, monotonic dry thrust, `
  + `${ignitionSeconds.toFixed(2)}s idle-to-ignition, billed spool-down`,
)
