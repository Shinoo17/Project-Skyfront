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
with speed, AoA, and sideslip, and the throttle commands a spooled engine core whose
thrust is evaluated separately from that drag.

Between the pilot and those forces sits an assisted flight control computer: the stick
commands body rates, the FCC scales them by control authority (dynamic pressure plus
thrust vectoring), applies AoA and G soft limits, adds weathervane stability and damping,
and chases the command with a first-order response — a PD loop on rates, never a slerp
toward a target attitude. The AoA envelope is continuous: a full pull in the post-stall
entry-speed window progressively relaxes the limiter. There is no pilot mode switch, and
the assist stays available until the wing is flying again.

The force order is intentionally aircraft-like even though the coefficients are tuned for
an arcade map: angular motion establishes the new airframe attitude first, relative
airflow is then measured against that attitude, and lift follows the aircraft up vector.
Bank therefore tilts lift sideways and reduces its vertical component without ever issuing
a hidden pitch command or rotating velocity toward the nose.

Whether that actually happens is a question about the flight path, not the nose. A hard
enough pull reaches the same attitudes with the trajectory swinging round behind it, and
that is a loop. `pathRateDeg` is the state that tells them apart, and `detectManeuver`
is the only thing that reads it.

Axes follow the rest of the project: local +X forward, +Y up, +Z right wing. The body rate
vector uses pilot sense — x rolls right, y yaws right, z pitches up.
*/

import { Euler, MathUtils, Quaternion, Vector3 } from 'three'

import {
  readDragKmhPerSecond,
  readPropulsionKmhPerSecond,
  readThrottlePower,
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
const entryPathDir = new Vector3()

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
    // Actual dry-engine core power after spool, 0..1. The throttle is its setpoint; an
    // afterburner request temporarily drives the target through the MIL detent.
    engineCoreLevel: 0,
    speedKmh: 0,
    thrustVectorDeg: 0,
    aoaDeg: 0,
    sideslipDeg: 0,
    // How fast the flight path itself is bending, degrees per second, smoothed. This is
    // what tells a Cobra from a loop: both put the nose somewhere steep, only one leaves
    // the trajectory alone.
    pathRateDeg: 0,
    gLoad: 1,
    // Automatic envelope extension, 0..1. It rises only on a deliberate full pull in the
    // entry-energy window and remains available while the airframe recovers through stall.
    postStallBlend: 0,
    postStallActive: false,
    postStallPullArmed: true,
    postStallEntryDemand: 0,
    airBrake: false,
    maneuver: 'normal',
    // World-space accelerations of the last step, published for debug arrows and the HUD.
    liftForce: new Vector3(),
    dragForce: new Vector3(),
    thrustForce: new Vector3(),
  }
}

