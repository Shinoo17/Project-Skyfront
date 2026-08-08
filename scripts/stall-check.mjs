/*
Stall / high-AoA / post-stall regression checks.

`flight-physics-check` proves the banked-turn force relationship; this one proves the
things that only matter once alpha gets large:

  A  normal level flight            no stall, no drama, G near 1
  B  low speed, moderate AoA        authority fades with the airstream, but no departure
  C  high speed, full aft stick     alpha and G rise, drag bites, and the G fence holds
  D  cobra                          nose leaves the airstream, energy is spent, it recovers
  E  idle throttle, nose down       attitude changes; momentum does not follow it
  F  vertical tailslide             velocity crosses zero and genuinely reverses
  G  falling leaf                   hands-off departure oscillates but stays bounded
  H  low-speed flat yaw             nose pivots faster than the trajectory
  I  sustained post-stall pull      completes a Kulbit, then rotation bleeds away

Every case flies the real `stepFlight` at the real fixed step. The scenarios enter already
trimmed so they test the aerodynamics rather than the keyboard ramp.
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
const altitude = 815

const FORWARD = new Vector3(1, 0, 0)
const PITCH_AXIS = new Vector3(0, 0, 1)

const command = (over = {}) => ({
  pitch: 0,
  roll: 0,
  yaw: 0,
  flaps: 0,
  throttle: envelope.idleThrottle,
  airBrake: 0,
  afterburnerCommanded: false,
  burnerLevel: 0,
  ...over,
})

// The incidence that makes exactly 1 g at this speed, read off the model's own lift law
// in its linear region. Used only to enter a scenario already trimmed.
function trimAlphaRad(speedKmh) {
  const speed = speedKmh * toWorld
  const qFactor = (speed / tuning.referenceSpeed) ** 2
  return MathUtils.degToRad(tuning.stallAoADeg) * tuning.gravity / (qFactor * tuning.liftGain)
}

function trimmed(speedKmh, throttle) {
  const state = createFlightState()
  resetFlightState(state, new Vector3(0, altitude, 0), speedKmh, envelope, throttle)
  state.orientation.setFromAxisAngle(PITCH_AXIS, trimAlphaRad(speedKmh))
  state.velocity.set(speedKmh * toWorld, 0, 0)
  return state
}

function noseDeg(state) {
  const nose = FORWARD.clone().applyQuaternion(state.orientation)
  return MathUtils.radToDeg(Math.asin(MathUtils.clamp(nose.y, -1, 1)))
}

function pathDeg(state) {
  const path = state.velocity.clone().normalize()
  return MathUtils.radToDeg(Math.asin(MathUtils.clamp(path.y, -1, 1)))
}

// Runs `seconds` of flight, taking a command from a function of elapsed time so a scenario
// can release the stick partway through. Returns the peaks and the final state.
function fly(state, seconds, at, sample) {
  const peak = {
    aoa: 0, g: 0, drag: 0, lift: 0, noseRate: 0, stall: 0, postStall: 0,
  }
  let minSpeed = Infinity
  for (let t = 0; t < seconds; t += FLIGHT_FIXED_STEP) {
    stepFlight(state, at(t), envelope, FLIGHT_FIXED_STEP)
    peak.aoa = Math.max(peak.aoa, Math.abs(state.aoaDeg))
    peak.g = Math.max(peak.g, Math.abs(state.gLoad))
    peak.drag = Math.max(peak.drag, state.dragForce.length())
    peak.lift = Math.max(peak.lift, state.liftForce.length())
    peak.noseRate = Math.max(peak.noseRate, Math.abs(MathUtils.radToDeg(state.angularVelocity.z)))
    peak.postStall = Math.max(peak.postStall, state.postStallBlend)
    minSpeed = Math.min(minSpeed, state.speedKmh)
    if (sample) sample(t, state)
  }
  return { peak, minSpeed, state }
}

const results = []
function report(label, extra) {
  results.push(`${label.padEnd(22)} ${extra}`)
}

// ------------------------------------------------------------------ A: level flight
{
  const speedKmh = 800
  const state = trimmed(speedKmh, 0.62)
  const { peak } = fly(state, 6, () => command({ throttle: 0.62 }))
  const drift = state.position.y - altitude

  assert.ok(peak.aoa < tuning.stallAoADeg, 'A: level cruise must stay well below the stall')
  assert.ok(peak.postStall === 0, 'A: level cruise must never register post-stall')
  assert.ok(peak.g < 2, 'A: hands-off level flight must not pull G')
  assert.ok(Math.abs(drift) < 60, 'A: level cruise must roughly hold altitude')

  report('A level flight', `aoa=${peak.aoa.toFixed(1)}° g=${peak.g.toFixed(2)}`
    + ` dy=${drift.toFixed(1)} kmh=${state.speedKmh.toFixed(0)} stall=${peak.postStall.toFixed(2)}`)
}

// ------------------------------------------- B: low speed, moderate pull, no departure
{
  const slow = trimmed(300, 0.3)
  const fast = trimmed(900, 0.7)
  const slowRun = fly(slow, 2.5, () => command({ pitch: 0.5, throttle: 0.3 }))
  const fastRun = fly(fast, 2.5, () => command({ pitch: 0.5, throttle: 0.7 }))

  assert.ok(
    slowRun.peak.noseRate < fastRun.peak.noseRate,
    'B: the same stick must move the nose less when there is less airflow',
  )
  // An uncommitted pull sits under the conventional alpha fence, so it may graze the stall
  // as the wing runs out of speed but must never fall through into post-stall flight.
  assert.ok(slowRun.peak.postStall < 0.1, 'B: a moderate pull when slow must not enter post-stall')
  assert.ok(
    slowRun.peak.aoa < tuning.normalAoALimitDeg + tuning.aoaLimitSoftnessDeg,
    'B: an uncommitted pull must stay inside the conventional alpha fence',
  )

  report('B slow moderate pull', `aoa=${slowRun.peak.aoa.toFixed(1)}°`
    + ` noseRate=${slowRun.peak.noseRate.toFixed(0)}°/s (fast ${fastRun.peak.noseRate.toFixed(0)})`
    + ` stall=${slowRun.peak.postStall.toFixed(2)}`)
}

// ------------------------------------------------- C: high speed, full aft stick, G fence
{
  const speedKmh = 1100
  // One step at the trim to read the cruise drag this pull will be measured against.
  const datum = trimmed(speedKmh, 0.95)
  fly(datum, FLIGHT_FIXED_STEP * 2, () => command({ throttle: 0.95 }))
  const trimDrag = datum.dragForce.length()

  const state = trimmed(speedKmh, 0.95)
  const run = fly(state, 3, () => command({ pitch: 1, throttle: 0.95 }))

  assert.ok(run.peak.aoa > 8, 'C: a full pull at speed must build real alpha')
  assert.ok(
    run.peak.drag > trimDrag * 1.15,
    'C: the induced-drag bill for a hard pull must show up against cruise drag',
  )
  assert.ok(
    speedKmh - run.minSpeed > 60,
    'C: a sustained max pull must visibly cost energy',
  )
  assert.ok(
    run.peak.g <= tuning.maxG * 1.12,
    `C: the FCC must hold the structural G limit (saw ${run.peak.g.toFixed(1)}g,`
      + ` limit ${tuning.maxG}g)`,
  )

  report('C high-speed pull', `aoa=${run.peak.aoa.toFixed(1)}° g=${run.peak.g.toFixed(2)}`
    + ` drag=${run.peak.drag.toFixed(1)} dV=${(speedKmh - run.minSpeed).toFixed(0)}kmh`)
}

// ------------------------------------------------------------------------ D: cobra
{
  const entryKmh = 520
  const state = trimmed(entryKmh, 0.5)
  // Full aft for 1.4 s, then hands off to recover. The recovery window is long on purpose:
  // hands-off from a deep stall is a mush, not a snap. Alpha comes down monotonically as the
  // nose falls and the speed rebuilds, and the wing does not bite again until about seven
  // seconds in — which is the point, since nothing in the model is allowed to shortcut it.
  const run = fly(state, 9, (t) => command({ pitch: t < 1.4 ? 1 : 0, throttle: 0.5 }))
  const divergence = (() => {
    const nose = FORWARD.clone().applyQuaternion(state.orientation)
    const path = state.velocity.clone().normalize()
    return MathUtils.radToDeg(Math.acos(MathUtils.clamp(nose.dot(path), -1, 1)))
  })()

  assert.ok(run.peak.aoa > 55, 'D: a cobra must put the nose well off the airstream')
  assert.ok(run.peak.postStall > 0.5, 'D: a cobra must register as post-stall')
  assert.ok(entryKmh - run.minSpeed > 120, 'D: a cobra must cost a lot of energy')
  assert.ok(Math.abs(state.aoaDeg) < tuning.stallAoADeg, 'D: releasing the stick must recover')
  assert.ok(divergence < 25, 'D: after recovery the nose must be back near the airstream')

  report('D cobra', `peakAoa=${run.peak.aoa.toFixed(0)}° postStall=${run.peak.postStall.toFixed(2)}`
    + ` dV=${(entryKmh - run.minSpeed).toFixed(0)}kmh exitAoa=${state.aoaDeg.toFixed(1)}°`
    + ` exitDiverge=${divergence.toFixed(1)}°`)

  /*
  Chained cobras must not be free. The metric is total specific energy, not airspeed:
  the recovery is a dive, so the jet trades height back for speed and reads *faster* at the
  bottom of the second cobra than at the bottom of the first. Airspeed alone would call that
  a free manoeuvre. Height plus speed together is the thing that has to be monotonically
  spent, and it is the quantity the pilot is actually paying with.
  */
  const specificEnergy = (s) => (
    ((s.velocity.length() ** 2) / 2) + (tuning.gravity * s.position.y)
  )
  const chain = trimmed(entryKmh, 0.5)
  const energies = [specificEnergy(chain)]
  for (let n = 0; n < 3; n += 1) {
    fly(chain, 1.4, () => command({ pitch: 1, throttle: 0.5 }))
    fly(chain, 2.6, () => command({ pitch: 0, throttle: 0.5 }))
    energies.push(specificEnergy(chain))
  }
  const spent = energies.slice(1).map((e, i) => energies[i] - e)
  assert.ok(
    spent.every((cost) => cost > 0),
    'D: every cobra in a chain must cost energy — no free super-turn',
  )
  assert.ok(
    spent[2] > spent[0],
    'D: cobras flown from a worse energy state must cost more, not less',
  )
  report('D cobra chain', `spent=${spent.map((v) => v.toFixed(0)).join(' then ')}`
    + ` of ${energies[0].toFixed(0)} specific energy`)
}

