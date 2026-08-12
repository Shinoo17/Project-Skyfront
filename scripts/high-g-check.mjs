/* High-G turn regression checks.

The scheme this guards is two buttons that must never become one:

  Space / W+S   a max-performance aerodynamic turn — more rate, more G, more drag
  Left Alt      consent to post-stall control

So the cases below are all comparisons. The same pull is flown with and without the
trigger, and what is asserted is the difference: a faster turn, a tighter radius, a bigger
drag bill and a faster bleed — while the PSM state machine stays asleep, the wing stays
unstalled, and the nose stays near the flight path.

Everything drives `stepFlight` with hand-built command objects except the chord case,
which goes through `stepFlightInput` because the W+S equivalence lives in the input layer.
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
const highG = tuning.highGTurn
const toWorld = 1 / envelope.performance.kmhPerWorldUnitPerSecond
const PITCH_AXIS = new Vector3(0, 0, 1)
const ALTITUDE = 815

const command = (over = {}) => ({
  pitch: 0,
  roll: 0,
  yaw: 0,
  flaps: 0,
  throttle: 0.7,
  airBrake: 0,
  accelerate: false,
  decelerate: false,
  highG: false,
  psmArm: false,
  afterburnerCommanded: false,
  burnerLevel: 0,
  ...over,
})

// Trimmed entry: wings level, velocity along +X, alpha at the incidence that speed needs.
function trimAlphaRad(speedKmh) {
  const speed = speedKmh * toWorld
  const qFactor = (speed / tuning.referenceSpeed) ** 2
  return (MathUtils.degToRad(tuning.stallAoADeg) * tuning.gravity) / (qFactor * tuning.liftGain)
}

function createEntry(speedKmh, throttle = 0.7) {
  const state = createFlightState()
  resetFlightState(state, new Vector3(0, ALTITUDE, 0), speedKmh, envelope, throttle)
  state.orientation.setFromAxisAngle(PITCH_AXIS, trimAlphaRad(speedKmh))
  state.velocity.set(speedKmh * toWorld, 0, 0)
  return state
}

/*
Fly one pull and report what it cost. `pathTurnDeg` is the total angle the *velocity
vector* swept, not the nose — a turn is a change of trajectory, and measuring the nose
would credit a manoeuvre for merely pointing somewhere.
*/
// Specific energy, the only honest way to compare two pulls that fly different arcs: a
// tighter turn ends up somewhere else on the loop, so terminal airspeed alone would credit
// whichever run happened to be pointing downhill. Kinetic plus potential, world units.
function specificEnergy(state) {
  return (0.5 * state.velocity.lengthSq()) + (tuning.gravity * state.position.y)
}

function fly(state, seconds, input) {
  const entryKmh = state.speedKmh
  const entryEnergy = specificEnergy(state)
  const previousPath = state.velocity.clone().normalize()
  const path = new Vector3()
  const result = {
    pathTurnDeg: 0,
    peakPathRateDeg: 0,
    peakAoA: 0,
    peakG: 0,
    peakDrag: 0,
    peakNoseOffDeg: 0,
    peakRollRateDeg: 0,
    minRadius: Infinity,
    leftNormalPsm: false,
    stalled: false,
    labels: new Set(),
    maxAccelJump: 0,
    maxRateStepDeg: 0,
  }
  const previousVelocity = state.velocity.clone()
  const previousStep = new Vector3()
  const velocityStep = new Vector3()
  let previousPitchRate = MathUtils.radToDeg(state.angularVelocity.z)

  for (let t = 0; t < seconds; t += FLIGHT_FIXED_STEP) {
    const resolved = typeof input === 'function' ? input(t, state) : input
    stepFlight(state, resolved, envelope, FLIGHT_FIXED_STEP)

    path.copy(state.velocity).normalize()
    result.pathTurnDeg += MathUtils.radToDeg(
      Math.acos(MathUtils.clamp(previousPath.dot(path), -1, 1)),
    )
    previousPath.copy(path)

    result.peakPathRateDeg = Math.max(result.peakPathRateDeg, state.pathRateDeg)
    result.peakAoA = Math.max(result.peakAoA, Math.abs(state.aoaDeg))
    result.peakG = Math.max(result.peakG, state.gLoad)
    result.peakDrag = Math.max(result.peakDrag, state.dragForce.length())
    result.peakNoseOffDeg = Math.max(result.peakNoseOffDeg, state.noseOffPathDeg)
    result.peakRollRateDeg = Math.max(
      result.peakRollRateDeg,
      Math.abs(MathUtils.radToDeg(state.angularVelocity.x)),
    )
    result.leftNormalPsm ||= state.psmPhase !== 'normal'
    result.stalled ||= state.postStallActive
    result.labels.add(state.maneuver)
    if (state.pathRateDeg > 1) {
      // Radius of the turn the trajectory is actually flying, in world units.
      result.minRadius = Math.min(
        result.minRadius,
        state.velocity.length() / MathUtils.degToRad(state.pathRateDeg),
      )
    }

    /*
    Smoothness is measured as a jump in acceleration, not in velocity. A 7.5 G turn moves
    the velocity vector a long way every step and is supposed to — what a snap looks like
    is the *acceleration* changing discontinuously, which is what a blend that stepped
    instead of chasing would produce.
    */
    velocityStep.subVectors(state.velocity, previousVelocity)
    result.maxAccelJump = Math.max(result.maxAccelJump, velocityStep.distanceTo(previousStep))
    previousStep.copy(velocityStep)
    previousVelocity.copy(state.velocity)
    const pitchRate = MathUtils.radToDeg(state.angularVelocity.z)
    result.maxRateStepDeg = Math.max(result.maxRateStepDeg, Math.abs(pitchRate - previousPitchRate))
    previousPitchRate = pitchRate
  }

  result.bleedKmh = entryKmh - state.speedKmh
  result.entryEnergy = entryEnergy
  result.exitEnergy = specificEnergy(state)
  result.exitKmh = state.speedKmh
  result.highGBlend = state.highGBlend
  return result
}

