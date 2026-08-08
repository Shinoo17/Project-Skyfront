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
toward a target attitude.

Both weathervanes are the airstream's own moments and neither is scaled by control
authority, because neither is a control surface. Yaw's has always been here. Pitch's is
newer and exists because the alpha fence alone was not one: the fence stops the FCC
*commanding* more nose-up, but with nothing pushing back, a held stick could park the nose
at thirty degrees with the pitch rate measurably at zero while gravity swung the flight
path all the way round behind it, and the jet would sit at 180 degrees of alpha flying
tail-first for two seconds. The moment is scheduled to arrive past the beam rather than at
the stall, so it leaves the Cobra — which is a vectored fighter genuinely holding the nose
off the airstream, and is the aircraft's signature — entirely alone.

The FCC has no modes. It used to: a full-aft stick inside an entry-speed window latched a
post-stall envelope in behind the conventional one, which meant the same stick produced a
27-degree pull at 250 km/h, a 93-degree one at 350 and a 10-degree one at 1000, and the
aircraft changed character on a threshold instead of on the physics. What is left in its
place is two continuous numbers, both recomputed every step and neither with any memory:

  thinAir      how little the airstream can still enforce, from dynamic pressure alone
  commitment   how far past the max-performance detent the stick is

Their product is how far the envelope is open. Deliberately absent from both is the
current angle of attack — a limit that widens because alpha grew feeds itself and is a
latch with better manners. So a Cobra is not a state the aircraft enters. It is what a
committed pull does when there is no longer enough air over the tail to argue with the
nozzles, and the same stick at the same speed with less conviction is a hard turn.

Control authority follows dynamic pressure rather than speed, and the rate response is
scaled by it as well: the airframe's mass does not change with airspeed, only the moment
available to accelerate it, so thin air takes its time reaching a rate and takes the same
time shedding it. Underneath sits a floor for the FCS rate loop, which is a gyro and a
nozzle and does not ask what the airspeed is.

The force order is intentionally aircraft-like even though the coefficients are tuned for
an arcade map: angular motion establishes the new airframe attitude first, relative
airflow is then measured against that attitude, and lift follows the aircraft up vector.
Bank therefore tilts lift sideways and reduces its vertical component without ever issuing
a hidden pitch command or rotating velocity toward the nose.

Whether that actually happens is a question about the flight path, not the nose. A hard
enough pull reaches the same attitudes with the trajectory swinging round behind it, and
that is a loop. `pathRateDeg` is the state that tells them apart, and `detectManeuver`
is the only thing that reads it.

