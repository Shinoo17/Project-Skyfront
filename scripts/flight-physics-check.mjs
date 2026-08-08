/*
Regression checks for the force relationship that makes a banked turn work:

  - aircraft attitude and velocity may disagree;
  - lift follows aircraft-up rather than world-up;
  - a bank with no pull loses vertical lift without pitching the nose down;
  - progressively more pull trades speed for turn rate and load factor.

These cases enter already trimmed and banked so they test the force model rather than the
keyboard ramp or the time needed to roll into the manoeuvre.
*/

import assert from 'node:assert/strict'
import { MathUtils, Quaternion, Vector3 } from 'three'

import f22 from '../src/aircraft/f22.js'
import {
  FLIGHT_FIXED_STEP,
  createFlightState,
  resetFlightState,
  stepFlight,
} from '../src/features/flight/flightModel.js'
import {
  readTargetAirspeedKmh,
} from '../src/features/flight/performance.js'

const envelope = f22.flight.envelope
const tuning = envelope.maneuvering
const altitude = 815
const throttle = 0.29
const speedKmh = readTargetAirspeedKmh(throttle, altitude, 0, envelope)
const speed = speedKmh / envelope.performance.kmhPerWorldUnitPerSecond
const bankDeg = 65
const bankRad = MathUtils.degToRad(bankDeg)
const qFactor = (speed / tuning.referenceSpeed) ** 2
const trimAlphaRad = MathUtils.degToRad(tuning.stallAoADeg)
  * tuning.gravity / (qFactor * tuning.liftGain)

const FORWARD = new Vector3(1, 0, 0)
const UP = new Vector3(0, 1, 0)
const PITCH_AXIS = new Vector3(0, 0, 1)
const pitchRotation = new Quaternion().setFromAxisAngle(PITCH_AXIS, trimAlphaRad)

const command = (pitch) => ({
  pitch,
  roll: 0,
  yaw: 0,
  flaps: 0,
  throttle,
  airBrake: 0,
  afterburnerCommanded: false,
  burnerLevel: 0,
})

function createBankedState(angleDeg = bankDeg) {
  const state = createFlightState()
  resetFlightState(state, new Vector3(0, altitude, 0), speedKmh, envelope, throttle)
  // Roll about the current flight path, then establish the trimmed incidence in the
  // banked lift plane. This starts coordinated (beta=0) with the same total lift as the
  // wings-level trim; only its world-space direction has changed.
  state.orientation
    .setFromAxisAngle(FORWARD, MathUtils.degToRad(angleDeg))
    .multiply(pitchRotation)
  state.velocity.set(speed, 0, 0)
  return state
}

function readAngles(state) {
  const nose = FORWARD.clone().applyQuaternion(state.orientation)
  const path = state.velocity.clone().normalize()
  return {
    nosePitchDeg: MathUtils.radToDeg(Math.asin(MathUtils.clamp(nose.y, -1, 1))),
    pathPitchDeg: MathUtils.radToDeg(Math.asin(MathUtils.clamp(path.y, -1, 1))),
    pathHeadingDeg: MathUtils.radToDeg(Math.atan2(path.z, path.x)),
  }
}

function fly(pitch, seconds = 2) {
  const state = createBankedState()
  let peakG = 0
  let peakAoA = 0
  for (let elapsed = 0; elapsed < seconds; elapsed += FLIGHT_FIXED_STEP) {
    stepFlight(state, command(pitch), envelope, FLIGHT_FIXED_STEP)
    peakG = Math.max(peakG, Math.abs(state.gLoad))
    peakAoA = Math.max(peakAoA, Math.abs(state.aoaDeg))
  }
  return {
    pitch,
    ...readAngles(state),
    altitudeDelta: state.position.y - altitude,
    speedLossKmh: speedKmh - state.speedKmh,
    peakG,
    peakAoA,
    pitchRateDeg: MathUtils.radToDeg(state.angularVelocity.z),
  }
}

const forceProbe = createBankedState()
stepFlight(forceProbe, command(0), envelope, FLIGHT_FIXED_STEP)
const aircraftUp = UP.clone().applyQuaternion(forceProbe.orientation)
const liftDirection = forceProbe.liftForce.clone().normalize()
const liftVerticalFraction = forceProbe.liftForce.y / forceProbe.liftForce.length()

assert.ok(
  liftDirection.dot(aircraftUp) > 0.995,
  'lift must follow aircraft-up after projection off the relative wind',
)
assert.ok(
  Math.abs(liftVerticalFraction - Math.cos(bankRad)) < 0.015,
  'a coordinated bank must lose vertical lift by the natural cosine projection',
)
assert.ok(
  Math.abs(forceProbe.gLoad - 1) < 0.03,
  'banking must tilt trimmed lift rather than silently deleting its magnitude',
)