const pad = (value, width, digits = 0) => value.toFixed(digits).padStart(width)
const report = (name, detail) => console.log(`PASS ${name.padEnd(26)} ${detail}`)

// ------------------------------------------------- A: the trade, at fighting speed
{
  const SPEED = 900
  const SECONDS = 3.2
  const pull = command({ pitch: 1, throttle: 0.7 })
  // Cruise at the same power for the same time is the energy datum. A hard pull climbs, so
  // comparing raw airspeed or raw energy between two different arcs would credit whichever
  // one happened to be pointing downhill at the bell.
  const cruise = fly(createEntry(SPEED), SECONDS, command({ throttle: 0.7 }))
  const normal = fly(createEntry(SPEED), SECONDS, pull)
  const hard = fly(createEntry(SPEED), SECONDS, command({ ...pull, highG: true }))
  const normalCost = cruise.exitEnergy - normal.exitEnergy
  const hardCost = cruise.exitEnergy - hard.exitEnergy

  assert.ok(hard.pathTurnDeg > normal.pathTurnDeg * 1.25,
    `A: High-G must turn the flight path materially faster`
    + ` (${hard.pathTurnDeg.toFixed(0)}° vs ${normal.pathTurnDeg.toFixed(0)}°)`)
  assert.ok(hard.minRadius < normal.minRadius * 0.8,
    `A: High-G must tighten the radius (${hard.minRadius.toFixed(0)} vs ${normal.minRadius.toFixed(0)})`)
  assert.ok(hard.peakAoA > normal.peakAoA,
    'A: High-G must let the wing work at a higher alpha')
  assert.ok(hard.peakG > normal.peakG, 'A: High-G must pull a higher load factor')
  // Measured as a surcharge on the cruise arc rather than as a ratio of totals. Both pulls
  // carry the same parasite drag as the datum, and how large that parasite term is depends
  // only on where 900 km/h sits on the drag curve — which moved when
  // `highAltitude.maxPerformanceMix` brought the dry limit down from 2230 to about 1390.
  // The induced bill did not move; a ratio of totals would have said it did.
  assert.ok(hard.peakDrag > normal.peakDrag + (cruise.peakDrag * 0.25),
    `A: High-G must cost real induced drag`
    + ` (${hard.peakDrag.toFixed(1)} vs ${normal.peakDrag.toFixed(1)},`
    + ` cruise ${cruise.peakDrag.toFixed(1)})`)
  /*
  What an ordinary pull spends is airspeed, and this is the assertion that says so.

  It used to read `normalCost > 0` — the pull holding less specific energy than the datum —
  and that was never quite the claim it made. The datum is not in trim: 0.7 holds about 1020
  km/h, so the cruise arc accelerates while the pull climbs, and `normalCost` is really a
  comparison of two arcs going different places. It came out positive only while the dry
  limit was 2230 and cruise had five hundred km/h of runway to gain energy down. Against the
  limit `maxPerformanceMix` now allows, the pull trades its speed for height and finds
  surplus thrust at the bottom, and the sign flips without anything about the pull changing.
  */
  assert.ok(normal.exitKmh < cruise.exitKmh * 0.85,
    `A: an ordinary pull must already cost airspeed against cruise`
    + ` (${normal.exitKmh.toFixed(0)} vs ${cruise.exitKmh.toFixed(0)} km/h)`)
  // What High-G adds on top of that is an energy bill, and this one is a true energy
  // comparison because both arcs are the same pull against the same datum. It is scaled by
  // the kinetic energy the manoeuvre was entered with so it stays a statement about the
  // trade rather than about the units.
  const entryKineticEnergy = 0.5 * ((SPEED * toWorld) ** 2)
  assert.ok(hardCost - normalCost > entryKineticEnergy * 0.1,
    `A: High-G must spend energy faster than the same pull without it`
    + ` (${hardCost.toFixed(0)} vs ${normalCost.toFixed(0)})`)

  report('A high-G trade', `turn=${pad(hard.pathTurnDeg, 4)}° (${pad(normal.pathTurnDeg, 3)}°)`
    + ` radius=${pad(hard.minRadius, 4)} (${pad(normal.minRadius, 4)})`
    + ` aoa=${pad(hard.peakAoA, 5, 1)}° g=${pad(hard.peakG, 4, 1)}`
    + ` cost=${pad(hardCost, 5)} (${pad(normalCost, 4)})`
    + ` exit=${pad(hard.exitKmh, 4)} (${pad(normal.exitKmh, 4)}) km/h`)
}