// ------------------------------------------------ E: idle throttle, hard nose-down push
{
  // Throttle back to the stop and shove. Flown at three speeds, because the interesting
  // claim is not that the flight path lags the nose once — it is *why* it lags. Nothing
  // rotates the velocity except lift, so the lag has to be a function of how much lift there
  // is to rotate it with, and it must therefore grow as the airspeed falls. A model that
  // snapped the velocity toward the boresight, or blended it there on a fixed time constant,
  // would show the same lag at every speed.
  function pushOver(speedKmh) {
    const state = trimmed(speedKmh, 0.08)
    const trace = []
    fly(state, 2.5, () => command({ pitch: -1, throttle: 0.08 }), (t, s) => {
      trace.push({ t, nose: noseDeg(s), path: pathDeg(s) })
    })
    return {
      trace,
      maxLag: Math.max(...trace.map((row) => row.path - row.nose)),
    }
  }

  const fast = pushOver(900)
  const mid = pushOver(500)
  const slow = pushOver(300)

  const early = fast.trace.find((row) => row.t >= 0.5)
  const late = fast.trace[fast.trace.length - 1]

  assert.ok(early.nose < -10, 'E: the nose must be able to point down')
  assert.ok(
    early.path > early.nose + 2,
    'E: momentum must lag the nose — the flight path may not snap to the boresight',
  )
  assert.ok(late.path < early.path - 8, 'E: gravity and lift must then bend the path down')
  assert.ok(
    slow.maxLag > mid.maxLag && mid.maxLag > fast.maxLag,
    'E: the lag must grow as the wing weakens — proof that lift bends the path, not a rule',
  )
  // The wing has to be loaded negative to pull the path down; if the velocity were being
  // steered directly, no incidence would be needed to do it.
  assert.ok(state1AlphaNegative(), 'E: the push-over must be flown with negative incidence')

  function state1AlphaNegative() {
    const probe = trimmed(900, 0.08)
    fly(probe, 1, () => command({ pitch: -1, throttle: 0.08 }))
    return probe.aoaDeg < -2
  }

  report('E idle nose-down', `900kmh t=0.5s nose=${early.nose.toFixed(1)}°`
    + ` path=${early.path.toFixed(1)}° lag=${(early.path - early.nose).toFixed(1)}°`
    + ` | peak lag 300/500/900 = ${slow.maxLag.toFixed(1)}/${mid.maxLag.toFixed(1)}`
    + `/${fast.maxLag.toFixed(1)}°`)
}

