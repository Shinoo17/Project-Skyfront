/* Player-authored post-stall regression checks.

These scenarios exercise the deliberate PSM state machine rather than maneuver labels:

  - releasing Pitch Up holds the attitude without a recovery timer;
  - holding Pitch Up can carry one continuous rotation past 360 degrees;
  - a 180-degree reversal preserves old momentum and engine force reverses it over time;
  - Pitch Down is the only input that starts assisted recovery;
  - the reversal survives the spring-loaded power lever returning to trim.

The first four drive the model with hand-built command objects, which deliberately skips
the input layer. The last one goes through `stepFlightInput` instead, because the thing it
is guarding lives there.
*/

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
  assert.ok(releasedAt >= 85 && releasedAt <= 115,
    `Cobra: a 0.72s pull must leave a usable 90° stop window (travel ${releasedAt.toFixed(1)}°)`)
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

/*
Continuous flip: no AoA clamp at 90/120/180, and the whole rotation belongs to the player.

What has changed is only what happens once the rotation is complete. A held stick used to buy
laps without limit — `psmPitchTravelDeg` was zeroed only on entry, so past `flipEnterTravelDeg`
the pitch-up branch stayed satisfied forever and the recovery fall-through re-entered the flip
for free. One arm now carries one rotation: the 360 still finishes under the player's own
input, and then the arm hands over to assisted recovery rather than offering another lap.
*/
{
  const state = createEntry()
  let sawFlip = false
  let recoveredAt = null
  stepFor(state, 2.65, (t) => command({
    psmArm: t < 1.9,
    pitch: t >= 0.2 ? 1 : 0,
    throttle: 0.8,
  }), (t, sample) => {
    sawFlip ||= sample.psmPhase === 'post-stall-flip'
    if (recoveredAt === null && sample.psmPhase === 'recovery') recoveredAt = t
  })

  assert.ok(sawFlip, 'Flip: continuing Pitch Up must enter POST_STALL_FLIP')
  assert.ok(state.psmPitchTravelDeg > 360,
    `Flip: held input must pass one full rotation (travel ${state.psmPitchTravelDeg.toFixed(0)}°)`)
  assert.ok(recoveredAt !== null,
    'Flip: a completed rotation must hand over to assisted recovery')

  // The hand-over is not allowed to arrive early. Anything short of the full rotation is the
  // player being interrupted mid-manoeuvre, which is the failure this budget must not cause.
  const travelAtHandover = tuning.postStallAssist.flipMaxTravelDeg
  assert.ok(travelAtHandover >= 360,
    `Flip: the rotation budget must cover a whole lap (${travelAtHandover}°)`)

  // And a second lap is refused: holding the stick through recovery must not re-enter the
  // flip, which is the spam this exists to stop.
  let sawSecondFlip = false
  stepFor(state, 1.2, command({ pitch: 1, throttle: 0.8 }), (_t, sample) => {
    sawSecondFlip ||= sample.psmPhase === 'post-stall-flip'
  })
  assert.equal(sawSecondFlip, false,
    'Flip: one arm must not buy a second rotation')

  console.log(`FLIP phase=${state.psmPhase} travel=${state.psmPitchTravelDeg.toFixed(0)}°`
    + ` handover=${recoveredAt.toFixed(2)}s`
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

/*
The same reversal flown through the real input layer, with the pilot commanding a slow
speed rather than a fast one. If the reversal depended on the speed control being pushed
up, this is where that breaks. It does not: Shift drives the core through the MIL detent
on its own, which is what makes the manoeuvre a burner decision rather than a
speed-selector decision — and what lets the pilot enter it slow, as the manoeuvre requires.
*/
{
  const state = createEntry(480)
  const controls = createFlightInputState(480)
  let released = false
  let minVx = state.velocity.x
  let maxVxAfterRelease = -Infinity

  for (let t = 0; t < 6; t += FLIGHT_FIXED_STEP) {
    controls.pressed.clear()
    if (!released && state.psmPitchTravelDeg >= 168) released = true
    if (released) {
      controls.pressed.add('afterburner')
    } else {
      controls.pressed.add('maneuver-assist')
      controls.pressed.add('pitch-up')
    }

    const input = stepFlightInput(controls, FLIGHT_FIXED_STEP, envelope, state.position.y)
    stepFlight(state, {
      pitch: input.pitch,
      roll: input.roll,
      yaw: input.yaw,
      flaps: input.flaps,
      throttle: input.throttle,
      airBrake: input.airBrake,
      accelerate: input.accelerate,
      psmArm: input.psmArm,
      afterburnerCommanded: input.afterburner,
      burnerLevel: input.afterburner ? 1 : 0,
    }, envelope, FLIGHT_FIXED_STEP)

    if (released) {
      minVx = Math.min(minVx, state.velocity.x)
      maxVxAfterRelease = Math.max(maxVxAfterRelease, state.velocity.x)
    }
  }

  assert.ok(released, 'Speed command: the entry must still reach the reversal point')
  assert.equal(controls.commandSpeedKmh, 480,
    'Speed command: the manoeuvre must not need the speed control touched at all')
  assert.ok(controls.throttle < 1,
    'Speed command: a slow command must leave the lever well off full power')
  assert.ok(maxVxAfterRelease > 5, 'Speed command: old forward momentum must survive the turn')
  assert.ok(minVx < -2,
    `Speed command: reheat must reverse world velocity on its own (min ${minVx.toFixed(1)})`)

  console.log(`SPEED COMMAND cmd=${controls.commandSpeedKmh.toFixed(0)}kmh`
    + ` thr=${controls.throttle.toFixed(2)}`
    + ` range=${maxVxAfterRelease.toFixed(1)}..${minVx.toFixed(1)} speed=${state.speedKmh.toFixed(0)}kmh`)
}

console.log('PASS PSM control: hold, continuous flip, inertial reversal, player-owned recovery,'
  + ' reversal from a slow speed command')