export function resetFlightState(
  state,
  position,
  speedKmh,
  envelope,
  throttle = envelope.idleThrottle,
) {
  state.position.copy(position)
  state.orientation.identity()
  state.velocity.set(speedKmh / envelope.performance.kmhPerWorldUnitPerSecond, 0, 0)
  state.angularVelocity.set(0, 0, 0)
  state.input.pitch = 0
  state.input.roll = 0
  state.input.yaw = 0
  state.engineCoreLevel = readThrottlePower(throttle, envelope)
  state.speedKmh = speedKmh
  state.thrustVectorDeg = 0
  state.aoaDeg = 0
  state.sideslipDeg = 0
  state.pathRateDeg = 0
  state.gLoad = 1
  state.postStallBlend = 0
  state.postStallActive = false
  state.postStallPullArmed = true
  state.postStallEntryDemand = 0
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

The Cobra test is deliberately two-sided. Deep AoA alone does not make one — a hard enough
pull reaches deep AoA on the way round a loop, with the flight path swinging along behind
the nose the whole time. What makes it a Cobra is that the trajectory carries straight on
while the nose leaves it, so `pathRateDeg` has to be low at the same time. A pull that is
past the stall but still bending the path is exactly what `post-stall` names.
*/
function detectManeuver(state, tuning, pitchAttitudeDeg, speed, pedalMaxSpeed) {
  const alpha = Math.abs(state.aoaDeg)
  const beta = Math.abs(state.sideslipDeg)
  const yawRateDeg = Math.abs(MathUtils.radToDeg(state.angularVelocity.y))
  const flying = alpha > tuning.cobraMinAoADeg && state.pathRateDeg < tuning.cobraMaxPathRateDeg

  if (state.postStallActive && flying && beta > 14) return 'j-turn'
  if (state.postStallActive && flying) return 'cobra'
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
  if (state.postStallActive) return 'aoa-assist'
  return 'normal'
}

/*
Lift coefficient shape, normalised so 1 is the pre-stall peak. Linear up to the stall,
then a smooth decay toward a post-stall floor rather than a cliff: a wing past the stall
still lifts, badly, which is what keeps post-stall flight controllable instead of a coin
toss.

The decay finishes at `postStallLiftEndDeg`, not at some angle far out past the vertical.
A wing that is still making most of its lift twenty degrees past the stall keeps bending
the flight path, and a flight path that keeps bending can only ever be a loop — the whole
Cobra depends on the lift being gone by the time the nose is properly off the airstream.
*/
function liftShape(alphaRad, tuning) {
  const stall = MathUtils.degToRad(tuning.stallAoADeg)
  const magnitude = Math.abs(alphaRad)
  const sign = Math.sign(alphaRad)
  if (magnitude <= stall) return sign * (magnitude / stall)
  const end = MathUtils.degToRad(tuning.postStallLiftEndDeg)
  const past = smooth01((magnitude - stall) / Math.max(end - stall, 1e-3))
  return sign * MathUtils.lerp(1, tuning.postStallLiftFloor, past)
}

/*
One fixed step. `command` is the resolved pilot intent:

  { pitch, roll, yaw: -1..1, throttle: 0..1, flaps: 0..1,
    airBrake: 0..1, afterburnerCommanded: boolean, burnerLevel: 0..1 }

Returns nothing; mutates `state` in place.
*/
export function stepFlight(state, command, envelope, dt) {
  const tuning = envelope.maneuvering
  const toWorld = 1 / envelope.performance.kmhPerWorldUnitPerSecond

  state.airBrake = command.airBrake > 0.05

  // Device shaping happens once in flightInput. The model sees the same continuous pilot
  // intent whether it came from keyboard ramping, a gamepad, a pointer, or the touch HUD.
  state.input.pitch = command.pitch
  state.input.roll = command.roll
  state.input.yaw = command.yaw

  const selectedCorePower = readThrottlePower(command.throttle, envelope)
  const coreTarget = command.afterburnerCommanded
    ? Math.max(selectedCorePower, envelope.afterburner.coreTarget)
    : selectedCorePower
  const coreResponse = coreTarget > state.engineCoreLevel
    ? envelope.performance.engineSpoolUpResponse
    : envelope.performance.engineSpoolDownResponse
  state.engineCoreLevel = approach(state.engineCoreLevel, coreTarget, coreResponse, dt)

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
  //
  // Alpha is an atan2 because it has to be allowed past ninety degrees: the whole point of
  // a Cobra is a nose that ends up behind its own airstream. Sideslip is the textbook
  // asin against total speed instead, because the same atan2 would read a jet flying
  // backwards as 180 degrees of slip when it is not sliding sideways at all — which puts
  // a pure-pitch Cobra into the yaw-coupled J-turn branch on nothing but a sign flip.
  const sensedAlphaRad = speed > 2 ? Math.atan2(-localVelocity.y, localVelocity.x) : 0
  const sensedBetaRad = speed > 2
    ? Math.asin(MathUtils.clamp(localVelocity.z / speed, -1, 1))
    : 0
  state.aoaDeg = MathUtils.radToDeg(sensedAlphaRad)
  state.sideslipDeg = MathUtils.radToDeg(sensedBetaRad)

  const sensedPitchAttitudeDeg = MathUtils.radToDeg(
    Math.asin(MathUtils.clamp(worldForward.y, -1, 1)),
  )
  const alphaDegAbs = Math.abs(state.aoaDeg)

  // Dynamic-pressure factor: how much the air itself can do at this speed, 1 at the
  // reference speed. Every aerodynamic effect — force or stability — scales off it.
  const qFactor = (speed / tuning.referenceSpeed) ** 2

  // ---------------------------------------------------------------- control authority
  // How much engine there is to vector: actual spooled core power plus whatever reheat is
  // alight. This can no longer claim nozzle authority from a throttle number whose engine
  // has not caught up yet.
  const thrustLevel = MathUtils.clamp(
    (state.engineCoreLevel * 0.75) + (command.burnerLevel * 0.5), 0, 1)

  // ---------------------------------------------------------- automatic AoA envelope
  // A full pull at useful entry energy asks for post-stall authority. The window makes a
  // high-speed max-performance turn remain a turn, while a low/medium-speed committed pull
  // can develop naturally into a Cobra. Once alpha is beyond the stall the extension stays
  // alive through the recovery, including forward stick, so the nozzles can bring the nose
  // back without a hidden mode button.
  const entryLow = smooth01(
    (state.speedKmh - tuning.postStallEntryMinKmh)
      / Math.max(tuning.postStallEntryFullMinKmh - tuning.postStallEntryMinKmh, 1),
  )
  const entryHigh = 1 - smooth01(
    (state.speedKmh - tuning.postStallEntryFullMaxKmh)
      / Math.max(tuning.postStallEntryMaxKmh - tuning.postStallEntryFullMaxKmh, 1),
  )
  // Entry is sampled on the edge of a committed pull, then latched while the stick stays
  // aft. A max-rate turn begun above the window therefore cannot silently become a Cobra
  // later as it bleeds through the threshold; the pilot releases and pulls again to make
  // that request. Analogue pulls below the threshold remain conventional at every speed.
  if (state.input.pitch <= tuning.postStallRearmPitchThreshold) {
    state.postStallPullArmed = true
    state.postStallEntryDemand = 0
  } else if (state.postStallPullArmed
    && state.input.pitch >= tuning.postStallPitchThreshold) {
    state.postStallPullArmed = false
    state.postStallEntryDemand = entryLow * entryHigh
  }
  const entryDemand = state.postStallEntryDemand
  const pedalDemand = smooth01((Math.abs(state.input.yaw) - 0.7) / 0.3)
    * smooth01((sensedPitchAttitudeDeg - tuning.pedalTurnMinPitchDeg) / 14)
    * (1 - smooth01(
      (state.speedKmh - tuning.pedalTurnMaxKmh * 0.78)
        / (tuning.pedalTurnMaxKmh * 0.22),
    ))
  const recovering = state.postStallBlend > 0.04
    && alphaDegAbs > tuning.stallAoADeg * tuning.postStallRecoveryAoAFactor
  const postStallTarget = Math.max(
    entryDemand,
    pedalDemand,
    recovering ? tuning.postStallRecoveryBlend : 0,
  )
  const postStallResponse = postStallTarget > state.postStallBlend
    ? tuning.postStallEngageResponse
    : tuning.postStallReleaseResponse
  state.postStallBlend = approach(
    state.postStallBlend,
    postStallTarget,
    postStallResponse,
    dt,
  )
  state.postStallActive = state.postStallBlend > tuning.postStallActiveThreshold
  const postStallBlend = state.postStallBlend

  // Surfaces earn their force from the airstream and lose most of it past the stall.
  const surfaceAuthority = MathUtils.clamp(speed / tuning.authorityRefSpeed, 0, 1)
    * (1 - (tuning.postStallSurfaceLoss
      * smooth01((alphaDegAbs - tuning.stallAoADeg) / (70 - tuning.stallAoADeg))))

  // The nozzles answer to thrust, not airspeed — which is exactly why they matter at the
  // top of a loop and in the middle of a Cobra.
  const vectorAuthority = tuning.thrustVectorEffectiveness * thrustLevel
    * MathUtils.lerp(tuning.normalThrustVectorFactor, 1, postStallBlend)

  const pitchAuthority = MathUtils.clamp(surfaceAuthority + vectorAuthority, 0, 1)
  const rollAuthority = surfaceAuthority
    * (1 - (0.65 * smooth01((alphaDegAbs - 20) / 45)))
  // Pedal-turn window: nose high and slow, the rudders plus vectoring coupling keep a
  // usable yaw that plain airflow no longer provides. Outside the window it contributes
  // nothing, so level flight can never spin on the spot.
  const pedalWindow = smooth01((sensedPitchAttitudeDeg - tuning.pedalTurnMinPitchDeg) / 18)
    * smooth01(((tuning.pedalTurnMaxKmh * toWorld) - speed) / (14 * toWorld * 22))
  const yawAuthority = MathUtils.clamp(
    (surfaceAuthority * 0.9)
      + (pedalWindow * tuning.pedalTurnYawBoost * thrustLevel * 0.4)
      + (postStallBlend * tuning.postStallYawBoost * thrustLevel),
    0,
    2.2,
  )

  // ---------------------------------------------------------------- commanded rates
  const gravity = tuning.gravity

  let maxPitchRate = MathUtils.degToRad(MathUtils.lerp(
    envelope.pitchRate,
    tuning.postStallPitchRateDeg,
    postStallBlend,
  ))
  // The Cobra needs entry energy: full pitch boost only inside the speed window, fading
  // at both edges. Too slow and there is nothing to trade; too fast and the limiter would
  // let the airframe fold.
  if (postStallBlend > 0) {
    const kmh = state.speedKmh
    const window = smooth01((kmh - tuning.cobraMinKmh) / 220)
      * smooth01((tuning.cobraMaxKmh - kmh) / 300)
    maxPitchRate *= 1 + ((tuning.cobraPitchBoost - 1) * window * postStallBlend)
  }

  // G soft limit: pitch rate times speed is centripetal acceleration, so the allowed rate
  // shrinks as speed grows — the airframe pulls hard at corner speed, not at Mach 2.
  const gLimitRate = (tuning.maxG * gravity) / Math.max(speed, 10)
  const negGLimitRate = (tuning.maxNegativeG * gravity) / Math.max(speed, 10)

  let pitchCmd = state.input.pitch * maxPitchRate * pitchAuthority
  pitchCmd = MathUtils.clamp(pitchCmd, -negGLimitRate, gLimitRate)

  // AoA soft limiter: authority to raise the nose fades over the last few degrees before
  // the limit instead of hitting a wall. Automatic envelope extension moves the fence; it
  // never removes it.
  const maxPerformancePull = smooth01(
    (Math.abs(state.input.pitch) - tuning.performancePullThreshold)
      / Math.max(1 - tuning.performancePullThreshold, 1e-3),
  )
  const conventionalLimit = MathUtils.lerp(
    tuning.normalAoALimitDeg,
    tuning.performanceAoALimitDeg,
    maxPerformancePull,
  )
  const aoaLimit = MathUtils.lerp(
    conventionalLimit,
    tuning.postStallAoALimitDeg,
    postStallBlend,
  )
  const softness = tuning.aoaLimitSoftnessDeg
  if (pitchCmd > 0) {
    pitchCmd *= MathUtils.clamp((aoaLimit + softness - state.aoaDeg) / softness, 0, 1)
  } else if (pitchCmd < 0) {
    const negativeLimit = -aoaLimit * tuning.negativeAoAFactor
    pitchCmd *= MathUtils.clamp((state.aoaDeg - (negativeLimit - softness)) / softness, 0, 1)
  }

  // Centred-stick post-stall recovery points the nose back toward the airstream. It never
  // overwrites a deliberate pilot command, so unusual attitudes remain flyable; releasing
  // the stick is the simple, learnable request to make the wing fly again. The correction
  // is a rate demand and still pays the available surface/vector authority below.
  const recoveryNeed = smooth01(
    (alphaDegAbs - (tuning.stallAoADeg * 1.1)) / tuning.postStallRecoveryRangeDeg,
  )
  const centredStick = 1 - smooth01(
    Math.abs(state.input.pitch) / tuning.postStallRecoveryStickThreshold,
  )
  pitchCmd -= Math.sign(sensedAlphaRad)
    * MathUtils.degToRad(tuning.postStallRecoveryPitchRateDeg)
    * recoveryNeed
    * centredStick
    * postStallBlend
    * pitchAuthority

  let rollCmd = state.input.roll
    * MathUtils.degToRad(MathUtils.lerp(
      envelope.rollRate,
      tuning.postStallRollRateDeg,
      postStallBlend,
    ))
    * rollAuthority
  let yawCmd = state.input.yaw * MathUtils.degToRad(envelope.yawRate) * yawAuthority
  // Sideslip weathervane — yaw is a rudder in an airstream, not a reaction wheel.
  yawCmd += sensedBetaRad * tuning.sideslipDamping * Math.min(qFactor * 2, 1)

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
    * MathUtils.lerp(tuning.normalThrustVectorFactor, 1, postStallBlend) * thrustLevel
  state.thrustVectorDeg = approach(
    state.thrustVectorDeg, vectorTarget, tuning.thrustVectorResponse, dt)

  // ------------------------------------------------------ attitude -> relative airflow
  // Angular motion owns orientation. Only after integrating it do the force calculations
  // sample the aircraft axes and local airflow used by this step. This prevents a one-step
  // mismatch where fresh orientation was paired with stale AoA or stale lift direction.
  worldForward.copy(FORWARD).applyQuaternion(state.orientation)
  worldUp.copy(UP).applyQuaternion(state.orientation)
  worldRight.copy(RIGHT).applyQuaternion(state.orientation)
  inverseOrientation.copy(state.orientation).invert()
  localVelocity.copy(state.velocity).applyQuaternion(inverseOrientation)

  const alphaRad = speed > 2 ? Math.atan2(-localVelocity.y, localVelocity.x) : 0
  const betaRad = speed > 2
    ? Math.asin(MathUtils.clamp(localVelocity.z / speed, -1, 1))
    : 0
  state.aoaDeg = MathUtils.radToDeg(alphaRad)
  state.sideslipDeg = MathUtils.radToDeg(betaRad)
  const pitchAttitudeDeg = MathUtils.radToDeg(
    Math.asin(MathUtils.clamp(worldForward.y, -1, 1)),
  )
  const alphaAbs = Math.abs(alphaRad)

  // ---------------------------------------------------------------- forces

  accel.set(0, -gravity, 0)

  // Engine thrust is always present and always acts along the nose. Speed limits now
  // emerge where this force meets drag rather than from a controller cutting propulsion
  // at a target airspeed. Stood on its tail, full burner fights gravity instead of feeding
  // the airspeed tape.
  const propulsion = readPropulsionKmhPerSecond(
    state.engineCoreLevel, command.burnerLevel, envelope) * toWorld
  accel.addScaledVector(worldForward, propulsion)
  state.thrustForce.copy(worldForward).multiplyScalar(propulsion)

  // Lift is the aircraft-up axis projected perpendicular to the relative wind. Banking
  // rotates this vector with the airframe, so its vertical share falls naturally (roughly
  // L*cos(bank) in level flight) while the remainder bends the path sideways. No bank
  // angle is hardcoded and no pitch attitude is changed to manufacture the descent.
  pathDir.copy(state.velocity)
  const hasPath = pathDir.lengthSq() > 1e-6
  if (hasPath) pathDir.normalize()
  // Held so the step can measure how far it moved the trajectory, further down.
  entryPathDir.copy(pathDir)

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

  // Parasite and wave drag are present at every throttle setting. The AoA-squared term is
  // the compressed induced-drag bill: more pull makes more lift/G and spends more energy.
  // Sideslip, brake, and flaps add their own penalties; a Cobra without them would still
  // be a free 180.
  let dragMag = readDragKmhPerSecond(
    state.speedKmh, state.position.y, envelope) * toWorld
  const sinAlpha = Math.sin(alphaAbs)
  const sinBeta = Math.sin(Math.abs(betaRad))
  dragMag += qFactor * (
    (tuning.aoaDragGain * sinAlpha * sinAlpha
      * MathUtils.lerp(1, tuning.postStallDragMultiplier, postStallBlend))
    + (tuning.sideslipDragGain * sinBeta * sinBeta)
    + (tuning.airBrakeDrag * command.airBrake)
    + (tuning.flapsDrag * command.flaps)
  )
  if (hasPath) {
    accel.addScaledVector(pathDir, -dragMag)
    state.dragForce.copy(pathDir).multiplyScalar(-dragMag)
  }

  // ---------------------------------------------------------------- integrate velocity
  // Forces change the velocity vector directly. There is deliberately no later alignment
  // rotation toward the nose: lift, thrust, gravity, and drag are the only things allowed
  // to bend the flight path, preserving sideslips, nose-high descents, and inertial moves.
  state.velocity.addScaledVector(accel, dt)
  let newSpeed = state.velocity.length()
  if (newSpeed < 0.5) {
    state.velocity.copy(hasPath ? entryPathDir : worldForward).multiplyScalar(0.5)
    newSpeed = 0.5
  }
  pathDir.copy(state.velocity).normalize()
  state.position.addScaledVector(state.velocity, dt)
  state.speedKmh = newSpeed / toWorld

  // How far this step actually bent the trajectory. Smoothed, because a single fixed step
  // of it is a very small angle and the regimes read off it should not chatter.
  if (hasPath) {
    const pathTurn = Math.acos(MathUtils.clamp(entryPathDir.dot(pathDir), -1, 1))
    state.pathRateDeg = approach(
      state.pathRateDeg, MathUtils.radToDeg(pathTurn) / dt, tuning.pathRateResponse, dt)
  }

  // Load factor as the wing feels it: lift over weight, signed by AoA.
  state.gLoad = liftMag / gravity

  state.maneuver = detectManeuver(
    state, tuning, pitchAttitudeDeg, newSpeed, tuning.pedalTurnMaxKmh * toWorld)
}