const knifeEdgeProbe = createBankedState(89)
stepFlight(knifeEdgeProbe, command(0), envelope, FLIGHT_FIXED_STEP)
const knifeEdgeVertical = Math.abs(
  knifeEdgeProbe.liftForce.y / knifeEdgeProbe.liftForce.length(),
)
assert.ok(knifeEdgeVertical < 0.035, 'a near-90-degree bank must have almost no vertical lift')

// Explicitly prove attitude and path are independent: the nose can remain up while the
// aircraft is already descending, and AoA is the measured angle between those states.
const divergenceProbe = createFlightState()
resetFlightState(divergenceProbe, new Vector3(0, altitude, 0), speedKmh, envelope, throttle)
divergenceProbe.orientation.setFromAxisAngle(PITCH_AXIS, MathUtils.degToRad(8))
divergenceProbe.velocity.set(
  Math.cos(MathUtils.degToRad(3)) * speed,
  -Math.sin(MathUtils.degToRad(3)) * speed,
  0,
)
stepFlight(divergenceProbe, command(0), envelope, 1e-4)
const divergenceAngles = readAngles(divergenceProbe)
assert.ok(divergenceAngles.nosePitchDeg > 7.9, 'velocity must not pull nose attitude down')
assert.ok(divergenceAngles.pathPitchDeg < -2.9, 'nose attitude must not snap the flight path up')
assert.ok(
  divergenceProbe.aoaDeg > 10.5 && divergenceProbe.aoaDeg < 11.5,
  'AoA must come from nose attitude minus flight-path angle',
)

const earlyNoPull = fly(0, 0.75)
const noPull = fly(0)
const lightPull = fly(0.2)
const levelPull = fly(0.45)
const hardPull = fly(0.8)

assert.ok(earlyNoPull.nosePitchDeg > 0, 'bank alone must not issue a direct nose-down pitch command')
assert.ok(earlyNoPull.pathPitchDeg < -4, 'bank alone must let gravity lower the flight path')
assert.ok(earlyNoPull.altitudeDelta < -0.5, 'bank alone must lose altitude')
assert.ok(Math.abs(earlyNoPull.pitchRateDeg) < 1e-8, 'hands-off FCC must command zero pitch rate')

assert.ok(noPull.altitudeDelta < -7, 'sustained bank with no pull must descend clearly')
assert.ok(lightPull.altitudeDelta > noPull.altitudeDelta + 2, 'light pull must reduce the descent')
assert.ok(lightPull.pathHeadingDeg > noPull.pathHeadingDeg + 10, 'pull must create the turn')
assert.ok(lightPull.peakG > noPull.peakG, 'pull must increase load factor')

assert.ok(Math.abs(levelPull.pathPitchDeg) < 2, 'the calibrated pull must produce a level turn')
assert.ok(Math.abs(levelPull.altitudeDelta) < 3, 'the level turn must approximately hold altitude')
assert.ok(levelPull.pathHeadingDeg > 40, 'the level pull must bend the velocity sideways')

assert.ok(hardPull.peakAoA > levelPull.peakAoA + 2, 'harder pull must produce more AoA')
assert.ok(hardPull.peakG > levelPull.peakG + 0.7, 'harder pull must produce more G')
assert.ok(
  hardPull.pathHeadingDeg > levelPull.pathHeadingDeg + 20,
  'harder pull must increase turn rate',
)
assert.ok(hardPull.speedLossKmh > 20, 'hard pull must pay a clear induced-drag energy cost')

console.log(
  `bank=${bankDeg}° trimAoA=${MathUtils.radToDeg(trimAlphaRad).toFixed(2)}°`
  + ` lift·up=${liftDirection.dot(aircraftUp).toFixed(4)}`
  + ` vertical=${liftVerticalFraction.toFixed(3)}`
  + ` cos(bank)=${Math.cos(bankRad).toFixed(3)}`
  + ` knife-edge=${knifeEdgeVertical.toFixed(3)}`,
)

for (const [label, result] of [
  ['BANK ONLY', noPull],
  ['LIGHT PULL', lightPull],
  ['LEVEL TURN', levelPull],
  ['HARD TURN', hardPull],
]) {
  console.log(
    `${label.padEnd(10)} pull=${result.pitch.toFixed(2)}`
    + ` nose=${result.nosePitchDeg.toFixed(1)}°`
    + ` path=${result.pathPitchDeg.toFixed(1)}°`
    + ` heading=${result.pathHeadingDeg.toFixed(1)}°`
    + ` dy=${result.altitudeDelta.toFixed(1)}`
    + ` g=${result.peakG.toFixed(2)}`
    + ` aoa=${result.peakAoA.toFixed(1)}°`
    + ` dV=${result.speedLossKmh.toFixed(0)}kmh`,
  )
}

console.log('PASS flight physics: banked lift, independent flight path, pull/G/energy trade')
