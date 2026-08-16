/*
How much of the airframe's bank the camera is allowed to take.

For a long time this file did not exist, and the answer was "all of it". That was a
deliberate choice and the reasoning behind it is still sound: a camera that holds the
horizon level while the airframe rolls underneath puts two rotation rates on the screen at
once, and the mismatch between them is most of what makes a barrel roll unpleasant to watch.
Taking the whole bank leaves one rotation on the screen — the aircraft sits still in the
frame and the world goes round it.

What that argument misses is that it is a statement about one pilot. The same full-bank
camera that reads as flying to somebody on a stick reads as the room tipping over to
somebody on a mouse, and no amount of being right about the rotation count fixes that. So
the bank share is a setting now, and the three positions are the three honest answers:

  on      the camera rides the whole bank. Bit-for-bit the rig that shipped before this
          file existed, which is why the normal-flight share is exactly 1 rather than the
          0.8 an arcade camera would otherwise pick — nobody who liked the old camera
          should be able to tell that it became an option.
  hybrid  a measured share, clamped. Enough that a bank still reads as a bank, little
          enough that the horizon stays somewhere the eye can find it.
  off     the horizon holds and the airframe rolls inside the frame.

Two things this is not. It is not a horizon *lock*: only the roll component is taken out,
so pitch and yaw follow the aircraft exactly as they always did, and Off is still a chase
camera rather than a world-fixed one. And it is not one number for the whole sortie — see
`resolveRollFollow`, which is where most of the actual behaviour lives.
*/

import { MathUtils, Vector3 } from 'three'

const WORLD_UP = new Vector3(0, 1, 0)

/*
Why this is a fold and not a clamp, which is the one genuinely surprising thing in the file.

The obvious implementation of Hybrid is `clamp(bank * 0.25, ±15°)`, and it is wrong at
exactly one attitude: inverted. The bank angle is measured about the flight axis and wraps
there — an aircraft a degree past inverted reads −179 where a degree before it read +179 —
so a clamp hands back +15 on one frame and −15 on the next, and the horizon snaps thirty
degrees while the aircraft rolls two. A barrel roll passes through that point twice.

Hysteresis does not fix it. Neither does unwrapping the angle: a camera that accumulated
winding would finish a full roll rolled fifteen degrees with the aircraft level. The problem
is not the arithmetic, it is geometric — a camera taking a fixed *fraction* of the bank can
only be continuous if the fraction is 0 or 1, because any other fraction has to arrive at
inverted from +f·180 on one side and −f·180 on the other, and those are different cameras.

So the two families are the two continuous answers, and the setting picks between them.

  rides = false   the camera does not complete the rotation. Its offset is `amount·sin(bank)`
                  — largest at ninety degrees of bank, which is where the cue is worth most,
                  and zero at inverted, which is where a stabilised camera belongs anyway:
                  an inverted aircraft under a level horizon is exactly what Roll Off means.
                  Near level the slope is `amount`, so 15° of amplitude reads as a share of
                  about a quarter, which is where the authored Hybrid numbers come from.

  rides = true    the camera completes the rotation and ends where the airframe does. Its
                  offset is `bank − soft·sin(bank)`, which is the identity when `soft` is
                  zero and lags the bank through the quarters when it is not, while still
                  arriving at inverted exactly on the airframe. That is how Roll On gives
                  bank back under load and during post-stall flight without ever cutting.

`soft` is capped at 1 because past it the camera starts rolling backwards as the aircraft
rolls forward, and a camera that reverses is worse than one that follows too far.

One consequence worth stating plainly: Roll On during post-stall flight settles around a
third of a ninety-degree bank rather than the quarter an arcade camera would ideally take.
A rides-family camera cannot go lower and still reach inverted continuously. A third is
enough to keep a Kulbit readable, and the alternative — switching families mid-manoeuvre —
is the discontinuity this whole design exists to avoid.
*/
export const CAMERA_ROLL_MODES = {
  off: {
    rides: false,
    // Degrees of amplitude. Zero is a level horizon at every attitude.
    normal: 0,
    highG: 0,
    psm: 0,
  },
  hybrid: {
    rides: false,
    normal: 15,
    highG: 12,
    psm: 8,
  },
  on: {
    rides: true,
    // Unitless softness, not degrees. Zero reproduces the pre-setting rig exactly, which is
    // why nobody who liked the old camera should be able to tell that it became an option.
    normal: 0,
    highG: 0.55,
    psm: 1,
  },
}

