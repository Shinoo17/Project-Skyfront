/*
The authored framing: where the boom sits, how far ahead the lens aims, and what each
camera style does with both. These are numbers about composition, and the rig in
`chaseCamera.js` is what moves a camera along them.
*/

import { Vector3 } from 'three'

// The boom is authored against the airframe rather than against a round number: the model is
// seven world units nose to tail and close to five across the span, so ten units aft and
// three up put the wing across roughly a sixth of the frame at Normal and a quarter at Near.
// That is the framing a third-person combat camera wants — the airframe is the subject and
// its control surfaces are readable — and the distance ladder spreads either side of it.
export const CHASE_CAMERA_OFFSET = new Vector3(-10.05, 3.3, 0)
// The aim point rides ahead of the nose, and how far ahead is what puts the jet low in the
// frame rather than on the centreline. It is tied to the boom: shortening the boom without
// shortening the lead would tip the lens up and drop the airframe out of the bottom of the
// shot, so both came down together.
export const CHASE_CAMERA_LOOK_AHEAD = 10
export const BASE_FOV = 70

export const CAMERA_DISTANCE_SCALE = {
  near: 0.75,
  normal: 1,
  far: 1.4,
}

export const CAMERA_STYLES = {
  combat: {
    offset: CHASE_CAMERA_OFFSET,
    lookAhead: CHASE_CAMERA_LOOK_AHEAD,
    velocityBlend: 0.22,
    positionResponse: 4.2,
    targetResponse: 5.4,
    baseFov: BASE_FOV,
    speedFov: 5,
    brakingFov: 4,
    // What a hard turn and reheat read as on the lens and the boom. Both are multiplied by
    // a blend that is zero in ordinary flight, so neither shifts the authored base framing.
    maneuverFov: 4,
    maneuverBoom: 0.1,
    burnerFov: 3,
    burnerBoom: 0.06,
    shake: 0.5,
  },
  action: {
    // A tighter, calmer lens than Combat Chase, and about a quarter closer on the boom, so
    // the aircraft occupies the shot instead of becoming a marker at the end of it. The lead
    // shortens with the boom: the aim point is what holds the airframe low in frame, and
    // leaving it long behind a short boom would tip the lens up and crop the tail away.
    offset: new Vector3(-7.8, 2.5, 0),
    lookAhead: 6,
    // Action reads the flight path before it reads the nose. That is what lets a looping
    // aircraft come back toward the lens at the top of an Immelmann instead of dragging the
    // whole camera round with its quaternion. Recovery temporarily reverses that priority:
    // Pitch Down is an explicit request to put the chase rig back behind the nose.
    velocityBlend: 0.82,
    recoveryVelocityBlend: 0.18,
    positionResponse: 3.4,
    targetResponse: 4.4,
    returnDuration: 0.85,
    returnMinDuration: 0.62,
    baseFov: 69,
    speedFov: 3,
    brakingFov: 3,
    maneuverFov: 3.5,
    maneuverBoom: 0.12,
    burnerFov: 2.5,
    burnerBoom: 0.07,
    shake: 0.28,
  },
}
