/*
The flight model proper: an attitude, a velocity vector, and a body rate vector that are
allowed to disagree.

The old range integrated position straight along the nose, which made angle of attack
impossible by construction. Here the nose and the flight path are separate states:

  orientation       where the airframe points
  velocity          where it is actually going (world units per second)
  angularVelocity   how fast it is rotating, in the aircraft's own axes

Aerodynamics are computed from the local airflow — velocity brought into the body frame
with the inverse quaternion — so angle of attack and sideslip are measured, never assumed.
Lift turns the flight path toward the nose only as fast as lift can, drag rises steeply
with AoA and sideslip, and the throttle keeps its familiar target-speed feel by reusing
the performance curves as the propulsive term.

Between the pilot and those forces sits an assisted flight control computer: the stick
commands body rates, the FCC scales them by control authority (dynamic pressure plus
thrust vectoring), applies AoA and G soft limits, adds weathervane stability and damping,
and chases the command with a first-order response — a PD loop on rates, never a slerp
toward a target attitude. Holding the High-AoA modifier relaxes the AoA limiter and the
velocity-alignment assist, which is what lets the jet fly a Cobra with the nose eighty
degrees off the flight path while the trajectory carries on and the speed drains away.

Axes follow the rest of the project: local +X forward, +Y up, +Z right wing. The body rate
vector uses pilot sense — x rolls right, y yaws right, z pitches up.
*/

import { Euler, MathUtils, Quaternion, Vector3 } from 'three'

import {
  readAccelerationKmhPerSecond,
  readTargetAirspeedKmh,
} from './performance'

export const FLIGHT_FIXED_STEP = 1 / 120

const FORWARD = new Vector3(1, 0, 0)
const UP = new Vector3(0, 1, 0)
const RIGHT = new Vector3(0, 0, 1)

// Module-level scratch. The model steps up to a few hundred times a second and must not
// allocate on any of them.
const inverseOrientation = new Quaternion()
const rotationStep = new Quaternion()
const rotationEuler = new Euler()
const localVelocity = new Vector3()
const worldForward = new Vector3()
const worldUp = new Vector3()
const worldRight = new Vector3()
const liftDir = new Vector3()
const sideDir = new Vector3()
const accel = new Vector3()
const pathDir = new Vector3()
const perpAccel = new Vector3()
const alignAxis = new Vector3()
const alignStep = new Quaternion()

function smooth01(value) {
  const clamped = MathUtils.clamp(value, 0, 1)
  return clamped * clamped * (3 - (2 * clamped))
}

// Frame-rate independent first-order chase.
function approach(current, target, rate, dt) {
  return current + ((target - current) * (1 - Math.exp(-rate * dt)))
}

export function createFlightState() {
  return {
    position: new Vector3(),
    orientation: new Quaternion(),
    velocity: new Vector3(),
    // Aircraft sense, rad/s: x rolls right, y yaws right, z pitches up.
    angularVelocity: new Vector3(),
    // Pilot input after smoothing — also what the control surfaces animate from.
    input: { pitch: 0, roll: 0, yaw: 0 },
    speedKmh: 0,
    thrustVectorDeg: 0,
    aoaDeg: 0,
    sideslipDeg: 0,
    gLoad: 1,
    highAoA: false,
    airBrake: false,
    maneuver: 'normal',
    // World-space accelerations of the last step, published for debug arrows and the HUD.
    liftForce: new Vector3(),
    dragForce: new Vector3(),
    thrustForce: new Vector3(),
  }
}

export function resetFlightState(state, position, speedKmh, envelope) {
  state.position.copy(position)
  state.orientation.identity()
  state.velocity.set(speedKmh / envelope.performance.kmhPerWorldUnitPerSecond, 0, 0)
  state.angularVelocity.set(0, 0, 0)
  state.input.pitch = 0
  state.input.roll = 0
  state.input.yaw = 0
  state.speedKmh = speedKmh
  state.thrustVectorDeg = 0
  state.aoaDeg = 0
  state.sideslipDeg = 0
  state.gLoad = 1
  state.highAoA = false
  state.airBrake = false
  state.maneuver = 'normal'
  state.liftForce.set(0, 0, 0)
  state.dragForce.set(0, 0, 0)
  state.thrustForce.set(0, 0, 0)
  return state
}