export const CAMERA_ROLL_MODE_IDS = Object.keys(CAMERA_ROLL_MODES)
export const DEFAULT_CAMERA_ROLL_MODE = 'hybrid'

/*
The vertical, which is the one attitude where a level horizon is not merely hard but absent.

World up projected across the flight axis is what "level" is built out of, and in a vertical
climb that projection goes to zero and then comes back pointing the opposite way. That is not
a numerical artefact to be smoothed over — it is real. A camera behind an aircraft going over
the top of a loop is looking up-range on the way up and down-range on the way down, and the
horizon it was holding level is now behind it. Any camera that insists on a level horizon has
to turn a half-circle somewhere in there, and no choice of reference frame removes that.

What can be chosen is how fast. The stabilisation is expressed as a *correction* — how far the
camera is holding itself away from the airframe's own bank — and the correction is rate
limited. Through the pole the correction simply cannot keep up with a reference that inverted
between two frames, so the camera rides the airframe for a moment, exactly as Roll On would,
and then walks back to level over the following half-second. That is the graceful version of
an unavoidable rotation.

The limit costs nothing anywhere else. Roll On runs a correction of zero and is therefore
never limited at all — the pre-setting rig is recovered exactly. Roll Off is limited only if
the aircraft rolls faster than the cap, and the failure mode when it does is that the camera
briefly takes some of the bank, which is a graceful degradation rather than a pop.
*/
const ROLL_CORRECTION_RATE = MathUtils.degToRad(200)

function wrapPi(angle) {
  return angle - (Math.PI * 2 * Math.round(angle / (Math.PI * 2)))
}

/*
Which share is in force right now, blended rather than switched.

Both blends are the flight model's own continuous numbers, so the camera inherits the
smoothing that was already applied to them and never needs a transition timer of its own:
`highGBlend` is zero in ordinary flight and one deep in a max-performance turn, `psmBlend`
is zero until post-stall authority actually opens. High-G is applied first and post-stall
second because post-stall is the stronger claim — an armed PSM stands the High-G assist down
in the flight model too, and the camera agrees with it rather than averaging the two.
*/
export function resolveRollShape(mode, { highGBlend = 0, psmBlend = 0 } = {}) {
  const table = CAMERA_ROLL_MODES[mode] ?? CAMERA_ROLL_MODES[DEFAULT_CAMERA_ROLL_MODE]
  const high = MathUtils.clamp(highGBlend, 0, 1)
  const psm = MathUtils.clamp(psmBlend, 0, 1)
  const amount = MathUtils.lerp(
    MathUtils.lerp(table.normal, table.highG, high),
    table.psm,
    psm,
  )
  return {
    rides: table.rides,
    // Amplitude is degrees for the stabilised family and a unitless softness for the other,
    // so only one of the two conversions is ever meaningful.
    amount: table.rides ? MathUtils.clamp(amount, 0, 1) : MathUtils.degToRad(amount),
  }
}

/*
One frame of roll, written into `out`.

The camera's up is built rather than blended, and that distinction is the whole reason this
is not three lines of `lerp`. Easing one up vector toward another passes through the zero
vector whenever the two are opposed — which is exactly what an inverted aircraft presents —
and normalising a zero vector is undefined. Worse, a lerp that is *near* opposed sweeps
through its arc at a rate that has nothing to do with the aircraft's roll rate, so the
horizon would lurch through the inverted point rather than passing it.

An angle has neither failure. Measure the aircraft's bank as a signed rotation about the
follow axis, scale it, clamp it, and rebuild the up vector from the level frame at the angle
that survived. Every intermediate quantity is a scalar and the output is unit by
construction.

  levelUp     world up with the follow axis taken out of it — the horizon, as a direction
  levelRight  the other half of that frame, so the two span the plane the bank turns in
  angle       where the airframe's up sits in that plane, signed, clockwise on screen

The measured angle still wraps at inverted — `atan2` has to put the branch cut somewhere —
but both fold shapes above are built so that the wrap costs nothing. The stabilised family
goes through zero there, and the riding family arrives at ±180, which is the same up vector
either way. Nothing needs remembering between frames.

Returns the pair the caller needs downstream: the airframe's bank and the share of it the
camera took. Their difference is how far the airframe appears rotated inside the frame, which
is what the pointer stick has to be corrected by.
*/
const levelUp = new Vector3()
const levelRight = new Vector3()
const ROLL = { angle: 0, cameraAngle: 0, correction: 0 }

// How long the camera takes to walk from one setting's horizon to another's. The change
// arrives from the pause menu, so the pilot is usually looking at a menu while it happens;
// the transition exists so that the frame they resume on is not a cut, and so that anything
// which ever changes the setting from gameplay inherits the same guarantee.
export const ROLL_MODE_BLEND_SECONDS = 0.5

