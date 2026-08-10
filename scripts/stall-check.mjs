/*
Stall / high-AoA / post-stall regression checks.

`flight-physics-check` proves the banked-turn force relationship; this one proves the
things that only matter once alpha gets large:

  A  normal level flight            no stall, no drama, G near 1
  B  low speed, moderate AoA        authority fades with the airstream, but no departure
  B2 low speed, full pull           FCC protects the stall unless Maneuver Assist is armed
  C  high speed, full aft stick     alpha and G rise, drag bites, and the G fence holds
  D  arcade assisted Cobra         assist arms, path floats forward, energy is spent, recovery works
  E  idle throttle, nose down       attitude changes; momentum does not follow it
  F  vertical tailslide             velocity crosses zero and genuinely reverses
  G  falling leaf                   hands-off departure oscillates but stays bounded
  H  low-speed flat yaw             nose pivots faster than the trajectory
  I  extended assisted pull        reaches a bounded Kulbit and recovers

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
  accelerate: false,
  psmArm: false,
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

// ------------------------------------------ B2: low speed, full pull, protected envelope
{
  const state = trimmed(520, 0.5)
  let leftNormalFlight = false
  const run = fly(state, 2.5, () => command({ pitch: 1, throttle: 0.5 }), (_t, sample) => {
    leftNormalFlight ||= sample.psmPhase !== 'normal'
  })

  assert.equal(leftNormalFlight, false,
    'B2: full aft stick without Maneuver Assist must remain normal flight')
  assert.ok(run.peak.aoa < tuning.stallAoADeg,
    `B2: protected pull must stay below stall AoA (saw ${run.peak.aoa.toFixed(1)}°)`)
  assert.equal(run.peak.postStall, 0,
    'B2: protected pull must never register post-stall separation')

  report('B2 protected pull', `aoa=${run.peak.aoa.toFixed(1)}°`
    + ` limit=${tuning.stallProtectionAoALimitDeg.toFixed(0)}°`
    + ` stall=${run.peak.postStall.toFixed(2)}`)
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

// -------------------------------------------------------------- D: arcade assisted Cobra
{
  const entryKmh = 520
  const state = trimmed(entryKmh, 0.5)
  const startY = state.position.y
  let peakNose = 0
  let peakDivergence = 0
  let minPathPitch = Infinity
  let maxPathPitch = -Infinity
  let minGravityScale = 1
  let maxY = startY
  let sawPrepare = false
  let sawPostStall = false
  let sawRecovery = false
  let recoveryStartedAt = null
  let recoveryCompletedAt = null
  let maxRecoveryPitchDownRate = 0

  const run = fly(state, 5.0, (t) => {
    if (t < 0.2) return command({ psmArm: true, throttle: 0.5 })
    if (t < 0.9) return command({ psmArm: true, pitch: 1, throttle: 0.5 })
    if (t < 1.35) return command({ accelerate: true, throttle: 1 })
    if (t < 2.05) return command({ pitch: -1, accelerate: true, throttle: 1 })
    return command({ accelerate: true, throttle: 1 })
  }, (t, sample) => {
    peakNose = Math.max(peakNose, noseDeg(sample))
    peakDivergence = Math.max(peakDivergence, sample.noseOffPathDeg)
    minGravityScale = Math.min(minGravityScale, sample.gravityScale)
    maxY = Math.max(maxY, sample.position.y)
    if (sample.psmPhase === 'high-aoa') sawPrepare = true
    if ((sample.psmPhase === 'post-stall' || sample.psmPhase === 'cobra-hold') && t < 1.35) {
      sawPostStall = true
      minPathPitch = Math.min(minPathPitch, pathDeg(sample))
      maxPathPitch = Math.max(maxPathPitch, pathDeg(sample))
    }
    if (sample.psmPhase === 'recovery') {
      sawRecovery = true
      recoveryStartedAt ??= t
      const restoringPitchRate = -MathUtils.radToDeg(sample.angularVelocity.z)
        * Math.sign(sample.aoaDeg)
      maxRecoveryPitchDownRate = Math.max(maxRecoveryPitchDownRate, restoringPitchRate)
    } else if (sawRecovery && recoveryCompletedAt === null) {
      recoveryCompletedAt = t
    }
  })

  const energyCost = entryKmh - run.minSpeed
  const recoverySeconds = recoveryCompletedAt - recoveryStartedAt
  assert.ok(sawPrepare && sawPostStall && sawRecovery,
    'D: Maneuver Assist must fly every PSM phase')
  assert.ok(peakNose > 82, 'D: assisted Cobra must point the nose close to vertical')
  assert.ok(peakDivergence > 70, 'D: the nose must leave the velocity vector')
  assert.ok(minPathPitch > -12, 'D: PSM float must stop gravity dumping the path at the ground')
  // The slower, player-selectable PSM pitch rate leaves the wing lifting for a fraction
  // longer on entry. Forty degrees still keeps a wide nose/path split while admitting that
  // small aerodynamic arc instead of requiring the old 210deg/s snap through the stall.
  assert.ok(maxPathPitch < 40,
    `D: velocity must not rotate upward with the nose (path ${maxPathPitch.toFixed(1)}°)`)
  assert.ok(maxY > startY, 'D: powered Cobra should float or climb slightly')
  assert.ok(minGravityScale < 0.75, 'D: powered high-AoA flight must engage partial gravity relief')
  assert.ok(energyCost > 100 && energyCost < 260, 'D: Cobra needs a useful but survivable energy bill')
  assert.ok(maxRecoveryPitchDownRate <= 102,
    `D: recovery must not snap past its 100deg/s cap (saw ${maxRecoveryPitchDownRate.toFixed(1)})`)
  assert.ok(recoverySeconds > 0.35 && recoverySeconds < 1.8,
    `D: recovery should sweep smoothly without becoming sluggish (took ${recoverySeconds.toFixed(2)}s)`)
  assert.ok(Math.abs(state.aoaDeg) < 18, 'D: pitch-down recovery must reattach the wing quickly')
  assert.ok(state.noseOffPathDeg < 24, 'D: recovery must hand back an aligned aircraft')
  assert.ok(state.speedKmh > run.minSpeed + 10,
    `D: full power must stop the post-stall energy bleed (min ${run.minSpeed.toFixed(0)}, exit ${state.speedKmh.toFixed(0)}, phase ${state.psmPhase})`)

  report('D arcade Cobra', `nose=${peakNose.toFixed(0)}° diverge=${peakDivergence.toFixed(0)}°`
    + ` path=${minPathPitch.toFixed(0)}..${maxPathPitch.toFixed(0)}°`
    + ` dV=${energyCost.toFixed(0)}kmh gScale=${minGravityScale.toFixed(2)}`
    + ` recovery=${recoverySeconds.toFixed(2)}s/${maxRecoveryPitchDownRate.toFixed(0)}°s`
    + ` exit=${state.aoaDeg.toFixed(1)}°/${state.speedKmh.toFixed(0)}kmh`)

  // The explicit assist is an aircraft capability rather than a script calibrated to one
  // altitude. The same chord/pull/recover sequence must remain usable across its entry band.
  const variants = [
    { speedKmh: 360, y: 250 },
    { speedKmh: 620, y: 250 },
    { speedKmh: 620, y: 815 },
  ]
  const variantResults = []
  for (const variant of variants) {
    const probe = createFlightState()
    resetFlightState(probe, new Vector3(0, variant.y, 0), variant.speedKmh, envelope, 0.5)
    probe.orientation.setFromAxisAngle(PITCH_AXIS, trimAlphaRad(variant.speedKmh))
    probe.velocity.set(variant.speedKmh * toWorld, 0, 0)
    let divergencePeak = 0
    let pathFloor = Infinity
    let sawAssist = false
    fly(probe, 5.0, (t) => {
      if (t < 0.2) return command({ psmArm: true, throttle: 0.5 })
      if (t < 0.95) return command({ psmArm: true, pitch: 1, throttle: 0.5 })
      if (t < 1.4) return command({ accelerate: true, throttle: 1 })
      if (t < 2.1) return command({ pitch: -1, accelerate: true, throttle: 1 })
      return command({ accelerate: true, throttle: 1 })
    }, (_t, sample) => {
      divergencePeak = Math.max(divergencePeak, sample.noseOffPathDeg)
      if ((sample.psmPhase === 'post-stall' || sample.psmPhase === 'cobra-hold') && _t < 1.4) {
        sawAssist = true
        pathFloor = Math.min(pathFloor, pathDeg(sample))
      }
    })
    assert.ok(sawAssist, `D: ${variant.speedKmh}kmh/${variant.y} must enter PSM`)
    assert.ok(divergencePeak > 65, `D: ${variant.speedKmh}kmh must produce a Cobra attitude`)
    assert.ok(pathFloor > -15, `D: ${variant.speedKmh}kmh PSM path must remain recoverable`)
    assert.ok(Math.abs(probe.aoaDeg) < 20, `D: ${variant.speedKmh}kmh Cobra must recover`)
    variantResults.push(`${variant.speedKmh}@${variant.y}:${divergencePeak.toFixed(0)}°`)
  }
  report('D Cobra envelope', variantResults.join('  '))
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
    Math.min(slow.maxLag, mid.maxLag, fast.maxLag) > 3,
    'E: every speed must preserve visible momentum instead of steering velocity from attitude',
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
    + ` | arcade lag 300/500/900 = ${slow.maxLag.toFixed(1)}/${mid.maxLag.toFixed(1)}`
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

// --------------------------------------- I: extended PSM pull is powerful but remains bounded
{
  const state = trimmed(520, 0.7)
  const startY = state.position.y
  let rotationDeg = 0
  let previous = state.orientation.clone()
  let sawRecovery = false
  const run = fly(state, 5.5, (t) => command({
    pitch: t < 0.2 ? 0 : t < 1.65 ? 1 : t < 2.25 ? -1 : 0,
    psmArm: t < 1.65,
    throttle: 1,
    afterburnerCommanded: true,
    burnerLevel: 1,
  }), (_t, sample) => {
    rotationDeg += MathUtils.radToDeg(previous.angleTo(sample.orientation))
    previous.copy(sample.orientation)
    sawRecovery ||= sample.psmPhase === 'recovery'
  })
  const exitPitchRate = Math.abs(MathUtils.radToDeg(state.angularVelocity.z))
  const altitudeLoss = startY - state.position.y

  assert.ok(rotationDeg > 180, 'I: holding the PSM pull must extend a Cobra toward a Kulbit')
  assert.ok(rotationDeg < 720, 'I: one armed PSM must not rotate forever')
  assert.ok(sawRecovery, 'I: pitch-down must enter assisted recovery')
  assert.ok(exitPitchRate < 35, 'I: recovery must arrest the extended rotation')
  assert.ok(Math.abs(state.aoaDeg) < 20, 'I: the extended pull must return to attached flight')
  assert.ok(520 - run.minSpeed > 100, 'I: an extended post-stall rotation must spend airspeed')
  assert.ok(altitudeLoss < 80,
    `I: arcade float must keep the recovery survivable (loss ${altitudeLoss.toFixed(0)})`)

  report('I assisted Kulbit', `rotation=${rotationDeg.toFixed(0)}°`
    + ` exitRate=${exitPitchRate.toFixed(0)}°/s loss=${altitudeLoss.toFixed(0)}`)
}

for (const line of results) console.log(line)
console.log('PASS stall checks: arcade Cobra, PSM float/recovery, energy, reverse flight')