// ------------------------------------------- A2: the same trade in a banked level turn
{
  const SPEED = 900
  const SECONDS = 3.2
  // Roll in, then pull — how the control is actually used. This exercises the roll ceiling
  // as well as the pitch one, and the turn it measures is a heading change rather than a
  // loop, which is what a player means by "turn".
  const banked = (over = {}) => (t) => command({
    roll: t < 0.9 ? 1 : 0.1,
    pitch: t < 0.5 ? 0.2 : 1,
    throttle: 0.7,
    ...over,
  })
  const normal = fly(createEntry(SPEED), SECONDS, banked())
  const hard = fly(createEntry(SPEED), SECONDS, banked({ highG: true }))

  assert.ok(hard.pathTurnDeg > normal.pathTurnDeg * 1.25,
    `A2: a banked High-G turn must change the flight path faster`
    + ` (${hard.pathTurnDeg.toFixed(0)}° vs ${normal.pathTurnDeg.toFixed(0)}°)`)
  assert.ok(hard.minRadius < normal.minRadius * 0.8,
    `A2: a banked High-G turn must be tighter`
    + ` (${hard.minRadius.toFixed(0)} vs ${normal.minRadius.toFixed(0)})`)
  assert.ok(hard.peakRollRateDeg > normal.peakRollRateDeg * 1.1,
    `A2: High-G must also roll into the turn faster`
    + ` (${hard.peakRollRateDeg.toFixed(0)} vs ${normal.peakRollRateDeg.toFixed(0)}°/s)`)
  assert.equal(hard.leftNormalPsm, false, 'A2: a banked High-G turn must not reach PSM')
  assert.equal(hard.stalled, false, 'A2: a banked High-G turn must keep the wing flying')

  report('A2 banked turn', `turn=${pad(hard.pathTurnDeg, 4)}° (${pad(normal.pathTurnDeg, 3)}°)`
    + ` radius=${pad(hard.minRadius, 4)} (${pad(normal.minRadius, 4)})`
    + ` roll=${pad(hard.peakRollRateDeg, 4)} (${pad(normal.peakRollRateDeg, 3)})°/s`
    + ` g=${pad(hard.peakG, 4, 1)} exit=${pad(hard.exitKmh, 4)} (${pad(normal.exitKmh, 4)}) km/h`)
}

// -------------------------------------------- B: High-G is never post-stall, at any speed
{
  for (const speedKmh of [280, 420, 620, 900, 1300]) {
    const run = fly(createEntry(speedKmh), 4, command({ pitch: 1, highG: true, throttle: 0.7 }))

    assert.equal(run.leftNormalPsm, false,
      `B: High-G at ${speedKmh} km/h must never enter the PSM state machine`)
    assert.equal(run.stalled, false,
      `B: High-G at ${speedKmh} km/h must keep the wing flying (peak ${run.peakAoA.toFixed(1)}°)`)
    assert.ok(run.peakAoA < tuning.stallAoADeg,
      `B: High-G alpha must stay under the stall (saw ${run.peakAoA.toFixed(1)}°)`)
    assert.ok(run.peakNoseOffDeg < tuning.cobraMinAoADeg,
      `B: High-G must keep the nose near the flight path (saw ${run.peakNoseOffDeg.toFixed(1)}°)`)
    for (const label of ['cobra', 'tumble', 'j-turn', 'post-stall']) {
      assert.equal(run.labels.has(label), false,
        `B: High-G at ${speedKmh} km/h must never be labelled ${label}`)
    }

    report(`B no PSM @${speedKmh}kmh`, `aoa=${pad(run.peakAoA, 5, 1)}°`
      + ` noseOff=${pad(run.peakNoseOffDeg, 5, 1)}° blend=${run.highGBlend.toFixed(2)}`
      + ` labels=${[...run.labels].join(',')}`)
  }
}

