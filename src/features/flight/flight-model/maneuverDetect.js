import { MathUtils } from 'three'

/*
Which named regime the jet is in, read off the physics rather than driving it. The camera,
the HUD, and the effects may all key off this; nothing in the step below ever does.

The Cobra test is deliberately two-sided. Deep AoA alone does not make one — a hard enough
pull reaches deep AoA on the way round a loop, with the flight path swinging along behind
the nose the whole time. What makes it a Cobra is that the trajectory carries straight on
while the nose leaves it, so `pathRateDeg` has to be low at the same time. A pull that is
past the stall but still bending the path is exactly what `post-stall` names.
*/
export function detectManeuver(state, tuning, pitchAttitudeDeg, speed, pedalMaxSpeed) {
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
  if ((flying || state.psmPhase === 'post-stall-flip')
    && state.noseOffPathDeg > tuning.tumbleMinNoseOffDeg
    && (pitchRateDeg > tuning.tumbleMinPitchRateDeg || state.maneuver === 'tumble')) {
    return 'tumble'
  }
  if (state.postStallActive && beta > tuning.jTurnMinSideslipDeg
    && (flying || state.psmPhase === 'post-stall')) return 'j-turn'
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
