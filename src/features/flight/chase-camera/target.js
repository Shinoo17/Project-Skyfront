/*
The third reference: where the fight is, as opposed to where the nose is or where the
aircraft is going.

Held rather than toggled, and deliberately no part of the control loop. The aircraft answers
the stick exactly as it did a frame ago; what changes is only which way the lens is pointed.
That separation is the whole appeal of the shot — it lets a pilot look at the thing they are
turning toward while continuing to fly the turn — and it is also the reason nothing in here
may ever write to the flight state.

What it produces is a *weight*, not a camera. The rig owns one follow axis, built from the
nose and the velocity vector by the style profile; this bends that axis toward the target and
says by how much. Building a second rig and cutting between them is the obvious alternative
and it is wrong for the same reason free look is not a second rig: there would be a pose to
cut to on the way in and another on the way out, and the pilot would feel both.

Two effects fall out of the bend, and neither is decoration:

  The boom swings partway round. Aiming at the target while the camera stays directly astern
  puts the enemy at the edge of the frame and the aircraft in the middle of it, which is the
  wrong way round — the pilot is looking at the target, so the target should be the thing the
  composition is built on. Taking about half the bend on the boom as well slides the camera
  round until both are on the screen.

  The boom lengthens with angular separation. A target ninety degrees off the nose cannot
  share a frame with the aircraft at the authored distance no matter where the camera sits;
  the only remaining variable is how much of the world fits in the shot.

There is no target *selection* here, and that is a real gap rather than an omission: nothing
in the project currently publishes an enemy. The rig accepts one and does the right thing
with it the moment something does.
*/

import { MathUtils, Vector3 } from 'three'

// How hard the lens commits to the target. Short of 1 on purpose: pinning an enemy to the
// exact centre of the screen makes the camera feel like a turret rather than a chase, and
// removes every cue about which way the aircraft itself is pointing.
export const TARGET_AIM_WEIGHT = 0.7
// Post-stall keeps a little more of the flight frame, because during a Cobra the flight
// frame is what makes the manoeuvre readable and losing it to the target would waste the
// manoeuvre the pilot just committed to.
export const TARGET_AIM_WEIGHT_PSM = 0.6
// The share of the aim bend the boom itself takes.
const TARGET_BOOM_SHARE = 0.55
// Extra boom and lens at full angular separation.
const TARGET_SEPARATION_BOOM = 0.28
const TARGET_SEPARATION_FOV = 6
// How fast the shot commits and releases. Slower than free look: this is a decision about
// what to look at rather than a glance, and it should read as the camera choosing.
const TARGET_RESPONSE = 5.5

export function createCameraTargetState() {
  return {
    direction: new Vector3(),
    // How much of the target shot is in force, 0..1, sprung so press and release both blend.
    blend: 0,
    // The angle between the follow axis and the target, radians — what the boom and lens
    // widen against, and what the debug overlay reads.
    separation: 0,
    // Whether a usable target was actually supplied this frame.
    live: false,
  }
}

export function resetCameraTarget(state) {
  state.blend = 0
  state.separation = 0
  state.live = false
  state.direction.set(0, 0, 0)
}

/*
One frame of it.

`target` may be a `Vector3`, anything carrying a `position`, or nothing at all. Nothing at
all is the ordinary case today and has to cost nothing and change nothing: the blend eases
back to zero and every derived term goes with it, so a sortie without targets flies the
camera it always flew.

The aim is bent by a plain vector blend rather than a rotation, and that is safe here in a
way it is not for the up vector: the follow axis and the direction to the target are opposed
only if the target sits exactly astern along the flight axis, in which case the blend is the
zero vector and the guard hands the follow axis straight back. The lens then holds where it
was for the one frame it takes the geometry to stop being degenerate, which is invisible, and
the alternative — a rotation through an undefined axis — would pick an arbitrary side and
swing the camera through it.
*/
export function updateCameraTarget(state, {
  target,
  aircraftPosition,
  followForward,
  held,
  weight,
  step,
}) {
  const position = target?.isVector3 ? target : target?.position
  state.live = Boolean(position)

  if (state.live) {
    state.direction.subVectors(position, aircraftPosition)
    const range = state.direction.length()
    if (range < 1e-3) state.live = false
    else state.direction.divideScalar(range)
  }

  const commanded = state.live && held ? 1 : 0
  state.blend = MathUtils.lerp(state.blend, commanded, 1 - Math.exp(-TARGET_RESPONSE * step))
  if (state.blend < 1e-3) {
    state.blend = 0
    state.separation = 0
    return 0
  }

  state.separation = Math.acos(
    MathUtils.clamp(state.direction.dot(followForward), -1, 1),
  )
  return state.blend * weight
}

/*
Bend a direction toward the target by `amount`, in place. Returns whether it moved, so the
caller can leave its own basis alone when the answer is no.
*/
export function bendTowardTarget(direction, targetDirection, amount) {
  if (amount <= 1e-4) return false
  direction.lerp(targetDirection, amount)
  if (direction.lengthSq() < 1e-8) return false
  direction.normalize()
  return true
}

// The boom takes rather less of the bend than the lens does, and grows with separation.
export function targetBoomShare(amount) {
  return amount * TARGET_BOOM_SHARE
}

export function targetSeparationBoom(state) {
  return 1 + (TARGET_SEPARATION_BOOM * state.blend * separationTerm(state))
}

export function targetSeparationFov(state) {
  return TARGET_SEPARATION_FOV * state.blend * separationTerm(state)
}

function separationTerm(state) {
  return MathUtils.smoothstep(
    state.separation,
    MathUtils.degToRad(25),
    MathUtils.degToRad(120),
  )
}
