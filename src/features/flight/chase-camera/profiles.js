/*
The authored framing: where the boom sits, how far ahead the lens aims, and what load,
reheat and post-stall flight do to both. These are numbers about composition, and the rig in
`chaseCamera.js` is what moves a camera along them.

There is one profile. There used to be two — a stable Combat Chase and a looser Action — and
the pilot picked between them in the pause menu, which sounds like generosity and was really
an unanswered question: the two styles were not different tastes, they were the same camera
tuned for different halves of the same sortie. Combat Chase was the better camera in level
flight and Action was the better camera in a Cobra, so whichever a pilot chose they were
wrong for part of every flight, and the menu made that their fault rather than the camera's.

So the split moved from the menu to the flight envelope, which is where it always belonged.
Ordinary flight gets the stable framing: a long boom, a long lead, and a follow axis that
reads mostly the nose, because that is what makes direction legible and control feel direct.
Post-stall flight gets the close, inertial one: a shorter boom, a shorter lead, and a shot
composed on the flight path the aircraft entered on, so a Kulbit turns inside the frame
instead of dragging the camera round with the nose. Nothing is chosen; the aircraft is
already telling the camera which of the two it needs, continuously, through `psmBlend` and
`highGBlend`, and there is no third opinion worth collecting.
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

export const CHASE_PROFILE = {
  offset: CHASE_CAMERA_OFFSET,
  lookAhead: CHASE_CAMERA_LOOK_AHEAD,

  /*
  The composition the post-stall shot settles onto. About a quarter closer than the cruise
  boom, so the aircraft occupies the frame instead of becoming a marker at the end of it —
  a Cobra is worth looking at and the cruise framing is too far back to see it happen. The
  lead shortens with the boom for the same reason it does above: the aim point is what holds
  the airframe low in frame, and leaving it long behind a short boom would tip the lens up
  and crop the tail away exactly when the tail is the interesting part.
  */
  psmOffset: new Vector3(-7.8, 2.5, 0),
  psmLookAhead: 6,

  /*
  How much of the follow axis is the flight path rather than the nose, at each of the three
  things the aircraft can be doing.

  Ordinary flight keeps the nose share high. A camera that reads the velocity vector in level
  flight lags every input by however long it takes the trajectory to answer it, and the
  aircraft stops feeling connected to the hand. A measured velocity share is still there
  because it is what keeps momentum visible through a rolling pull.

  High-G raises it, because a max-performance turn is precisely where the nose and the flight
  path stop agreeing: a camera that keeps reading the nose arrives at the far side of the turn
  before the aircraft does, and the jet appears to slide outward across the frame — the
  opposite of the sensation the turn should produce. Leaning onto the flight path lets the
  airframe drift off centre *into* the turn instead, which is the momentum cue.

  Post-stall inverts the priority outright. That is what lets a looping aircraft come back
  toward the lens at the top of an Immelmann, and what makes a Cobra read as a Cobra: the
  nose leaves the flight path, and only a camera still watching the flight path can show it.
  Recovery temporarily reverses it again — Pitch Down is an explicit request to put the rig
  back behind the nose.
  */
  velocityBlend: 0.22,
  highGVelocityBlend: 0.38,
  psmVelocityBlend: 0.85,
  recoveryVelocityBlend: 0.18,

  positionResponse: 4.2,
  targetResponse: 5.4,
  // How long the shot takes to hand itself back after a post-stall manoeuvre. The floor is
  // what stops one fast physics frame from snapping the camera to the tail.
  returnDuration: 0.85,
  returnMinDuration: 0.62,

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
}