/*
Which named regime the jet is in, read off the physics rather than driving it. The camera,
the HUD, and the effects may all key off this; nothing in the step below ever does.
*/
function detectManeuver(state, tuning, pitchAttitudeDeg, speed, pedalMaxSpeed) {
  const alpha = Math.abs(state.aoaDeg)
  const beta = Math.abs(state.sideslipDeg)
  const yawRateDeg = Math.abs(MathUtils.radToDeg(state.angularVelocity.y))

  if (state.highAoA && alpha > 45 && beta > 14) return 'j-turn'
  if (state.highAoA && alpha > 45) return 'cobra'
  if (pitchAttitudeDeg > tuning.pedalTurnMinPitchDeg && speed < pedalMaxSpeed && yawRateDeg > 18) {
    return 'pedal-turn'
  }
  if (alpha > tuning.stallAoADeg) return 'post-stall'
  if (state.maneuver === 'post-stall' || state.maneuver === 'cobra' || state.maneuver === 'j-turn') {
    // Coming back from beyond the stall: hold the recovery label until the wing is flying
    // again, so the HUD does not flicker between states on the way down.
    if (alpha > tuning.stallAoADeg * 0.6) return 'recovery'
  }
  if (state.maneuver === 'recovery' && alpha > tuning.stallAoADeg * 0.45) return 'recovery'
  if (state.highAoA) return 'high-aoa'
  return 'normal'
}

/*
Lift coefficient shape, normalised so 1 is the pre-stall peak. Linear up to the stall,
then a smooth decay toward a post-stall floor rather than a cliff: a wing past the stall
still lifts, badly, which is what keeps post-stall flight controllable instead of a coin
toss.
*/
function liftShape(alphaRad, tuning) {
  const stall = MathUtils.degToRad(tuning.stallAoADeg)
  const magnitude = Math.abs(alphaRad)
  const sign = Math.sign(alphaRad)
  if (magnitude <= stall) return sign * (magnitude / stall)
  const past = smooth01((magnitude - stall) / (MathUtils.degToRad(85) - stall))
  return sign * MathUtils.lerp(1, tuning.postStallLiftFloor, past)
}