// ---------------------------------------------------------- F: vertical reverse slide
{
  const state = createFlightState()
  resetFlightState(state, new Vector3(0, altitude, 0), 120, envelope, envelope.idleThrottle)
  state.orientation.setFromAxisAngle(PITCH_AXIS, Math.PI / 2)
  state.velocity.set(0, 120 * toWorld, 0)

  let minSpeed = Infinity
  let minForward = Infinity
  let sawTailslide = false
  let lowestNose = 90
  fly(state, 7, () => command(), (_t, sample) => {
    minSpeed = Math.min(minSpeed, sample.speedKmh)
    minForward = Math.min(minForward, sample.forwardSpeedKmh)
    lowestNose = Math.min(lowestNose, noseDeg(sample))
    sawTailslide ||= sample.maneuver === 'tailslide'
  })

  assert.ok(minSpeed < 12, 'F: a vertical zoom must be allowed to pass through near-zero speed')
  assert.ok(minForward < -25, 'F: velocity must reverse along the nose in a real tailslide')
  assert.ok(sawTailslide, 'F: axial reverse flight must be identified as a tailslide')
  assert.ok(lowestNose < 45, 'F: the airstream must eventually weathercock the nose out of reverse')

  report('F vertical tailslide', `min=${minSpeed.toFixed(1)}kmh reverse=${minForward.toFixed(0)}kmh`
    + ` noseDrop=${(90 - lowestNose).toFixed(0)}° exit=${state.speedKmh.toFixed(0)}kmh`)
}

