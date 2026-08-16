/*
Keeping the boom out of the ground.

A chase camera sitting ten units behind the aircraft is ten units closer to a ridge every
time the jet crosses one at low level, and the failure mode is not subtle: the lens ends up
inside the terrain and the pilot flies a frame of solid rock at the exact moment they most
need to see out of it.

The fix is the ordinary one — cast from the aircraft toward where the boom wants to be, and
if something is in the way, shorten the boom until it is not. What is worth writing down is
the three things that make it not feel like a fix.

It samples on a clock rather than every frame. A terrain mesh has no acceleration structure
here, and the range's own ground probe in `FlightAircraft` is throttled for the same reason.
Between samples the last hit is held, which is safe because the quantity that actually moves
the camera is sprung and therefore lags the sample anyway.

It springs in both directions, but not at the same rate. Pulling in is nearly immediate,
because the alternative to a fast pull-in is a frame inside a hill; letting back out is slow,
because a boom that snapped back to full length the instant a ridge cleared would produce a
lurch on every terrain feature the aircraft passed. Asymmetry is what makes a camera that is
constantly negotiating with the landscape read as calm.

And it keeps a margin in front of the obstacle rather than landing on it, so the near plane
has somewhere to be and a ridge crossed at a shallow angle does not flicker in and out of
contact.
*/

import { MathUtils, Raycaster, Vector3 } from 'three'

// How often the ray is actually cast. Fast enough that a ridge arriving at 400 m/s is caught
// with the boom still outside it, slow enough that the cast is not the frame's cost centre.
const SAMPLE_INTERVAL = 0.08
// Clearance held in front of whatever was hit, in world units.
const SKIN = 1.6
// The asymmetric spring. Pulling in wins by roughly four to one.
const PULL_IN_RESPONSE = 26
const RELEASE_RESPONSE = 3.2

export function createCameraCollisionState() {
  return {
    raycaster: new Raycaster(),
    direction: new Vector3(),
    origin: new Vector3(),
    // The fraction of the authored boom the terrain is currently allowing, and the fraction
    // the camera has actually eased onto. Both are 1 when nothing is in the way.
    allowed: 1,
    fraction: 1,
    sampledAt: -1,
    // Published for the debug overlay: whether the boom is being shortened at all.
    blocked: false,
  }
}

export function resetCameraCollision(collision) {
  collision.allowed = 1
  collision.fraction = 1
  collision.sampledAt = -1
  collision.blocked = false
}

/*
One frame of it. `desired` is where the boom wants the camera; the return value is the
fraction of the way from the aircraft to that point the camera may actually go.

The origin is lifted off the aircraft's own position by a little, but not much: starting the
ray exactly at the airframe risks the first intersection being the aircraft's own mesh if
one is ever passed in, and starting it much further along would let the camera pass through
a wall the near half of the boom had already cleared.

`terrain` absent — the observer's picture-in-picture, the node harness, any surface without
a landscape — means no constraint at all rather than a guessed one. A camera that shortened
its boom against terrain that was not supplied would be shortening it against nothing.
*/
export function updateCameraCollision(collision, {
  terrain,
  origin,
  desired,
  elapsed,
  step,
}) {
  if (!terrain) {
    collision.allowed = 1
    collision.blocked = false
    // Still eased rather than assigned: losing the terrain reference mid-sortie — a quality
    // change that rebuilds the landscape — must not snap a shortened boom back out.
    collision.fraction = MathUtils.lerp(
      collision.fraction, 1, 1 - Math.exp(-RELEASE_RESPONSE * step),
    )
    return collision.fraction
  }

  collision.direction.subVectors(desired, origin)
  const reach = collision.direction.length()
  if (reach < 1e-4) {
    collision.allowed = 1
    collision.blocked = false
    collision.fraction = 1
    return 1
  }
  collision.direction.divideScalar(reach)

  if (collision.sampledAt < 0 || elapsed - collision.sampledAt > SAMPLE_INTERVAL) {
    collision.sampledAt = elapsed
    collision.origin.copy(origin)
    collision.raycaster.set(collision.origin, collision.direction)
    collision.raycaster.near = 0
    collision.raycaster.far = reach
    const hit = collision.raycaster.intersectObject(terrain, true)[0]
    collision.allowed = hit
      ? MathUtils.clamp((hit.distance - SKIN) / reach, 0.12, 1)
      : 1
  }

  collision.blocked = collision.allowed < 0.999
  const response = collision.allowed < collision.fraction ? PULL_IN_RESPONSE : RELEASE_RESPONSE
  collision.fraction = MathUtils.lerp(
    collision.fraction,
    collision.allowed,
    1 - Math.exp(-response * step),
  )
  return collision.fraction
}