/*
One fixed step. `command` is the resolved pilot intent:

  { pitch, roll, yaw: -1..1, throttle: 0..1, flaps: 0..1,
    airBrake, highAoA: boolean, burnerLevel: 0..1 }

Returns nothing; mutates `state` in place.
*/
export function stepFlight(state, command, envelope, dt) {
  const tuning = envelope.maneuvering
  const toWorld = 1 / envelope.performance.kmhPerWorldUnitPerSecond

  state.highAoA = command.highAoA
  state.airBrake = command.airBrake

  // Stick shaping: the FCC never sees raw key edges.
  state.input.pitch = approach(state.input.pitch, command.pitch, tuning.inputResponse, dt)
  state.input.roll = approach(state.input.roll, command.roll, tuning.inputResponse, dt)
  state.input.yaw = approach(state.input.yaw, command.yaw, tuning.inputResponse, dt)

  const speed = state.velocity.length()
  state.speedKmh = speed / toWorld

  state.orientation.normalize()
  inverseOrientation.copy(state.orientation).invert()
  localVelocity.copy(state.velocity).applyQuaternion(inverseOrientation)
  worldForward.copy(FORWARD).applyQuaternion(state.orientation)
  worldUp.copy(UP).applyQuaternion(state.orientation)
  worldRight.copy(RIGHT).applyQuaternion(state.orientation)

  // Airflow angles from the local airstream — undefined at a standstill, so freeze them
  // below walking pace instead of letting atan2 flail on noise.
  const alphaRad = speed > 2 ? Math.atan2(-localVelocity.y, localVelocity.x) : 0
  const betaRad = speed > 2 ? Math.atan2(localVelocity.z, localVelocity.x) : 0
  state.aoaDeg = MathUtils.radToDeg(alphaRad)
  state.sideslipDeg = MathUtils.radToDeg(betaRad)

  const pitchAttitudeDeg = MathUtils.radToDeg(Math.asin(MathUtils.clamp(worldForward.y, -1, 1)))
  const alphaAbs = Math.abs(alphaRad)
  const alphaDegAbs = Math.abs(state.aoaDeg)

  // Dynamic-pressure factor: how much the air itself can do at this speed, 1 at the
  // reference speed. Every aerodynamic effect — force or stability — scales off it.
  const qFactor = (speed / tuning.referenceSpeed) ** 2

  // ---------------------------------------------------------------- control authority
  const throttlePower = MathUtils.clamp(
    (command.throttle - envelope.minThrottle) / (1 - envelope.minThrottle), 0, 1)
  // How much engine there is to vector: the core plus whatever reheat is actually alight.
  const thrustLevel = MathUtils.clamp((throttlePower * 0.75) + (command.burnerLevel * 0.5), 0, 1)

  // Surfaces earn their force from the airstream and lose most of it past the stall.
  const surfaceAuthority = MathUtils.clamp(speed / tuning.authorityRefSpeed, 0, 1)
    * (1 - (tuning.postStallSurfaceLoss
      * smooth01((alphaDegAbs - tuning.stallAoADeg) / (70 - tuning.stallAoADeg))))

  // The nozzles answer to thrust, not airspeed — which is exactly why they matter at the
  // top of a loop and in the middle of a Cobra.
  const vectorAuthority = tuning.thrustVectorEffectiveness * thrustLevel
    * (command.highAoA ? 1 : tuning.normalThrustVectorFactor)

  const pitchAuthority = MathUtils.clamp(surfaceAuthority + vectorAuthority, 0, 1)
  const rollAuthority = surfaceAuthority
    * (1 - (0.65 * smooth01((alphaDegAbs - 20) / 45)))
  // Pedal-turn window: nose high and slow, the rudders plus vectoring coupling keep a
  // usable yaw that plain airflow no longer provides. Outside the window it contributes
  // nothing, so level flight can never spin on the spot.
  const pedalWindow = smooth01((pitchAttitudeDeg - tuning.pedalTurnMinPitchDeg) / 18)
    * smooth01(((tuning.pedalTurnMaxKmh * toWorld) - speed) / (14 * toWorld * 22))
  const yawAuthority = MathUtils.clamp(
    (surfaceAuthority * 0.9) + (pedalWindow * tuning.pedalTurnYawBoost * thrustLevel * 0.4),
    0, 1.6)

  // ---------------------------------------------------------------- commanded rates
  const highAoA = command.highAoA
  const gravity = tuning.gravity

  let maxPitchRate = MathUtils.degToRad(highAoA ? tuning.highAoAPitchRateDeg : envelope.pitchRate)
  // The Cobra needs entry energy: full pitch boost only inside the speed window, fading
  // at both edges. Too slow and there is nothing to trade; too fast and the limiter would
  // let the airframe fold.
  if (highAoA) {
    const kmh = state.speedKmh
    const window = smooth01((kmh - tuning.cobraMinKmh) / 220)
      * smooth01((tuning.cobraMaxKmh - kmh) / 300)
    maxPitchRate *= 1 + ((tuning.cobraPitchBoost - 1) * window)
  }

  // G soft limit: pitch rate times speed is centripetal acceleration, so the allowed rate
  // shrinks as speed grows — the airframe pulls hard at corner speed, not at Mach 2.
  const gLimitRate = (tuning.maxG * gravity) / Math.max(speed, 10)
  const negGLimitRate = (tuning.maxNegativeG * gravity) / Math.max(speed, 10)

  let pitchCmd = state.input.pitch * maxPitchRate * pitchAuthority
  pitchCmd = MathUtils.clamp(pitchCmd, -negGLimitRate, gLimitRate)

  // AoA soft limiter: authority to raise the nose fades over the last few degrees before
  // the limit instead of hitting a wall. High-AoA mode moves the fence, it does not
  // remove it.
  const aoaLimit = highAoA ? tuning.highAoALimitDeg : tuning.normalAoALimitDeg
  const softness = tuning.aoaLimitSoftnessDeg
  if (pitchCmd > 0) {
    pitchCmd *= MathUtils.clamp((aoaLimit + softness - state.aoaDeg) / softness, 0, 1)
  } else if (pitchCmd < 0) {
    const negativeLimit = -aoaLimit * tuning.negativeAoAFactor
    pitchCmd *= MathUtils.clamp((state.aoaDeg - (negativeLimit - softness)) / softness, 0, 1)
  }

  // Weathervane stability: the airstream pushes the nose back toward the flight path in
  // both pitch and yaw. This is what decays a Cobra on its own, and relaxing it is most
  // of what the High-AoA switch actually does. The vane centres on trim AoA rather than
  // zero — the small positive angle where lift carries the weight — so hands-off flight
  // holds its altitude instead of sagging into a shallow dive.
  const noseAlign = (highAoA ? tuning.highAoANoseAlignment : tuning.noseAlignment)
    * Math.min(qFactor * 2, 1)
  const stallRad = MathUtils.degToRad(tuning.stallAoADeg)
  const trimAlpha = MathUtils.clamp(
    (gravity * stallRad) / Math.max(qFactor * tuning.liftGain, 1e-3),
    0,
    MathUtils.degToRad(8),
  ) * MathUtils.clamp(worldUp.y, 0, 1)
  pitchCmd -= (alphaRad - trimAlpha) * noseAlign

  // Post-stall recovery assist: slow, deep AoA, stick released — the FCC spends the
  // nozzles on getting the nose down rather than leaving the jet parked on its tail.
  if (state.speedKmh < tuning.recoveryMinKmh
    && alphaDegAbs > tuning.stallAoADeg
    && Math.abs(state.input.pitch) < 0.25) {
    pitchCmd -= Math.sign(alphaRad)
      * Math.min(1, (alphaDegAbs - tuning.stallAoADeg) / 25)
      * vectorAuthority * 1.6
  }

  let rollCmd = state.input.roll
    * MathUtils.degToRad(highAoA ? tuning.highAoARollRateDeg : envelope.rollRate)
    * rollAuthority
  // Weak wings-leveller, only in calm, hands-off, nose-near-level flight — it must never
  // fight a loop or a knife-edge on purpose.
  if (!highAoA && Math.abs(state.input.roll) < 0.05 && Math.abs(state.input.yaw) < 0.05) {
    const bank = Math.atan2(-worldRight.y, Math.max(worldUp.y, 0.05))
    rollCmd -= bank * tuning.autoLevelGain
      * MathUtils.clamp(1 - (Math.abs(worldForward.y) * 2.2), 0, 1)
  }

  let yawCmd = state.input.yaw * MathUtils.degToRad(envelope.yawRate) * yawAuthority
  // Sideslip weathervane — yaw is a rudder in an airstream, not a reaction wheel.
  yawCmd += betaRad * tuning.sideslipDamping * Math.min(qFactor * 2, 1)

  // Spin prevention: deep post-stall, roll and yaw commands are bled off and the rates
  // themselves damped harder, so the jet mushes instead of departing.
  const spinGuard = smooth01((alphaDegAbs - tuning.stallAoADeg) / 30)
  rollCmd *= 1 - (spinGuard * 0.55)
  yawCmd *= 1 - (spinGuard * 0.4)

  // ---------------------------------------------------------------- rate dynamics
  // First-order chase of the commanded rates — the corrective-torque loop, with the
  // response constant standing in for inertia. Extra damping while the spin guard is up.
  const w = state.angularVelocity
  const damp = 1 + (spinGuard * tuning.spinDamping)
  w.z = approach(w.z, pitchCmd, tuning.pitchResponse * damp, dt)
  w.x = approach(w.x, rollCmd, tuning.rollResponse * damp, dt)
  w.y = approach(w.y, yawCmd, tuning.yawResponse * damp, dt)

  // Body-frame integration. Pilot yaw-right is a negative rotation about local +Y.
  rotationEuler.set(w.x * dt, -w.y * dt, w.z * dt, 'XYZ')
  rotationStep.setFromEuler(rotationEuler)
  state.orientation.multiply(rotationStep).normalize()

  // The nozzles slew toward what pitch is asking of them; nothing snaps.
  const vectorTarget = state.input.pitch * tuning.maxThrustVectorDeg
    * (highAoA ? 1 : tuning.normalThrustVectorFactor) * thrustLevel
  state.thrustVectorDeg = approach(
    state.thrustVectorDeg, vectorTarget, tuning.thrustVectorResponse, dt)

  // ---------------------------------------------------------------- forces
  worldForward.copy(FORWARD).applyQuaternion(state.orientation)

  const targetKmh = readTargetAirspeedKmh(
    command.throttle, state.position.y, command.burnerLevel, envelope)

  accel.set(0, -gravity, 0)

  // Propulsion keeps the familiar excess-thrust curve, but it acts along the nose: with
  // the jet stood on its tail, full burner is fighting gravity, not feeding the airspeed
  // tape.
  let propulsion = 0
  if (targetKmh > state.speedKmh) {
    propulsion = readAccelerationKmhPerSecond(
      state.speedKmh, targetKmh, command.burnerLevel, state.position.y, envelope) * toWorld
    accel.addScaledVector(worldForward, propulsion)
  }
  state.thrustForce.copy(worldForward).multiplyScalar(propulsion)

  // Lift bends the flight path toward wherever the nose has been put — the whole reason
  // pointing and going are allowed to differ.
  pathDir.copy(state.velocity)
  const hasPath = pathDir.lengthSq() > 1e-6
  if (hasPath) pathDir.normalize()

  liftDir.copy(worldUp)
  if (hasPath) liftDir.addScaledVector(pathDir, -liftDir.dot(pathDir))
  const liftMag = qFactor * tuning.liftGain * liftShape(alphaRad, tuning)
  if (liftDir.lengthSq() > 1e-4) {
    liftDir.normalize()
    accel.addScaledVector(liftDir, liftMag)
    state.liftForce.copy(liftDir).multiplyScalar(liftMag)
  } else {
    state.liftForce.set(0, 0, 0)
  }

  // Sideslip pushes back against the slip and costs energy below.
  sideDir.copy(worldRight)
  if (hasPath) sideDir.addScaledVector(pathDir, -sideDir.dot(pathDir))
  if (sideDir.lengthSq() > 1e-4) {
    sideDir.normalize()
    accel.addScaledVector(sideDir, -betaRad * tuning.sideForceGain * qFactor)
  }

  // Drag beyond what the performance curves already price in: the coasting decay when the
  // throttle is behind the airspeed, then the punitive terms — AoA, sideslip, brake,
  // flaps. This is the energy bill for every post-stall trick; a Cobra without it would
  // be a free 180.
  let dragMag = 0
  if (targetKmh <= state.speedKmh) {
    dragMag += readAccelerationKmhPerSecond(
      state.speedKmh, targetKmh, command.burnerLevel, state.position.y, envelope) * toWorld
  }
  const sinAlpha = Math.sin(alphaAbs)
  const sinBeta = Math.sin(Math.abs(betaRad))
  dragMag += qFactor * (
    (tuning.aoaDragGain * sinAlpha * sinAlpha * (highAoA ? tuning.highAoADragMultiplier : 1))
    + (tuning.sideslipDragGain * sinBeta * sinBeta)
    + (command.airBrake ? tuning.airBrakeDrag : 0)
    + (tuning.flapsDrag * command.flaps)
  )
  if (hasPath) {
    accel.addScaledVector(pathDir, -dragMag)
    state.dragForce.copy(pathDir).multiplyScalar(-dragMag)
  }

  // ---------------------------------------------------------------- integrate velocity
  const along = hasPath ? accel.dot(pathDir) : 0
  perpAccel.copy(accel)
  if (hasPath) perpAccel.addScaledVector(pathDir, -along)

  let newSpeed = Math.max(speed + (along * dt), 0.5)
  if (hasPath) {
    // Turn rate is acceleration over speed; the floor stops the division from whipping
    // the path around at parade speeds.
    pathDir.addScaledVector(perpAccel, dt / Math.max(newSpeed, 8)).normalize()
  } else {
    pathDir.copy(worldForward)
  }

  // Velocity-alignment assist — the arcade hand on the flight path. Strong in normal
  // flight so the jet goes where it looks; nearly absent under the High-AoA switch so
  // momentum is what carries it. It stands in for aerodynamic force, so it scales with
  // dynamic pressure like one: near-stationary it must not hold the path off gravity, or
  // a tail-slide never turns back into a dive.
  const alignStrength = (highAoA ? tuning.highAoAVelocityAlignment : tuning.velocityAlignment)
    * Math.min(qFactor * 2, 1)
  alignAxis.crossVectors(pathDir, worldForward)
  const misalign = Math.asin(MathUtils.clamp(alignAxis.length(), 0, 1))
  if (misalign > 1e-4 && pathDir.dot(worldForward) > -0.9) {
    alignAxis.normalize()
    const turn = Math.min(misalign, misalign * alignStrength * dt)
    alignStep.setFromAxisAngle(alignAxis, turn)
    pathDir.applyQuaternion(alignStep)
  }

  state.velocity.copy(pathDir).multiplyScalar(newSpeed)
  state.position.addScaledVector(state.velocity, dt)
  state.speedKmh = newSpeed / toWorld

  // Load factor as the wing feels it: lift over weight, signed by AoA.
  state.gLoad = liftMag / gravity

  state.maneuver = detectManeuver(
    state, tuning, pitchAttitudeDeg, newSpeed, tuning.pedalTurnMaxKmh * toWorld)
}
