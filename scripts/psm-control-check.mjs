/* Player-authored post-stall regression checks.

These scenarios exercise the deliberate PSM state machine rather than maneuver labels:

  - releasing Pitch Up holds the attitude without a recovery timer;
  - holding Pitch Up can carry one continuous rotation past 360 degrees;
  - a 180-degree reversal preserves old momentum and engine force reverses it over time;
  - Pitch Down is the only input that starts assisted recovery.
*/

import assert from 'node:assert/strict'
import { MathUtils, Vector3 } from 'three'

import f22 from '../src/aircraft/f22.js'
import {
  FLIGHT_FIXED_STEP,
  createFlightState,
  resetFlightState,
  stepFlight,
} from '../src/features/flight/flightModel.js'

const envelope = f22.flight.envelope
const tuning = envelope.maneuvering
const toWorld = 1 / envelope.performance.kmhPerWorldUnitPerSecond
const PITCH_AXIS = new Vector3(0, 0, 1)

const command = (over = {}) => ({
  pitch: 0,
  roll: 0,
  yaw: 0,
  flaps: 0,
  throttle: 0.5,
  airBrake: 0,
  accelerate: false,
  psmArm: false,
  afterburnerCommanded: false,
  burnerLevel: 0,
  ...over,
})

function trimAlphaRad(speedKmh) {
  const speed = speedKmh * toWorld
  const qFactor = (speed / tuning.referenceSpeed) ** 2
  return MathUtils.degToRad(tuning.stallAoADeg) * tuning.gravity / (qFactor * tuning.liftGain)
}

function createEntry(speedKmh = 520) {
  const state = createFlightState()
  resetFlightState(state, new Vector3(0, 815, 0), speedKmh, envelope, 0.5)
  state.orientation.setFromAxisAngle(PITCH_AXIS, trimAlphaRad(speedKmh))
  state.velocity.set(speedKmh * toWorld, 0, 0)
  return state
}

function stepFor(state, seconds, input, sample) {
  for (let t = 0; t < seconds; t += FLIGHT_FIXED_STEP) {
    const resolved = typeof input === 'function' ? input(t, state) : input
    stepFlight(state, resolved, envelope, FLIGHT_FIXED_STEP)
    sample?.(t, state)
  }
}

// Cobra hold: the assist budget may fade, but the state and attitude remain player-owned.
{
  const state = createEntry()
  stepFor(state, 0.2, command({ psmArm: true }))
  stepFor(state, 0.72, command({ psmArm: true, pitch: 1 }))
  const releasedAt = state.psmPitchTravelDeg
  let sawRecovery = false
  let sawHold = false
  stepFor(state, 3.1, command(), (_t, sample) => {
    sawRecovery ||= sample.psmPhase === 'recovery'
    sawHold ||= sample.psmPhase === 'cobra-hold'
  })
  const holdDrift = Math.abs(state.psmPitchTravelDeg - releasedAt)

  assert.ok(sawHold, 'Cobra: releasing near the beam must enter COBRA_HOLD')
  assert.equal(sawRecovery, false, 'Cobra: elapsed time must never request recovery')
  assert.ok(holdDrift < 35, `Cobra: angular damping must hold attitude (drift ${holdDrift.toFixed(1)}°)`)
  assert.ok(Math.abs(MathUtils.radToDeg(state.angularVelocity.z)) < 8,
    'Cobra: released pitch rate must settle smoothly near zero')
  assert.ok(state.psmFloatBlend < 0.5,
    'Cobra: float support must decay without ending the maneuver')

  console.log(`HOLD phase=${state.psmPhase} travel=${state.psmPitchTravelDeg.toFixed(0)}°`
    + ` drift=${holdDrift.toFixed(1)}° rate=${MathUtils.radToDeg(state.angularVelocity.z).toFixed(1)}°/s`
    + ` float=${state.psmFloatBlend.toFixed(2)} sink=${state.velocity.y.toFixed(1)}`)
}

