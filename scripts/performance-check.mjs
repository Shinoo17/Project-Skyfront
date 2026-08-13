/* Arcade engine and energy-management acceptance checks. */

import assert from 'node:assert/strict'
import { MathUtils, Vector3 } from 'three'

import f22 from '../src/aircraft/f22.js'
import {
  createFlightInputState,
  stepFlightInput,
} from '../src/features/flight/flightInput.js'
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
  readThrottleForAirspeedKmh,
  readThrottlePower,
  stepAfterburner,
} from '../src/features/flight/performance.js'

const envelope = f22.flight.envelope
const tuning = envelope.maneuvering
const altitude = 815
const toWorld = 1 / envelope.performance.kmhPerWorldUnitPerSecond
const PITCH_AXIS = new Vector3(0, 0, 1)

function trimAlphaRad(speedKmh) {
  const q = ((speedKmh * toWorld) / tuning.referenceSpeed) ** 2
  return (MathUtils.degToRad(tuning.stallAoADeg) * tuning.gravity) / (q * tuning.liftGain)
}

function createRun(startKmh, initialPower = null, pathAngleDeg = 0) {
  const rawTrim = readThrottleForAirspeedKmh(startKmh, altitude, envelope)
  const power = initialPower ?? readThrottlePower(rawTrim, envelope)
  const rawThrottle = envelope.minThrottle + (power * (1 - envelope.minThrottle))
  const controls = createFlightInputState(power)
  const state = createFlightState()
  const reheat = createAfterburnerState()
  resetFlightState(state, new Vector3(0, altitude, 0), startKmh, envelope, rawThrottle)
  const pathAngle = MathUtils.degToRad(pathAngleDeg)
  state.orientation.setFromAxisAngle(PITCH_AXIS, pathAngle + trimAlphaRad(startKmh))
  state.velocity.set(
    Math.cos(pathAngle) * startKmh * toWorld,
    Math.sin(pathAngle) * startKmh * toWorld,
    0,
  )
  return { controls, state, reheat }
}

function stepRun(run, held = []) {
  const { controls, state, reheat } = run
  controls.pressed.clear()
  for (const action of held) controls.pressed.add(action)
  const input = stepFlightInput(
    controls,
    FLIGHT_FIXED_STEP,
    envelope,
    state.position.y,
    { speedKmh: state.speedKmh },
  )
  const burner = stepAfterburner(reheat, {
    commanded: input.afterburner
      && state.engineThrottle >= envelope.afterburner.ignitionCorePower,
    step: FLIGHT_FIXED_STEP,
  }, envelope)
  stepFlight(state, {
    ...input,
    afterburnerCommanded: input.afterburner,
    burnerLevel: burner.level,
  }, envelope, FLIGHT_FIXED_STEP)
  return { input, burner }
}

function fly(run, seconds, held) {
  let minimum = run.state.speedKmh
  let maximum = run.state.speedKmh
  for (let time = 0; time < seconds; time += FLIGHT_FIXED_STEP) {
    const actions = typeof held === 'function' ? held(time, run) : held
    stepRun(run, actions)
    minimum = Math.min(minimum, run.state.speedKmh)
    maximum = Math.max(maximum, run.state.speedKmh)
  }
  return { ...run, minimum, maximum }
}

// The underlying trim curve remains force based: thrust and parasite drag meet only at the
// authored equilibrium, and both continue to exist on either side of it.
for (const throttle of [envelope.minThrottle, envelope.idleThrottle, 0.7, 1]) {
  const speed = readTargetAirspeedKmh(throttle, altitude, 0, envelope)
  const trimThrottle = readThrottleForAirspeedKmh(speed, altitude, envelope)
  const net = readPropulsionKmhPerSecond(readThrottlePower(trimThrottle, envelope), 0, envelope)
    - readDragKmhPerSecond(speed, altitude, envelope)
  assert.ok(Math.abs(net) < 1e-6, `dry trim must be a thrust/drag equilibrium (${net})`)
}

const neutral = fly(createRun(800), 2.5, [])
assert.ok(Math.abs(neutral.state.speedKmh - 800) < 20,
  `neutral assist should approximately trim level flight (${neutral.state.speedKmh.toFixed(1)})`)

const w = fly(createRun(700), 2, ['throttle-up'])
const s = fly(createRun(900), 2, ['throttle-down'])
const brake = fly(createRun(900), 2, ['air-brake'])
const wBrake = fly(createRun(900), 2, ['throttle-up', 'air-brake'])
const sBrake = fly(createRun(900), 2, ['throttle-down', 'air-brake'])
assert.ok(w.state.speedKmh > 800,
  `W must accelerate naturally toward dry equilibrium (${w.state.speedKmh.toFixed(1)})`)
assert.ok(s.state.speedKmh < 800,
  `S must slow through reduced thrust and drag (${s.state.speedKmh.toFixed(1)})`)
assert.ok(brake.state.speedKmh < s.state.speedKmh - 80,
  `Space must brake materially harder than idle alone (${brake.state.speedKmh.toFixed(1)})`)