function fold(angle, shape) {
  return shape.rides
    ? angle - (shape.amount * Math.sin(angle))
    : shape.amount * Math.sin(angle)
}

export function applyCameraRoll(out, {
  followForward,
  bodyUp,
  shape,
  // The setting being left behind, and how far along the walk away from it the camera is.
  // Absent or complete means there is nothing to blend and the fold below runs once.
  fromShape = null,
  blend = 1,
  // Last frame's correction, and the frame length, which together are the rate limit.
  previousCorrection = 0,
  step,
}) {
  // The horizon in the plane the camera turns in. Its length is the cosine of the angle
  // between the flight axis and the vertical, which is also the fade term below — one
  // quantity doing both jobs rather than two that could disagree.
  levelUp.copy(WORLD_UP).addScaledVector(followForward, -WORLD_UP.dot(followForward))
  const horizon = levelUp.length()
  if (horizon < 1e-6) {
    /*
    Exactly vertical, where there is no level frame to build at all.

    The obvious thing to do here is hand back the airframe's own up, and it is wrong: a
    stabilised camera holding a level horizon through an inverted descent is most of a
    half-turn away from the airframe, so "just use body up" is a 180-degree cut delivered by
    the very branch that exists to keep the pole safe.

    So nothing is decided. `out` still carries last frame's up, the caller re-squares it
    against the new follow axis, and the frame or two the aircraft spends exactly on the
    vertical passes without the camera being told anything. The correction is carried for the
    same reason — the rate limiter is the only thing standing between the pilot and a
    half-turn on the far side, and zeroing its state here would discard the mechanism
    precisely where it does its work.
    */
    if (out.lengthSq() < 1e-8) out.copy(bodyUp)
    ROLL.angle = 0
    ROLL.cameraAngle = 0
    ROLL.correction = previousCorrection
    return ROLL
  }
  levelUp.divideScalar(horizon)
  levelRight.crossVectors(followForward, levelUp)

  // Rotating a vector about the follow axis by a positive angle carries it from `levelUp`
  // toward `levelRight`, and the follow axis points away from the camera, so a positive
  // angle is a clockwise rotation on the screen. Every sign downstream depends on that.
  const angle = Math.atan2(bodyUp.dot(levelRight), bodyUp.dot(levelUp))
  /*
  Both folds are continuous in the bank on their own, and a blend between them is continuous
  in time. What a blend cannot promise is continuity in the bank *while it is running*: the
  two families disagree by the whole half-turn at exactly inverted, so a setting changed
  during the one frame an aircraft is upside down can still move the horizon by up to the
  blend fraction of 180 degrees.

  That is left alone rather than papered over. The window is half a second long, it opens
  only when the pilot changes the setting, and the setting is behind a pause menu — so the
  cost is a rounding error against the alternative, which is a permanent filter on the
  horizon to insure against a frame nobody will ever be looking at.
  */
  const folded = fromShape && blend < 1
    ? MathUtils.lerp(fold(angle, fromShape), fold(angle, shape), blend)
    : fold(angle, shape)

  /*
  The correction, rate limited, and then the camera angle rebuilt from it.

  Working in the correction rather than in the camera angle directly is what keeps the limit
  free at Roll On: there the correction is identically zero at every attitude, so the clamp
  below never binds and the rig is bit-for-bit the one that shipped before the setting
  existed. It is also what makes the pole survivable — see the note above the rate.

  The delta is wrapped before it is clamped, so a bank passing through the branch cut is a
  two-degree step rather than a three-hundred-and-fifty-eight degree one, and the correction
  is wrapped after so that repeated rolls cannot walk it off to infinity. Neither wrap changes
  the camera's up, which only ever sees the angle through a cosine and a sine.
  */
  const target = angle - folded
  const delta = MathUtils.clamp(
    wrapPi(target - previousCorrection),
    -ROLL_CORRECTION_RATE * step,
    ROLL_CORRECTION_RATE * step,
  )
  const correction = wrapPi(previousCorrection + delta)
  const cameraAngle = angle - correction

  out.copy(levelUp).multiplyScalar(Math.cos(cameraAngle))
    .addScaledVector(levelRight, Math.sin(cameraAngle))
  if (out.lengthSq() < 1e-8) out.copy(bodyUp)
  out.normalize()

  ROLL.angle = angle
  ROLL.cameraAngle = cameraAngle
  ROLL.correction = correction
  return ROLL
}