// --------------------------------------------------------- C: low energy costs authority
{
  const slow = fly(createEntry(300, 0.3), 2.5, command({ pitch: 1, highG: true, throttle: 0.3 }))
  const fast = fly(createEntry(900), 2.5, command({ pitch: 1, highG: true, throttle: 0.7 }))

  assert.ok(slow.highGBlend < fast.highGBlend * 0.6,
    `C: the trigger must be worth less with no energy behind it`
    + ` (${slow.highGBlend.toFixed(2)} vs ${fast.highGBlend.toFixed(2)})`)
  assert.ok(slow.highGBlend > 0, 'C: low energy must reduce High-G, not switch it off')

  report('C low energy', `slow=${slow.highGBlend.toFixed(2)} fast=${fast.highGBlend.toFixed(2)}`
    + ` gate=${highG.lowEnergyAuthority}..1 over ${highG.lowEnergyKmh}-${highG.fullEnergyKmh}km/h`)
}

// ------------------------------------- D: Alt is the only thing that reaches post-stall
{
  const psmRun = fly(createEntry(520, 0.5), 1.6, (t) => command({
    psmArm: true,
    pitch: t >= 0.2 ? 1 : 0,
    throttle: 0.5,
  }))
  const highGRun = fly(createEntry(520, 0.5), 1.6, (t) => command({
    highG: true,
    pitch: t >= 0.2 ? 1 : 0,
    throttle: 0.5,
  }))

  assert.ok(psmRun.leftNormalPsm, 'D: Maneuver Assist plus pull must still reach PSM')
  assert.ok(psmRun.peakAoA > tuning.stallAoADeg, 'D: PSM must pass the stall')
  assert.equal(highGRun.leftNormalPsm, false,
    'D: the same pull on the High-G trigger must not reach PSM')
  assert.ok(highGRun.peakAoA < tuning.stallAoADeg,
    'D: the same pull on the High-G trigger must not pass the stall')

  report('D Alt vs Space', `psm aoa=${pad(psmRun.peakAoA, 5, 1)}° noseOff=${pad(psmRun.peakNoseOffDeg, 5, 1)}°`
    + ` | high-g aoa=${pad(highGRun.peakAoA, 5, 1)}° noseOff=${pad(highGRun.peakNoseOffDeg, 5, 1)}°`)
}

// --------------------------------------- E: releasing the trigger, and handing off to Alt
{
  // The control run never touches the trigger, so its jerk is what this airframe produces
  // when nothing changes underneath it. Every smoothness assertion below is measured
  // against that rather than against a number picked out of the air.
  const smooth = fly(createEntry(900), 2.2, command({ pitch: 1, highG: true, throttle: 0.7 }))

  const state = createEntry(900)
  const released = fly(state, 2.2, (t) => command({
    pitch: 1,
    highG: t < 1.2,
    throttle: 0.7,
  }))
  assert.ok(state.highGBlend < 0.2, 'E: releasing the trigger must let the blend decay')
  assert.ok(released.maxAccelJump < smooth.maxAccelJump * 1.6,
    `E: no acceleration snap on release`
    + ` (${released.maxAccelJump.toFixed(4)} vs ${smooth.maxAccelJump.toFixed(4)} held)`)
  assert.ok(released.maxRateStepDeg < smooth.maxRateStepDeg * 1.6,
    `E: no rate snap on release`
    + ` (${released.maxRateStepDeg.toFixed(3)} vs ${smooth.maxRateStepDeg.toFixed(3)}°/s held)`)

  // High-G first, then Alt: the transition into PSM has to be continuous in both states.
  const handoff = createEntry(520, 0.6)
  const psmOnly = createEntry(520, 0.6)
  const psmRun = fly(psmOnly, 2.4, (t) => command({
    pitch: t >= 0.2 ? 1 : 0,
    psmArm: true,
    throttle: 0.6,
  }))
  const run = fly(handoff, 2.4, (t) => command({
    pitch: t >= 0.2 ? 1 : 0,
    highG: t < 1,
    psmArm: t >= 1,
    throttle: 0.6,
  }))
  assert.ok(run.leftNormalPsm, 'E: High-G into Alt must still be able to reach PSM')
  assert.ok(run.maxAccelJump < psmRun.maxAccelJump * 1.6,
    `E: no acceleration snap across the handoff`
    + ` (${run.maxAccelJump.toFixed(4)} vs ${psmRun.maxAccelJump.toFixed(4)} for PSM alone)`)
  assert.ok(handoff.highGBlend < 0.2,
    'E: PSM must own the pitch axis rather than sharing it with High-G')

  report('E release / handoff', `blend=${state.highGBlend.toFixed(2)}`
    + ` jerk=${released.maxAccelJump.toFixed(4)} (held ${smooth.maxAccelJump.toFixed(4)})`
    + ` drate=${released.maxRateStepDeg.toFixed(3)}°/s`
    + ` | handoff blend=${handoff.highGBlend.toFixed(2)}`
    + ` jerk=${run.maxAccelJump.toFixed(4)} (psm ${psmRun.maxAccelJump.toFixed(4)})`)
}