// Continuous flip: no AoA clamp at 90/120/180 and no completion-triggered recovery.
{
  const state = createEntry()
  let sawFlip = false
  let sawRecovery = false
  stepFor(state, 2.65, (t) => command({
    psmArm: t < 1.9,
    pitch: t >= 0.2 ? 1 : 0,
    throttle: 0.8,
  }), (_t, sample) => {
    sawFlip ||= sample.psmPhase === 'post-stall-flip'
    sawRecovery ||= sample.psmPhase === 'recovery'
  })

  assert.ok(sawFlip, 'Flip: continuing Pitch Up must enter POST_STALL_FLIP')
  assert.ok(state.psmPitchTravelDeg > 360,
    `Flip: held input must pass one full rotation (travel ${state.psmPitchTravelDeg.toFixed(0)}°)`)
  assert.equal(sawRecovery, false, 'Flip: completing 360 degrees must not auto-recover')

  stepFor(state, 0.8, command({ throttle: 0.8 }))
  assert.notEqual(state.psmPhase, 'recovery', 'Flip: releasing after 360 must stabilize, not recover')

  console.log(`FLIP phase=${state.psmPhase} travel=${state.psmPitchTravelDeg.toFixed(0)}°`
    + ` rate=${MathUtils.radToDeg(state.angularVelocity.z).toFixed(1)}°/s speed=${state.speedKmh.toFixed(0)}kmh`)
}

// Reversal: stop near 180, then let nose thrust cancel and reverse the old +X momentum.
{
  const state = createEntry(480)
  let released = false
  let sawReversal = false
  let previousVx = state.velocity.x
  let maxStepVx = 0
  let minVx = state.velocity.x
  let maxVxAfterRelease = -Infinity

  stepFor(state, 6, (_t, sample) => {
    if (!released && sample.psmPitchTravelDeg >= 168) released = true
    if (!released) return command({ psmArm: true, pitch: 1, throttle: 0.65 })
    return command({
      accelerate: true,
      throttle: 1,
      afterburnerCommanded: true,
      burnerLevel: 1,
    })
  }, (_t, sample) => {
    sawReversal ||= sample.psmPhase === 'post-stall-reversal'
    maxStepVx = Math.max(maxStepVx, Math.abs(sample.velocity.x - previousVx))
    previousVx = sample.velocity.x
    if (released) {
      minVx = Math.min(minVx, sample.velocity.x)
      maxVxAfterRelease = Math.max(maxVxAfterRelease, sample.velocity.x)
    }
  })

  assert.ok(released && sawReversal, 'Reversal: releasing near 180 must enter POST_STALL_REVERSAL')
  assert.ok(maxVxAfterRelease > 5, 'Reversal: old forward momentum must survive after the nose turns')
  assert.ok(minVx < -2, 'Reversal: afterburner thrust must eventually reverse world velocity')
  assert.ok(maxStepVx < 0.25,
    `Reversal: velocity direction must integrate continuously (largest step ${maxStepVx.toFixed(3)})`)

  console.log(`REVERSAL phase=${state.psmPhase} vx=${state.velocity.x.toFixed(1)}`
    + ` range=${maxVxAfterRelease.toFixed(1)}..${minVx.toFixed(1)}`
    + ` step=${maxStepVx.toFixed(3)} speed=${state.speedKmh.toFixed(0)}kmh`)
}

// Recovery is an explicit input and can be interrupted by releasing it.
{
  const state = createEntry()
  stepFor(state, 0.2, command({ psmArm: true }))
  stepFor(state, 0.72, command({ psmArm: true, pitch: 1 }))
  stepFor(state, 0.3, command())
  assert.equal(state.psmPhase, 'cobra-hold', 'Recovery: test must begin from a held Cobra')

  stepFor(state, 0.12, command({ pitch: -1 }))
  assert.equal(state.psmPhase, 'recovery', 'Recovery: Pitch Down must request PSM_RECOVERY')
  stepFor(state, 0.12, command())
  assert.notEqual(state.psmPhase, 'recovery', 'Recovery: releasing early must stop hidden alignment')

  console.log(`RECOVERY interrupt=${state.psmPhase} aoa=${state.aoaDeg.toFixed(1)}°`)
}

console.log('PASS PSM control: hold, continuous flip, inertial reversal, player-owned recovery')