// ------------------------------------------------ G: deterministic falling-leaf departure
{
  const state = createFlightState()
  resetFlightState(state, new Vector3(0, altitude, 0), 170, envelope, envelope.idleThrottle)
  state.orientation.setFromAxisAngle(PITCH_AXIS, MathUtils.degToRad(72))
  state.velocity.set(150 * toWorld, -90 * toWorld, 0)

  let peakLeaf = 0
  let maxRollRate = 0
  let maxYawRate = 0
  let rollPositive = false
  let rollNegative = false
  const startY = state.position.y
  fly(state, 5, () => command(), (_t, sample) => {
    const rollRate = MathUtils.radToDeg(sample.angularVelocity.x)
    peakLeaf = Math.max(peakLeaf, sample.departureBlend)
    maxRollRate = Math.max(maxRollRate, Math.abs(rollRate))
    maxYawRate = Math.max(maxYawRate, Math.abs(MathUtils.radToDeg(sample.angularVelocity.y)))
    rollPositive ||= rollRate > 1
    rollNegative ||= rollRate < -1
  })

  const sink = startY - state.position.y
  assert.ok(peakLeaf > 0.3, 'G: a slow, separated, hands-off sink must excite falling-leaf coupling')
  assert.ok(rollPositive && rollNegative, 'G: the leaf must swap roll direction rather than spin one way')
  assert.ok(maxRollRate < 35 && maxYawRate < 35, 'G: the departure must remain bounded')
  assert.ok(sink > 8, 'G: a falling leaf must lose altitude')

  report('G falling leaf', `blend=${peakLeaf.toFixed(2)} roll=${maxRollRate.toFixed(0)}°/s`
    + ` yaw=${maxYawRate.toFixed(0)}°/s sink=${sink.toFixed(0)}`)
}