// ------------------------------------------------- F: W+S is the same control as Space
{
  const SECONDS = 2.4
  const controls = createFlightInputState(900)
  const chordState = createEntry(900)
  let chordAirBrake = 0
  let chordHighG = false

  for (let t = 0; t < SECONDS; t += FLIGHT_FIXED_STEP) {
    controls.pressed.clear()
    controls.pressed.add('pitch-up')
    controls.pressed.add('throttle-up')
    controls.pressed.add('throttle-down')
    const input = stepFlightInput(controls, FLIGHT_FIXED_STEP, envelope, chordState.position.y)
    chordAirBrake = Math.max(chordAirBrake, input.airBrake)
    chordHighG ||= input.highG
    stepFlight(chordState, {
      pitch: input.pitch,
      roll: input.roll,
      yaw: input.yaw,
      flaps: input.flaps,
      throttle: input.throttle,
      airBrake: input.airBrake,
      accelerate: input.accelerate,
      decelerate: input.decelerate,
      highG: input.highG,
      psmArm: input.psmArm,
      afterburnerCommanded: input.afterburner,
      burnerLevel: 0,
    }, envelope, FLIGHT_FIXED_STEP)
  }

  const spaceControls = createFlightInputState(900)
  const spaceState = createEntry(900)
  for (let t = 0; t < SECONDS; t += FLIGHT_FIXED_STEP) {
    spaceControls.pressed.clear()
    spaceControls.pressed.add('pitch-up')
    spaceControls.pressed.add('high-g')
    const input = stepFlightInput(spaceControls, FLIGHT_FIXED_STEP, envelope, spaceState.position.y)
    stepFlight(spaceState, {
      pitch: input.pitch,
      roll: input.roll,
      yaw: input.yaw,
      flaps: input.flaps,
      throttle: input.throttle,
      airBrake: input.airBrake,
      accelerate: input.accelerate,
      decelerate: input.decelerate,
      highG: input.highG,
      psmArm: input.psmArm,
      afterburnerCommanded: input.afterburner,
      burnerLevel: 0,
    }, envelope, FLIGHT_FIXED_STEP)
  }

  assert.ok(chordHighG, 'F: W+S must publish High-G intent')
  assert.equal(chordAirBrake, 0, 'F: the W+S chord must not open the air brake')
  assert.equal(controls.commandSpeedKmh, 900,
    'F: W+S must hold the commanded speed rather than fighting over it')
  assert.ok(Math.abs(chordState.speedKmh - spaceState.speedKmh) < 1,
    `F: the chord must fly the same turn Space does`
    + ` (${chordState.speedKmh.toFixed(1)} vs ${spaceState.speedKmh.toFixed(1)} km/h)`)
  assert.ok(Math.abs(chordState.highGBlend - spaceState.highGBlend) < 1e-6,
    'F: both shortcuts must produce the same blend')

  report('F W+S equals Space', `brake=${chordAirBrake} cmd=${controls.commandSpeedKmh.toFixed(0)}km/h`
    + ` chord=${chordState.speedKmh.toFixed(1)} space=${spaceState.speedKmh.toFixed(1)} km/h`
    + ` blend=${chordState.highGBlend.toFixed(2)}`)
}

console.log('PASS high-G: rate/radius/drag/bleed trade, never post-stall, energy-gated,'
  + ' smooth release and PSM handoff, W+S identical to Space')
