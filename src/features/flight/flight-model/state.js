/*
The shape of a flight state and the two ways one comes to exist: fresh, and reset to a
spawn. Kept apart from the step because this is a declaration of what the model carries,
and reading it should not mean scrolling past the aerodynamics that move it.
*/

import { Quaternion, Vector3 } from 'three'

import { readThrottlePower } from '../performance'

export function createFlightState() {
  return {
    position: new Vector3(),
    orientation: new Quaternion(),
    velocity: new Vector3(),
    // Aircraft sense, rad/s: x rolls right, y yaws right, z pitches up.
    angularVelocity: new Vector3(),
    // Pilot input after smoothing — also what the control surfaces animate from.
    input: { pitch: 0, roll: 0, yaw: 0 },
    // Automatic FCS maneuver surfaces, all normalized 0..1. Deflection is kept separate
    // from effectiveness so animation can remain active after separated flow has taken
    // most of the surfaces' aerodynamic authority away.
    maneuverSurface: 0,
    leadingEdgeDeflection: 0,
    trailingEdgeDeflection: 0,
    flaperonDeflection: 0,
    maneuverSurfaceEffectiveness: 1,
    // Dry power command and actual spooled engine power, both normalized idle..MIL.
    commandedThrottle: 0,
    engineThrottle: 0,
    // Compatibility alias used by existing nozzle/FX code.
    engineCoreLevel: 0,
    afterburnerActive: false,
    extremeManeuverActive: false,
    airbrakeAmount: 0,
    acceleration: 0,
    thrust: 0,
    parasiteDrag: 0,
    inducedDrag: 0,
    airbrakeDrag: 0,
    totalDrag: 0,
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
    // How far into the max-performance turn the aircraft is, 0..1. This is the High-G
    // trigger after the energy gate and the engage/release blend, and it is deliberately a
    // separate number from `psmBlend`: one widens the conventional envelope, the other
    // opens the post-stall one, and nothing lets the first become the second.
    highGBlend: 0,
    // Read-only descriptions for telemetry. Physics remains continuously blended and does
    // not branch on this label.
    flightRegime: 'normal',
    // Strength of the deterministic, hands-off falling-leaf oscillation, 0..1.
    departureBlend: 0,
    departurePhase: 0,
    // Explicit arcade PSM assist, armed by the device-neutral Maneuver Assist action. The
    // phase drives authority, float, and recovery help but never writes orientation or
    // velocity directly.
    psmPhase: 'normal',
    psmElapsed: 0,
    // Time since this deliberate PSM began, and signed pitch travel integrated from the
    // actual body rate. Unlike AoA, travel does not wrap at 180 degrees, so a 360-degree
    // Kulbit remains one continuous player-controlled rotation.
    psmActiveElapsed: 0,
    psmPitchTravelDeg: 0,
    psmBlend: 0,
    psmCanArm: true,
    psmFloatBlend: 0,
    // Anti-spam. One arm carries one rotation budget; spending it hands the manoeuvre to
    // recovery, and finishing the manoeuvre starts a cooldown that withholds post-stall
    // authority without withholding the controls.
    psmEnvelopeBlend: 0,
    psmRecoveryEntryTravelDeg: 0,
    psmWasActive: false,
    psmFlipSpent: false,
    psmCooldownRemaining: 0,
    // The horizon magnet's availability window and its blend, kept separate from `psmBlend`
    // because the assist has to outlive the manoeuvre it tidies up after.
    psmLevelWindow: 0,
    psmLevelBlend: 0,
    gravityScale: 1,
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
  state.maneuverSurface = 0
  state.leadingEdgeDeflection = 0
  state.trailingEdgeDeflection = 0
  state.flaperonDeflection = 0
  state.maneuverSurfaceEffectiveness = 1
  state.commandedThrottle = readThrottlePower(throttle, envelope)
  state.engineThrottle = state.commandedThrottle
  state.engineCoreLevel = state.engineThrottle
  state.afterburnerActive = false
  state.extremeManeuverActive = false
  state.airbrakeAmount = 0
  state.acceleration = 0
  state.thrust = 0
  state.parasiteDrag = 0
  state.inducedDrag = 0
  state.airbrakeDrag = 0
  state.totalDrag = 0
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
  state.highGBlend = 0
  state.flightRegime = 'normal'
  state.departureBlend = 0
  state.departurePhase = 0
  state.psmPhase = 'normal'
  state.psmElapsed = 0
  state.psmActiveElapsed = 0
  state.psmPitchTravelDeg = 0
  state.psmBlend = 0
  state.psmCanArm = true
  state.psmFloatBlend = 0
  state.psmEnvelopeBlend = 0
  state.psmRecoveryEntryTravelDeg = 0
  state.psmWasActive = false
  state.psmFlipSpent = false
  state.psmCooldownRemaining = 0
  state.psmLevelWindow = 0
  state.psmLevelBlend = 0
  state.gravityScale = 1
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