Held rather than released, that same pull is the tumble: past the beam the weathervane
drops to a floor, the nose keeps going over the top and round past the tail, and the roll
axis keeps a nozzle-fed share of its authority so the airframe can be pointed somewhere on
the way out. The floor, the share, and the ceiling the pitch rate is allowed to reach in
thin air are the arcade half of this model — an F-22's nozzles vector in pitch only and
would not roll it at all — and they are marked as such where they are read.

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
    // Signed speed along the nose. Unlike `speedKmh`, this goes negative in a tailslide.
    forwardSpeedKmh: 0,
    backwardFlight: false,
    thrustVectorDeg: 0,
    aoaDeg: 0,
    sideslipDeg: 0,
    // How fast the flight path itself is bending, degrees per second, smoothed. This is
    // what tells a Cobra from a loop: both put the nose somewhere steep, only one leaves
    // the trajectory alone.
    pathRateDeg: 0,
    gLoad: 1,
    /*
    The two continuous stall numbers, both measured from alpha and both read by the HUD and
    the vapour effect rather than by anything inside the model.

      stallBlend      0 in ordinary flight, 1 at the stall — the approach to it
      postStallBlend  0 at the stall, 1 well past it — how separated the wing already is

    Together they are the whole progression, with no threshold anywhere in it: normal flight,
    high AoA, stall onset, stall, post-stall. There is no state to be in.
    */
    stallBlend: 0,
    postStallBlend: 0,
    postStallActive: false,
    // Read-only descriptions for telemetry. Physics remains continuously blended and does
    // not branch on this label.
    flightRegime: 'normal',
    // Strength of the deterministic, hands-off falling-leaf oscillation, 0..1.
    departureBlend: 0,
    departurePhase: 0,
    /*
    The two control authorities, published separately because they answer to different
    things and a pilot needs to see which one is left.

      aeroAuthority    what the surfaces can still do, from dynamic pressure and separation
      vectorAuthority  what the nozzles can still do, from engine thrust

    At idle and low speed both are small. At idle and high speed only the first is there. In
    a Cobra under power only the second is.
    */
    aeroAuthority: 0,
    vectorAuthority: 0,
    // Where the aircraft is going versus where it is pointing: flight path angle in degrees,
    // and the total angle between the nose and the velocity vector. The second is the whole
    // premise of the model in one number — it is free to be large.
    flightPathDeg: 0,
    noseOffPathDeg: 0,
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
  state.forwardSpeedKmh = speedKmh
  state.backwardFlight = false
  state.thrustVectorDeg = 0
  state.aoaDeg = 0
  state.sideslipDeg = 0
  state.pathRateDeg = 0
  state.gLoad = 1
  state.stallBlend = 0
  state.postStallBlend = 0
  state.postStallActive = false
  state.flightRegime = 'normal'
  state.departureBlend = 0
  state.departurePhase = 0
  state.aeroAuthority = 0
  state.vectorAuthority = 0
  state.flightPathDeg = 0
  state.noseOffPathDeg = 0
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

  // A tailslide is axial reverse flight, not merely a very large alpha reading. It gets
  // first refusal because the same 180-degree airflow can otherwise look like a tumble.
  if (pitchAttitudeDeg > tuning.tailslideMinPitchDeg
    && state.noseOffPathDeg > tuning.tailslideMinNoseOffDeg
    && state.forwardSpeedKmh < -tuning.tailslideMinReverseKmh
    && state.speedKmh < tuning.tailslideMaxKmh) {
    return 'tailslide'
  }

  /*
  The tumble sits above the Cobra because it satisfies the Cobra test on its way past: deep
  alpha with the trajectory left alone describes both. What separates them is that a Cobra
  is a nose held somewhere and a tumble is a nose still going, so the extra term is a pitch
  rate that has not stopped.

  It reads `noseOffPathDeg` rather than alpha, and that is not a style choice. Alpha is an
  atan2 and wraps at the beam — the nose passing straight over the top takes it from +179 to
  -179 — while the nose-off-path angle is an acos of a dot product, runs 0 to 180, and does
  not care which side of the airstream the airframe came round.
  */
  const pitchRateDeg = Math.abs(MathUtils.radToDeg(state.angularVelocity.z))
  // The rate test is an entry condition only, held afterwards on the nose-off-path angle
  // alone. Rolling the airframe mid-tumble takes the pitch rate below the threshold for as
  // long as the roll lasts — which is the middle of the manoeuvre, and a caption that drops
  // out there and comes back reads as the aircraft having stopped doing it.
  if (flying && state.noseOffPathDeg > tuning.tumbleMinNoseOffDeg
    && (pitchRateDeg > tuning.tumbleMinPitchRateDeg || state.maneuver === 'tumble')) {
    return 'tumble'
  }
  if (state.postStallActive && flying && beta > tuning.jTurnMinSideslipDeg) return 'j-turn'
  if (state.postStallActive && flying) return 'cobra'
  if (state.departureBlend > tuning.fallingLeafLabelThreshold) return 'falling-leaf'
  if (state.postStallActive
    && state.speedKmh < tuning.flatTurnMaxKmh
    && yawRateDeg > tuning.flatTurnMinYawRateDeg) return 'flat-turn'
  if (pitchAttitudeDeg > tuning.pedalTurnMinPitchDeg && speed < pedalMaxSpeed
    && yawRateDeg > tuning.pedalTurnMinYawRateDeg) {
    return 'pedal-turn'
  }
  if (alpha > tuning.stallAoADeg) return 'post-stall'
  if (state.maneuver === 'post-stall' || state.maneuver === 'cobra'
    || state.maneuver === 'j-turn' || state.maneuver === 'tumble') {
    // Coming back from beyond the stall: hold the recovery label until the wing is flying
    // again, so the HUD does not flicker between states on the way down.
    if (alpha > tuning.stallAoADeg * tuning.recoveryLabelEnterFactor) return 'recovery'
  }
  if (state.maneuver === 'recovery'
    && alpha > tuning.stallAoADeg * tuning.recoveryLabelHoldFactor) return 'recovery'
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
  state.forwardSpeedKmh = localVelocity.x / toWorld
  state.backwardFlight = state.forwardSpeedKmh < -tuning.backwardFlightThresholdKmh

  const airflowSenseSpeed = tuning.airflowSenseMinKmh * toWorld
  // At the exact apex airflow angles are undefined. Keep the last coherent reading through
  // that very short window instead of snapping the HUD/FCC to zero, then reacquire as soon
  // as gravity establishes a direction again.
  const sensedAlphaRad = speed > airflowSenseSpeed
    ? Math.atan2(-localVelocity.y, localVelocity.x)
    : MathUtils.degToRad(state.aoaDeg)
  const sensedBetaRad = speed > airflowSenseSpeed
    ? Math.asin(MathUtils.clamp(localVelocity.z / speed, -1, 1))
    : MathUtils.degToRad(state.sideslipDeg)
  state.aoaDeg = MathUtils.radToDeg(sensedAlphaRad)
  state.sideslipDeg = MathUtils.radToDeg(sensedBetaRad)

  const sensedPitchAttitudeDeg = MathUtils.radToDeg(
    Math.asin(MathUtils.clamp(worldForward.y, -1, 1)),
  )
  const alphaDegAbs = Math.abs(state.aoaDeg)
  const separation = smooth01(
    (alphaDegAbs - tuning.stallAoADeg) / tuning.postStallDisplayRangeDeg,
  )

  // Dynamic-pressure factor: how much the air itself can do at this speed, 1 at the
  // reference speed. Every aerodynamic effect — force or stability — scales off it.
  const qFactor = (speed / tuning.referenceSpeed) ** 2

  // ---------------------------------------------------------------- control authority
  // How much engine there is to vector: actual spooled core power plus whatever reheat is
  // alight. This can no longer claim nozzle authority from a throttle number whose engine
  // has not caught up yet.
  const thrustLevel = MathUtils.clamp(
    (state.engineCoreLevel * tuning.coreThrustShare)
      + (command.burnerLevel * tuning.reheatThrustShare), 0, 1)

  // ------------------------------------------------------------------- thin air
  /*
  One continuous measure of how little the airstream is able to do: 0 at fighting speed,
  1 where the wing has effectively stopped voting and the nozzles are the only thing with
  an opinion about where the nose points.

  This replaces the post-stall *mode* the model used to run. That mode sampled a speed
  window on the leading edge of a full-aft stick, latched the result, and blended a second
  set of limits in behind it — so the same stick produced a 27-degree pull at 250 km/h, a
  93-degree one at 350, and a 10-degree one at 1000. The discontinuity was the point of
  the design and it was also the thing that felt wrong: the aircraft changed character on
  a threshold rather than on the physics.

  Thin air is a function of dynamic pressure and of nothing else. Not of stick position,
  not of throttle, not of the current angle of attack — a limit that widens because alpha
  grew is a latch with better manners, and it would snap open the moment it was touched.
  Everything the mode used to switch on now reads off this one number, so a Cobra is not a
  state the aircraft enters; it is what a hard pull does when there is no longer enough
  air over the tail to argue with the nozzles.
  */
  const thinAir = 1 - smooth01(
    (state.speedKmh - tuning.thinAirFullKmh)
      / Math.max(tuning.thinAirNoneKmh - tuning.thinAirFullKmh, 1),
  )


  // Surfaces earn their force from the airstream and lose most of it past the stall.
  //
  // Control power follows dynamic pressure, so this is a power law rather than the linear
  // ramp it used to be: a surface at a quarter of its reference speed has nothing like a
  // quarter of its authority. The exponent sits between linear and the textbook square
  // because the compressed range spans eight times the speed end to end, and a true q law
  // across that would leave the jet dead everywhere below fighting speed while making no
  // difference at all above it.
  const surfaceAuthority = MathUtils.clamp(
    (speed / tuning.authorityRefSpeed) ** tuning.authorityExponent, 0, 1,
  )
    * (1 - (tuning.postStallSurfaceLoss
      * smooth01((alphaDegAbs - tuning.stallAoADeg)
        / (tuning.surfaceLossFullAoADeg - tuning.stallAoADeg))))

  // The nozzles answer to thrust, not airspeed — which is exactly why they matter at the
  // top of a loop and in the middle of a Cobra. The FCC lets them out further as the air
  // thins, because that is where the tail has stopped being able to do the job on its own.
  const vectorAuthority = tuning.thrustVectorEffectiveness * thrustLevel
    * MathUtils.lerp(tuning.normalThrustVectorFactor, 1, thinAir)

  // The two are published separately as well as summed: a pilot losing the surfaces while
  // the nozzles hold is in a different aircraft from one losing both.
  state.aeroAuthority = surfaceAuthority
  state.vectorAuthority = vectorAuthority

  const pitchAuthority = MathUtils.clamp(surfaceAuthority + vectorAuthority, 0, 1)
  /*
  Roll has the same two contributors pitch and yaw do, and for the same reason. The
  surfaces shed authority against alpha faster than anything else — the ailerons are out at
  the wingtips, which is where the flow breaks down first — so in thin air at deep alpha
  what is left is the engines: differential tail deflection working in the jet efflux, plus
  whatever the nozzles can be persuaded to contribute.

  That last part is an arcade licence rather than an F-22: the real nozzles vector in pitch
  only and cannot roll the airframe at all. It is here because rolling the nose around the
  flight path is what turns a Cobra from a party trick into something a pilot points
  somewhere, and without it a full deflection past the stall buys about three degrees of
  bank a second. The ceiling below is the same stacking ceiling `maxYawAuthority` is.

  Both terms are scheduled on the same number, and it has to be that way round: the engines
  pick up precisely what the wingtips shed, so the boost is worth nothing at the incidence
  ordinary flight is trimmed at. Gated on thin air alone it would have been worth
  everything there — 400 km/h in reheat is thin air by this model's reckoning whatever the
  alpha is, and the jet would have rolled faster slow than fast, which is the turntable
  `authorityExponent` was rewritten to stop.

  Only `surfaceAuthority` reaches `state.aeroAuthority` — that number answers for the
  surfaces, and a nozzle contribution published under it would tell the pilot the wing was
  still working.
  */
  const rollShed = smooth01(
    (alphaDegAbs - tuning.rollAuthorityOnsetDeg) / tuning.rollAuthorityRangeDeg,
  )
  const rollAuthority = MathUtils.clamp(
    (surfaceAuthority * (1 - (tuning.rollAuthorityAoALoss * rollShed)))
      + (thinAir * tuning.postStallRollBoost * thrustLevel * rollShed),
    0,
    tuning.maxRollAuthority,
  )
  // Pedal-turn window: nose high and slow, the rudders plus vectoring coupling keep a
  // usable yaw that plain airflow no longer provides. Outside the window it contributes
  // nothing, so level flight can never spin on the spot.
  const pedalWindow = smooth01(
    (sensedPitchAttitudeDeg - tuning.pedalTurnMinPitchDeg) / tuning.pedalTurnPitchBlendDeg,
  )
    * smooth01(
      ((tuning.pedalTurnMaxKmh * toWorld) - speed) / (tuning.pedalTurnSpeedBlendKmh * toWorld),
    )
  const noseHighYawWindow = smooth01(
    (sensedPitchAttitudeDeg - tuning.postStallYawMinPitchDeg)
      / tuning.postStallYawPitchBlendDeg,
  )
  const yawAuthority = MathUtils.clamp(
    (surfaceAuthority * tuning.yawSurfaceShare)
      + (pedalWindow * tuning.pedalTurnYawBoost * thrustLevel * tuning.pedalTurnYawShare)
      + (thinAir * tuning.postStallYawBoost * thrustLevel
        * Math.max(separation, noseHighYawWindow)),
    0,
    tuning.maxYawAuthority,
  )

  // ---------------------------------------------------------------- commanded rates
  const gravity = tuning.gravity

  /*
  How far the envelope is open, 0..1. Two continuous factors and nothing else:

    thinAir            how little the airstream can still enforce
    commitment         how far past the max-performance detent the stick is

  Both are read fresh every step. Neither latches, neither samples an entry condition, and
  neither is a function of the alpha the envelope goes on to allow — a fence that widens
  because alpha grew would open itself the first time it was touched.

  Commitment is what lets a Split-S and a Cobra pass through the same airspeed and come out
  as different manoeuvres, without either of them being a mode. A three-quarter pull is a
  hard turn at any speed. A pull held against the stops is a request for everything the
  airframe has, and in thin air everything the airframe has is the nozzles.
  */
  const commitment = smooth01(
    (Math.abs(state.input.pitch) - tuning.performancePullThreshold)
      / Math.max(1 - tuning.performancePullThreshold, 1e-3),
  )
  const envelopeOpen = thinAir * commitment

  // The nose can be swung much faster in thin air than in thick, and for a reason that is
  // not a concession to the manoeuvre: at fighting speed the ceiling is the airframe's
  // structural pitch rate, while down where the nozzles are doing the work there is very
  // little inertia in the airstream resisting them. This is what used to require a Cobra
  // speed window and an entry latch to reach.
  const maxPitchRate = MathUtils.degToRad(MathUtils.lerp(
    envelope.pitchRate,
    tuning.postStallPitchRateDeg,
    envelopeOpen,
  ))

  /*
  G soft limit: pitch rate times speed is centripetal acceleration, so the allowed rate
  shrinks as speed grows — the airframe pulls hard at corner speed, not at Mach 2.

  The identity behind that only holds while the wing is the thing turning the aircraft. Past
  the stall it is not: the nose swinging round on the nozzles bends the flight path barely at
  all, which is the whole premise of the manoeuvres this model exists for, and a rate cap
  derived from a load factor the airframe is not pulling is a cap on nothing but the
  animation. Left in, it was the binding constraint on a tumble — a flip that should take
  three quarters of a second took nearly two, and the airframe spent the difference broadside
  to the airstream, arriving at the far side with no energy left to fly out on.

  So the ceiling relaxes toward the pitch rate the envelope already allows, on the same
  `envelopeOpen` everything else here reads: at fighting speed it is the structural limit and
  it bites, and it stops applying exactly where it stops describing anything.
  */
  const gLimitRate = MathUtils.lerp(
    (tuning.maxG * gravity) / Math.max(speed, 10),
    maxPitchRate,
    envelopeOpen,
  )
  // Only the pull side is relaxed. `commitment` inside `envelopeOpen` is the absolute stick
  // position, so a bunt reads exactly as committed as a pull does — and the rest of the
  // model does not agree that it is: the weathervane concession above is deliberately
  // pull-only, and a nose-down rate ceiling lifted to match would be authority granted to a
  // manoeuvre nothing else here supports.
  const negGLimitRate = (tuning.maxNegativeG * gravity) / Math.max(speed, 10)

  let pitchCmd = state.input.pitch * maxPitchRate * pitchAuthority
  pitchCmd = MathUtils.clamp(pitchCmd, -negGLimitRate, gLimitRate)

  /*
  AoA soft limiter: authority to move the nose fades over the last few degrees before the
  limit instead of hitting a wall.

  The fence is a function of dynamic pressure and of the stick, never of the current alpha.
  That ordering matters — a limit that widens because alpha grew feeds back into itself and
  is a latch by another name. At fighting speed the limit is the conventional one, and it
  is a real one: the reasons a fast jet is not allowed to 30 degrees of alpha are
  structural and they do not go away. As the air thins those reasons go away with it, the
  fence opens toward the airframe's true aerodynamic limit, and nothing announces itself.
  */
  const conventionalLimit = MathUtils.lerp(
    tuning.normalAoALimitDeg,
    tuning.performanceAoALimitDeg,
    commitment,
  )
  const aoaLimit = MathUtils.lerp(
    conventionalLimit,
    tuning.postStallAoALimitDeg,
    envelopeOpen,
  )
  const softness = tuning.aoaLimitSoftnessDeg
  if (pitchCmd > 0) {
    pitchCmd *= MathUtils.clamp((aoaLimit + softness - state.aoaDeg) / softness, 0, 1)
  } else if (pitchCmd < 0) {
    const negativeLimit = -aoaLimit * tuning.negativeAoAFactor
    pitchCmd *= MathUtils.clamp((state.aoaDeg - (negativeLimit - softness)) / softness, 0, 1)
  }

  // Centred-stick recovery points the nose back toward the airstream. It never overwrites
  // a deliberate pilot command, so unusual attitudes remain flyable; releasing the stick is
  // the simple, learnable request to make the wing fly again. The correction is a rate
  // demand and still pays the available surface/vector authority below.
  //
  // It is gated on measured alpha and on the stick, and on nothing else. It used to carry a
  // post-stall blend factor as well, which meant the one thing that recovers a departure
  // was only available inside the mode the departure was supposed to have entered.
  const recoveryNeed = smooth01(
    (alphaDegAbs - (tuning.stallAoADeg * tuning.postStallRecoveryOnsetFactor))
      / tuning.postStallRecoveryRangeDeg,
  )
  const centredStick = 1 - smooth01(
    Math.abs(state.input.pitch) / tuning.postStallRecoveryStickThreshold,
  )
  pitchCmd -= Math.sign(sensedAlphaRad)
    * MathUtils.degToRad(tuning.postStallRecoveryPitchRateDeg)
    * recoveryNeed
    * centredStick
    * pitchAuthority

  /*
  Longitudinal weathervane: the airstream's own restoring moment about the pitch axis.

  The yaw axis has had this all along, a few lines below as `sideslipDamping`. Pitch had
  nothing, and the asymmetry showed. The alpha fence stops the FCC *commanding* more nose-up
  once the limit is reached, but nothing pushed back, so with the stick held aft the nose
  would park — measurably at zero pitch rate — while gravity took the flight path all the way
  round behind it. The jet sat at 180 degrees of alpha, flying tail-first for a couple of
  seconds, because at that point there was no moment left in the model to argue with it.

  sin(alpha) is the moment shape: strongest with the airstream square onto the airframe,
  vanishing as the nose lines up with it, and correctly signed on both sides of zero so it
  restores from either direction. The argument is clamped at ninety degrees so that past the
  beam the moment saturates rather than decaying back toward zero — an unclamped sine makes
  tail-first flight its own equilibrium, which is precisely the state that needed fixing, and
  a tail that is square to the airstream at 90 degrees is no less immersed at 140.

  It is deliberately not scaled by `pitchAuthority` — this is the air acting on the airframe,
  not a surface the FCC commands, and it is the one pitch term a held stick cannot switch off.
  It is what makes the alpha fence a fence rather than merely the point at which the FCC stops
  helping.

  Two things decide where it is allowed to act, and both are deliberate.

  It reads zero below its onset, because an airframe is trimmed to fly at a non-zero
  incidence: a restoring moment proportional to raw alpha is not stability, it is a permanent
  nose-down mistrim, and applied from zero it works out at about seven degrees a second of
  uncommanded pitch-down in an 800 km/h cruise.

  The onset then sits past the deep-AoA band rather than at the stall, which is what keeps
  this from quietly deleting the manoeuvres it has no business touching. Between the stall and
  the beam a vectored fighter genuinely can hold the nose off the airstream — that is the
  Cobra, and it is the aircraft's signature. Past the beam it cannot: the airframe is broadside
  or backwards to the flow, every surface and nozzle is working in its wake, and no amount of
  held stick is a match for the moment the airstream is making. So the term is scheduled to
  come in exactly across the region where control power stops being the larger of the two.

  The gain is calibrated where the term does its work — deep alpha at a couple of hundred
  km/h, where the dynamic-pressure factor is a few per cent and the restoring rate lands
  around seventy degrees a second. The same gain with that factor saturated would ask for
  something absurd, so the result is capped at a real pitch rate. The cap is inactive at every
  condition the checks reach; it is here so that no combination of alpha and airspeed can turn
  a stabilising term into a catapult.
  */
  /*
  ...with one thing that can lean on it: a pull held against the stops.

  Past the beam the moment above is what stops the nose, and stopping the nose is exactly
  what a tumble may not have happen — the manoeuvre is the nose carrying on over the top
  and round while the flight path runs on underneath it. So a committed pull scales the
  restoring moment down toward a floor. Not to zero, and the difference matters: at the
  floor the airstream still argues, tail-first is still not an equilibrium, and the pilot is
  spending real authority to hold the rotation rather than being handed it. Release and the
  moment comes back whole, which makes the control the same one the rest of the model
  teaches — hold it to tumble, let go to recover.

  It reads the signed stick and not `commitment`, which is the absolute value. Full forward
  stick is a bunt, not a tumble, and softening the weathervane there would build the mirror
  of the bug this term exists to fix on the negative-alpha side.
  */
  const pullCommitment = smooth01(
    (state.input.pitch - tuning.performancePullThreshold)
      / Math.max(1 - tuning.performancePullThreshold, 1e-3),
  )
  const weathervaneNeed = smooth01(
    (alphaDegAbs - tuning.pitchWeathervaneOnsetDeg) / tuning.pitchWeathervaneRangeDeg,
  ) * MathUtils.lerp(1, tuning.pitchWeathervaneTumbleFloor, pullCommitment)
  const weathervaneRate = MathUtils.clamp(
    Math.sin(MathUtils.clamp(sensedAlphaRad, -Math.PI / 2, Math.PI / 2))
      * tuning.pitchWeathervane
      * weathervaneNeed
      * Math.min(qFactor * tuning.weathervaneQScale, 1),
    -MathUtils.degToRad(tuning.pitchWeathervaneMaxRateDeg),
    MathUtils.degToRad(tuning.pitchWeathervaneMaxRateDeg),
  )
  pitchCmd -= weathervaneRate

  // Thin air alone, never `envelopeOpen`: commitment is a reading of the *pitch* stick, and
  // the roll rate the airframe can hold has nothing to do with how hard the pilot is
  // pulling. `rollAuthority` above already sheds the rest of it against alpha.
  let rollCmd = state.input.roll
    * MathUtils.degToRad(MathUtils.lerp(
      envelope.rollRate,
      tuning.postStallRollRateDeg,
      thinAir,
    ))
    * rollAuthority
  let yawCmd = state.input.yaw * MathUtils.degToRad(envelope.yawRate) * yawAuthority
  // Sideslip weathervane — yaw is a rudder in an airstream, not a reaction wheel.
  yawCmd += sensedBetaRad * tuning.sideslipDamping
    * Math.min(qFactor * tuning.weathervaneQScale, 1)

  // Spin prevention: deep post-stall, roll and yaw commands are bled off and the rates
  // themselves damped harder, so the jet mushes instead of departing.
  const spinGuard = smooth01((alphaDegAbs - tuning.stallAoADeg) / tuning.spinGuardRangeDeg)
  rollCmd *= 1 - (spinGuard * tuning.spinGuardRollLoss)
  yawCmd *= 1 - (spinGuard * tuning.spinGuardYawLoss)

  /*
  Falling-leaf departure. This is deterministic separated-flow coupling, not random noise:
  it appears only when the wing is deeply separated, the aircraft is slow and sinking, and
  the pilot has released all three axes. Small out-of-phase roll/yaw moments make the leaf
  swap sides while the spin guard keeps the motion bounded. Touching a control removes it,
  so the instability is something the player can ride or cancel rather than a cutscene.
  */
  const leafLowEnergy = 1 - smooth01(
    (state.speedKmh - tuning.fallingLeafFullKmh)
      / Math.max(tuning.fallingLeafNoneKmh - tuning.fallingLeafFullKmh, 1),
  )
  const leafHandsOff = 1 - smooth01(
    Math.max(Math.abs(state.input.pitch), Math.abs(state.input.roll), Math.abs(state.input.yaw))
      / tuning.fallingLeafInputThreshold,
  )
  const leafSink = smooth01(
    (-state.velocity.y - tuning.fallingLeafMinSink)
      / Math.max(tuning.fallingLeafSinkRange, 1e-3),
  )
  state.departureBlend = separation * leafLowEnergy * leafHandsOff * leafSink
  state.departurePhase = MathUtils.euclideanModulo(
    state.departurePhase + (dt * Math.PI * 2 * tuning.fallingLeafFrequencyHz),
    Math.PI * 2,
  )
  rollCmd += MathUtils.degToRad(tuning.fallingLeafRollRateDeg)
    * Math.sin(state.departurePhase)
    * state.departureBlend
  yawCmd += MathUtils.degToRad(tuning.fallingLeafYawRateDeg)
    * Math.sin((state.departurePhase * 0.5) + tuning.fallingLeafYawPhaseRad)
    * state.departureBlend

  // ---------------------------------------------------------------- rate dynamics
  // First-order chase of the commanded rates — the corrective-torque loop, with the
  // response constant standing in for inertia. Extra damping while the spin guard is up.
  //
  // How fast a rate builds is the same question as how much authority is behind it, so the
  // response constant is scaled by the axis authority rather than being a fixed number.
  // The airframe's mass does not change with airspeed; what changes is the moment available
  // to accelerate it. Thin air therefore takes its time reaching a rate and, with the stick
  // centred, takes the same time shedding it — which is the inertia that was missing when
  // every axis snapped to its (smaller) low-speed ceiling just as briskly as it did at Mach
  // 1. The floor underneath is the FCS rate feedback: that loop is a gyro and a nozzle, and
  // neither one asks what the airspeed is.
  const w = state.angularVelocity
  const damp = 1 + (spinGuard * tuning.spinDamping)
  const floor = tuning.rateResponseFloor
  const span = 1 - floor
  const pitchResponse = tuning.pitchResponse
    * (floor + (span * MathUtils.clamp(pitchAuthority, 0, 1)))
  const rollResponse = tuning.rollResponse
    * (floor + (span * MathUtils.clamp(rollAuthority, 0, 1)))
  const yawResponse = tuning.yawResponse
    * (floor + (span * MathUtils.clamp(yawAuthority, 0, 1)))
  w.z = approach(w.z, pitchCmd, pitchResponse * damp, dt)
  w.x = approach(w.x, rollCmd, rollResponse * damp, dt)
  w.y = approach(w.y, yawCmd, yawResponse * damp, dt)

  // Body-frame integration. Pilot yaw-right is a negative rotation about local +Y.
  rotationEuler.set(w.x * dt, -w.y * dt, w.z * dt, 'XYZ')
  rotationStep.setFromEuler(rotationEuler)
  state.orientation.multiply(rotationStep).normalize()

  // The nozzles slew toward what pitch is asking of them; nothing snaps.
  const vectorTarget = state.input.pitch * tuning.maxThrustVectorDeg
    * MathUtils.lerp(tuning.normalThrustVectorFactor, 1, thinAir) * thrustLevel
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

  const alphaRad = speed > airflowSenseSpeed
    ? Math.atan2(-localVelocity.y, localVelocity.x)
    : sensedAlphaRad
  const betaRad = speed > airflowSenseSpeed
    ? Math.asin(MathUtils.clamp(localVelocity.z / speed, -1, 1))
    : sensedBetaRad
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
    // A separated vertical tail cannot instantly drag the trajectory behind a TVC yaw.
    // Its side force fades with separation just as the control surfaces do, preserving the
    // useful post-stall gap between where the nose points and where momentum is carrying it.
    const separatedSideFactor = MathUtils.lerp(1, tuning.postStallSideForceFactor, separation)
    accel.addScaledVector(
      sideDir,
      -betaRad * tuning.sideForceGain * qFactor * separatedSideFactor,
    )
  }

  // Parasite and wave drag are present at every throttle setting. The AoA-squared term is
  // the compressed induced-drag bill: more pull makes more lift/G and spends more energy.
  // Sideslip, brake, and flaps add their own penalties; a Cobra without them would still
  // be a free 180.
  //
  // The separated-flow surcharge is billed against measured alpha, because separation is a
  // property of the airflow over the wing and has nothing to do with how fast the aircraft
  // happens to be going. This is the same number the HUD publishes, computed once.
  const alphaDeg = MathUtils.radToDeg(alphaAbs)
  const postStallBlend = smooth01(
    (alphaDeg - tuning.stallAoADeg) / tuning.postStallDisplayRangeDeg,
  )
  let dragMag = readDragKmhPerSecond(
    state.speedKmh, state.position.y, envelope) * toWorld
  /*
  Separated-flow drag shape. Sine up to the beam, and past it a decay toward a floor rather
  than either of the two obvious wrong answers.

  A plain sine is wrong because alpha is an atan2 and wraps: it reads a jet at 175 degrees —
  flying very nearly backwards — as barely separated at all, and hands a tumble a free ride
  over the top on almost no induced drag. Saturating flat at the beam is wrong the other
  way: broadside is the worst the airframe ever presents to the air, and holding that bill
  all the way round to tail-first brakes a tumble to a standstill in about a second, which
  is a manoeuvre that ends with the aircraft parked in the sky rather than flying out of it.
  So the bill peaks square to the flow and eases off as the airframe comes round to meet it
  the other way, and the floor is the arcade half of the decision: a tumble should cost
  energy, not all of it.
  */
  const beamBlend = smooth01((MathUtils.radToDeg(alphaAbs) - 90) / 90)
  const sinAlpha = alphaAbs <= Math.PI / 2
    ? Math.sin(alphaAbs)
    : MathUtils.lerp(1, tuning.beyondBeamDragFactor, beamBlend)
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
  const newSpeed = state.velocity.length()
  const hasNewPath = newSpeed > 1e-6
  if (hasNewPath) pathDir.copy(state.velocity).normalize()
  state.position.addScaledVector(state.velocity, dt)
  state.speedKmh = newSpeed / toWorld

  // How far this step actually bent the trajectory. Smoothed, because a single fixed step
  // of it is a very small angle and the regimes read off it should not chatter.
  if (hasPath && hasNewPath && speed > airflowSenseSpeed) {
    const pathTurn = Math.acos(MathUtils.clamp(entryPathDir.dot(pathDir), -1, 1))
    state.pathRateDeg = approach(
      state.pathRateDeg, MathUtils.radToDeg(pathTurn) / dt, tuning.pathRateResponse, dt)
  } else {
    state.pathRateDeg = approach(state.pathRateDeg, 0, tuning.pathRateResponse, dt)
  }

  // Load factor as the wing feels it: lift over weight, signed by AoA.
  state.gLoad = liftMag / gravity

  /*
  Published for the HUD and the effects. These are descriptions of how far past the stall the
  wing is, not control inputs — nothing above reads them, which is the whole point.

  `stallBlend` is the approach to the stall and `postStallBlend` the departure from it, so
  between them they cover the progression end to end with no threshold in it: normal flight,
  high AoA, stall onset, stall, post-stall. `postStallActive` is the one boolean left and it
  says exactly one thing, "the wing is stalled" — it reaches the maneuver label and the HUD
  and stops there. No force in this function branches on it.
  */
  state.stallBlend = smooth01(
    (alphaDeg - tuning.stallOnsetDeg) / Math.max(tuning.stallAoADeg - tuning.stallOnsetDeg, 1e-3),
  )
  state.postStallBlend = postStallBlend
  state.postStallActive = alphaDeg > tuning.stallAoADeg
  state.flightRegime = state.postStallActive
    ? 'post-stall'
    : state.stallBlend > 0
      ? 'high-aoa'
      : 'normal'

  // Refresh signed axial speed from the newly integrated velocity. This is the value the
  // HUD and next step's maneuver detector see.
  localVelocity.copy(state.velocity).applyQuaternion(inverseOrientation)
  state.forwardSpeedKmh = localVelocity.x / toWorld
  state.backwardFlight = state.forwardSpeedKmh < -tuning.backwardFlightThresholdKmh

  // Where it is going against where it is pointing. `flightPathDeg` is the climb or dive
  // angle of the velocity itself, and `noseOffPathDeg` is the total angle between the nose
  // and the flight path — the number the whole model exists to allow to be large.
  if (hasNewPath) {
    state.flightPathDeg = MathUtils.radToDeg(
      Math.asin(MathUtils.clamp(state.velocity.y / newSpeed, -1, 1)),
    )
    state.noseOffPathDeg = MathUtils.radToDeg(
      Math.acos(MathUtils.clamp(worldForward.dot(pathDir), -1, 1)),
    )
  }

  state.maneuver = detectManeuver(
    state, tuning, pitchAttitudeDeg, newSpeed, tuning.pedalTurnMaxKmh * toWorld)
}