// --------------------------------------------------------- H: low-speed post-stall yaw
{
  function yawProbe(pitchDeg) {
    const state = createFlightState()
    resetFlightState(state, new Vector3(0, altitude, 0), 270, envelope, 0.7)
    state.orientation.setFromAxisAngle(PITCH_AXIS, MathUtils.degToRad(pitchDeg))
    state.velocity.set(270 * toWorld, 0, 0)
    const startNose = FORWARD.clone().applyQuaternion(state.orientation)
    const startPath = state.velocity.clone().normalize()
    let peakYaw = 0
    fly(state, 1.2, () => command({ yaw: 1, throttle: 0.7 }), (_t, sample) => {
      peakYaw = Math.max(peakYaw, Math.abs(MathUtils.radToDeg(sample.angularVelocity.y)))
    })
    const endNose = FORWARD.clone().applyQuaternion(state.orientation)
    const endPath = state.velocity.clone().normalize()
    const headingDelta = (from, to) => {
      const start = Math.atan2(from.z, from.x)
      const end = Math.atan2(to.z, to.x)
      return Math.abs(MathUtils.radToDeg(Math.atan2(Math.sin(end - start), Math.cos(end - start))))
    }
    return {
      peakYaw,
      noseTurn: headingDelta(startNose, endNose),
      pathTurn: headingDelta(startPath, endPath),
    }
  }

  const level = yawProbe(0)
  const highAlpha = yawProbe(60)
  assert.ok(
    highAlpha.peakYaw > level.peakYaw * 1.5,
    'H: low-speed TVC yaw must require the nose-high/high-alpha or pedal window',
  )
  assert.ok(
    highAlpha.noseTurn > highAlpha.pathTurn * 1.45,
    `H: flat rotation must point the nose faster than the trajectory (nose `
      + `${highAlpha.noseTurn.toFixed(1)}°, path ${highAlpha.pathTurn.toFixed(1)}°)`,
  )
  assert.ok(level.peakYaw < 30, 'H: a level low-speed jet must not yaw like a turntable')

  report('H flat yaw pivot', `level=${level.peakYaw.toFixed(0)}°/s`
    + ` highAoA=${highAlpha.peakYaw.toFixed(0)}°/s`
    + ` nose/path=${highAlpha.noseTurn.toFixed(0)}°/${highAlpha.pathTurn.toFixed(0)}°`)
}

// -------------------------------------------- I: no unlimited powered post-stall rotation
{
  const state = trimmed(520, 0.7)
  const startY = state.position.y
  let rotationDeg = 0
  let previous = state.orientation.clone()
  fly(state, 20, () => command({
    pitch: 1,
    throttle: 0.7,
    afterburnerCommanded: true,
    burnerLevel: 1,
  }), (_t, sample) => {
    rotationDeg += MathUtils.radToDeg(previous.angleTo(sample.orientation))
    previous.copy(sample.orientation)
  })
  const exitPitchRate = Math.abs(MathUtils.radToDeg(state.angularVelocity.z))
  const altitudeLoss = startY - state.position.y

  assert.ok(rotationDeg > 360, 'I: a committed powered pull must be able to complete a Kulbit')
  assert.ok(rotationDeg < 1800, 'I: the airframe must not rotate forever under held input')
  assert.ok(exitPitchRate < 40, 'I: reverse-flow weathercocking must eventually arrest the tumble')
  assert.ok(altitudeLoss > 30, 'I: sustained post-stall rotation must pay an altitude bill')

  report('I bounded Kulbit', `rotation=${rotationDeg.toFixed(0)}°`
    + ` exitRate=${exitPitchRate.toFixed(0)}°/s loss=${altitudeLoss.toFixed(0)}`)
}

for (const line of results) console.log(line)
console.log('PASS stall checks: stall, TVC, post-stall energy, reverse flight, bounded departure')