assert.ok(wBrake.state.commandedThrottle > 0.99 && wBrake.state.airbrakeAmount > 0.99,
  'W+Space must coexist as MIL power plus a deployed board')
assert.ok(sBrake.state.commandedThrottle < 0.01 && sBrake.state.airbrakeAmount > 0.99,
  'S+Space must coexist as idle power plus a deployed board')
assert.ok(sBrake.state.speedKmh < brake.state.speedKmh,
  'idle plus airbrake must be the strongest practical straight-line deceleration')

// Idle-to-MIL dry spool is deliberately close to one second and never instantaneous.
const spoolUp = createRun(500, 0)
let upSeconds = 0
while (spoolUp.state.engineThrottle < 0.999 && upSeconds < 2) {
  stepRun(spoolUp, ['throttle-up'])
  upSeconds += FLIGHT_FIXED_STEP
}
assert.ok(upSeconds >= 0.8 && upSeconds <= 1.2,
  `idle-to-MIL spool must take about one second (${upSeconds.toFixed(2)}s)`)
const throttleAtFirstFrame = createRun(500, 0)
stepRun(throttleAtFirstFrame, ['throttle-up'])
assert.ok(throttleAtFirstFrame.state.engineThrottle < 0.02,
  'a W press must not instantly set actual engine power')

// At MIL, Shift lights and reaches full augmented thrust in the authored short delay.
const afterburner = createRun(900, 1)
let burnerFullAt = null
for (let time = 0; time < 1; time += FLIGHT_FIXED_STEP) {
  const { burner } = stepRun(afterburner, ['afterburner'])
  if (burnerFullAt === null && burner.level >= 0.999) burnerFullAt = time + FLIGHT_FIXED_STEP
}
assert.ok(burnerFullAt >= 0.3 && burnerFullAt <= 0.5,
  `MIL-to-afterburner response must be perceptible and short (${burnerFullAt?.toFixed(2)}s)`)
assert.equal(afterburner.state.afterburnerActive, true, 'actual afterburner state must be exposed')
const dryMil = fly(createRun(900, 1), 1, ['throttle-up'])
assert.ok(afterburner.state.speedKmh > dryMil.state.speedKmh + 50,
  'afterburner must add force beyond MIL power')
let burnerDownSeconds = 0
while (afterburner.reheat.level > 0 && burnerDownSeconds < 1) {
  stepRun(afterburner, [])
  burnerDownSeconds += FLIGHT_FIXED_STEP
}
assert.ok(burnerDownSeconds >= 0.2 && burnerDownSeconds <= 0.4,
  `afterburner-to-MIL spool-down must be short (${burnerDownSeconds.toFixed(2)}s)`)

// A hard aerodynamic turn spends energy even with W/MIL held; adding the board compounds it.
const highG = fly(createRun(900, 1), 3, ['throttle-up', 'pitch-up', 'high-g'])
const highGBrake = fly(
  createRun(900, 1),
  3,
  ['throttle-up', 'pitch-up', 'high-g', 'air-brake'],
)
assert.ok(highG.state.speedKmh < 820,
  `High-G must bleed substantial speed at MIL (${highG.state.speedKmh.toFixed(1)})`)
assert.ok(highG.state.inducedDrag > 0, 'High-G telemetry must expose induced drag')
assert.ok(highGBrake.state.speedKmh < highG.state.speedKmh - 70,
  `High-G+Space must cost substantially more (${highGBrake.state.speedKmh.toFixed(1)})`)

// Gravity is left in the force integration: equal climb/dive entries are allowed to diverge.
const climb = fly(createRun(850, null, 25), 1.5, [])
const dive = fly(createRun(850, null, -25), 1.5, [])
assert.ok(climb.state.speedKmh < 850,
  `a climb must be allowed to lose speed (${climb.state.speedKmh.toFixed(1)})`)
assert.ok(dive.state.speedKmh > 850,
  `a dive must be allowed to gain speed without W (${dive.state.speedKmh.toFixed(1)})`)

const debug = highGBrake.state
assert.ok(Math.abs(debug.totalDrag
  - (debug.parasiteDrag + debug.inducedDrag + debug.airbrakeDrag)) < 1e-9,
'debug drag components must sum exactly to total drag')
for (const field of [
  'speedKmh', 'acceleration', 'commandedThrottle', 'engineThrottle', 'thrust',
  'parasiteDrag', 'inducedDrag', 'airbrakeDrag', 'totalDrag', 'airbrakeAmount',
]) {
  assert.ok(Number.isFinite(debug[field]), `debug state must expose finite ${field}`)
}

console.log(`PASS engine/energy: neutral ${neutral.state.speedKmh.toFixed(0)}, W ${w.state.speedKmh.toFixed(0)},`
  + ` S ${s.state.speedKmh.toFixed(0)}, brake ${brake.state.speedKmh.toFixed(0)},`
  + ` high-G ${highG.state.speedKmh.toFixed(0)}, high-G+brake ${highGBrake.state.speedKmh.toFixed(0)} km/h;`
  + ` spool ${upSeconds.toFixed(2)}s, A/B ${burnerFullAt.toFixed(2)}/${burnerDownSeconds.toFixed(2)}s`)
