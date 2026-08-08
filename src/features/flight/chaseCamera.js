import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three'

/*
The pilot's camera, lifted out of the flight scene so more than one surface can drive it.

Nothing here reads `useThree`. The camera to move is an argument, which is the whole point:
the sortie hands over the Canvas's own camera and sees exactly the view it always had,
while the observer page hands over a detached camera it renders into a picture-in-picture.
One set of numbers, one basis, two views that can never disagree.
*/

const FORWARD = new Vector3(1, 0, 0)
const LOCAL_UP = new Vector3(0, 1, 0)
// Screen right for a camera looking down the nose with the airframe's up: cross(nose, up).
// The pilot's head pitches about it and yaws about the airframe's up.
const BODY_RIGHT = new Vector3(0, 0, 1)

export const CHASE_CAMERA_OFFSET = new Vector3(-22, 7, 0)
export const CHASE_CAMERA_LOOK_AHEAD = 16
export const BASE_FOV = 48
const AFTERBURNER_SHAKE = 0.05
const NOSE_CAMERA_OFFSET = new Vector3(3.8, 0.85, 0)
const NOSE_CAMERA_LOOK_AHEAD = 64
const NOSE_FOV = 58
// Free view is sprung, not eased. An exponential ease leaves the released angle at full
// speed and decays from there, so the moment the button comes up reads as a shove; a
// critically damped spring departs and arrives at rest, which is the difference between a
// camera that swings home and one that lurches. Neither ever overshoots.
//
// The grip is stiff enough that a drag feels direct while still refusing to move the camera
// more than a tenth of a radian in any one frame — that bound is what keeps a flick from
// crossing the pole. The return is loose enough to be watchable: settled inside about half a
// second, which is what a pilot's inner ear expects of a camera going back where it was.
const FREE_LOOK_GRIP = 18
const FREE_LOOK_RETURN = 12
// While the orbit is live the spring is the whole motion profile, so the position follows
// its command tightly. Leaving the ordinary chase lag stacked on top of it would double the
// settle time and turn a half-second return into well over a second.
const FREE_LOOK_FOLLOW = 14
// How far off the horizon the orbit and the pilot's head are allowed to travel. Both are
// clamped on the shared input state rather than on the derived angle, so a drag that runs
// past the limit stores no slack and the very next pixel back down moves the view again.
const FREE_LOOK_MAX_ELEVATION = MathUtils.degToRad(80)
const NOSE_LOOK_MAX_PITCH = MathUtils.degToRad(75)
const CAMERA_STYLE_KEY = 'f22-flight-camera-style'
const CAMERA_DISTANCE_KEY = 'f22-flight-camera-distance'

export const FLIGHT_CAMERA_STYLE_OPTIONS = [
  {
    id: 'normal',
    label: 'Normal',
    detail: 'Current stable chase camera',
  },
  {
    id: 'action',
    label: 'Action',
    detail: 'Closer framing · stronger roll · wider lens',
  },
]

export const FLIGHT_CAMERA_DISTANCE_OPTIONS = [
  { id: 'near', label: 'Near', detail: '75% chase distance' },
  { id: 'normal', label: 'Normal', detail: 'Current chase distance' },
  { id: 'far', label: 'Far', detail: '140% chase distance' },
]

const CAMERA_DISTANCE_SCALE = {
  near: 0.75,
  normal: 1,
  far: 1.4,
}

const CAMERA_STYLES = {
  normal: {
    offset: CHASE_CAMERA_OFFSET,
    lookAhead: CHASE_CAMERA_LOOK_AHEAD,
    bankFollow: 0.35,
    positionResponse: 4.5,
    upResponse: 0.65,
    baseFov: BASE_FOV,
    speedFov: 7,
    brakingFov: 8,
    shake: 1,
  },
  action: {
    offset: new Vector3(-16, 5.2, 0),
    lookAhead: 21,
    bankFollow: 0.62,
    positionResponse: 7.2,
    upResponse: 0.82,
    baseFov: 52,
    speedFov: 12,
    brakingFov: 6,
    shake: 1.45,
  },
}

export function readFlightCameraStyle() {
  try {
    const saved = window.localStorage.getItem(CAMERA_STYLE_KEY)
    return CAMERA_STYLES[saved] ? saved : 'normal'
  } catch {
    return 'normal'
  }
}

export function writeFlightCameraStyle(value) {
  if (!CAMERA_STYLES[value]) return
  try {
    window.localStorage.setItem(CAMERA_STYLE_KEY, value)
  } catch {
    // Storage can be unavailable in privacy modes; the in-session choice still works.
  }
}

export function readFlightCameraDistance() {
  try {
    const saved = window.localStorage.getItem(CAMERA_DISTANCE_KEY)
    return CAMERA_DISTANCE_SCALE[saved] ? saved : 'normal'
  } catch {
    return 'normal'
  }
}

export function writeFlightCameraDistance(value) {
  if (!CAMERA_DISTANCE_SCALE[value]) return
  try {
    window.localStorage.setItem(CAMERA_DISTANCE_KEY, value)
  } catch {
    // Storage can be unavailable in privacy modes; the in-session choice still works.
  }
}

// A chase camera that copies the full aircraft bank makes the pitch ladder sweep across
// the whole HUD during a turn. Following only part of the bank keeps the sightline calm
// while the ladder and terrain remain registered through the same camera.
//
// The other part of the reference — world up projected across the nose — is only defined
// while the jet is roughly upright and the nose is off the vertical. Straight up it is a
// zero vector, and it reverses through 180 degrees crossing the top of a loop; inverted it
// points opposite the airframe's own up. Blending toward it there is what used to roll the
// camera over itself. So the level reference is faded out over both, and what is left is
// the airframe's own up: full bank follow through the top of a loop and through inverted
// flight, which is continuous, and back to the calm sightline as soon as it means anything
// again. CAMERA_VERTICAL_FADE is on |nose up component|, CAMERA_INVERTED_FADE on the
// airframe up's world Y. Each camera style supplies its own bank-follow amount.
const CAMERA_VERTICAL_FADE = [0.6, 0.95]
const CAMERA_INVERTED_FADE = [-0.1, 0.4]

// One step of a critically damped spring, closed form so a long frame cannot make it blow
// up the way an explicit integrator would. The result carries both the new value and its
// new rate; the scratch object exists so a per-frame camera update allocates nothing.
const SPRING = { value: 0, rate: 0 }
function stepSpring(value, rate, target, omega, step) {
  const offset = value - target
  const impulse = (rate + omega * offset) * step
  const decay = Math.exp(-omega * step)
  SPRING.value = target + (offset + impulse) * decay
  SPRING.rate = (rate - omega * impulse) * decay
  return SPRING
}

export function createChaseCameraState() {
  return {
    position: new Vector3(),
    target: new Vector3(),
    translation: new Vector3(),
    up: new Vector3(),
    look: new Vector3(),
    previousPosition: new Vector3(),
    decel: 0,
    previousSpeed: 0,
    fov: BASE_FOV,
    localOffset: new Vector3(),
    freeLookBase: new Vector3(),
    freeLookOffset: new Vector3(),
    freeLookAxis: new Vector3(),
    freeLookDirection: new Vector3(),
    freeLookRotation: new Quaternion(),
    freeLookStep: new Quaternion(),
    freeLookYaw: 0,
    freeLookPitch: 0,
    freeLookYawRate: 0,
    freeLookPitchRate: 0,
    // How much of the chase camera's look-ahead is still in use. One is the ordinary
    // sightline; zero puts the aim on the aircraft's own origin.
    freeLookAim: 1,
    freeLookAimRate: 0,
    freeLookHeld: false,
    rearView: false,
    mode: null,
  }
}

/*
Snap the camera onto a freshly spawned aircraft. The nose is level and pointing down world
+X at this instant — `resetFlightState` clears the orientation — so the look-ahead runs
along world forward rather than a basis that has not been rebuilt yet.
*/
export function resetChaseCamera(chase, camera, aircraftState) {
  chase.previousPosition.copy(aircraftState.position)
  chase.decel = 0
  chase.previousSpeed = aircraftState.velocity.length()
  chase.mode = null
  chase.freeLookYaw = 0
  chase.freeLookPitch = 0
  chase.freeLookYawRate = 0
  chase.freeLookPitchRate = 0
  chase.freeLookAim = 1
  chase.freeLookAimRate = 0
  chase.freeLookHeld = false
  chase.position
    .copy(CHASE_CAMERA_OFFSET)
    .applyQuaternion(aircraftState.orientation)
    .add(aircraftState.position)
  chase.target
    .copy(aircraftState.position)
    .addScaledVector(FORWARD, CHASE_CAMERA_LOOK_AHEAD)
  if (!camera) return
  camera.position.copy(chase.position)
  camera.up.copy(LOCAL_UP)
  camera.lookAt(chase.target)
  // The canvas renderer would update this later, but the HUD reads the camera directly
  // from its own animation frame. Publish a matching view matrix immediately so projected
  // symbology cannot combine a fresh aircraft pose with the previous camera pose.
  camera.updateMatrixWorld()
}

/*
One frame of chase. `attitude` carries the basis the caller already built for its own
telemetry — nose, airframe up, and the level reference — so neither side recomputes it.
*/
export function updateChaseCamera(chase, camera, {
  aircraftState,
  attitude,
  speed,
  burnerLevel,
  step,
  mode = 'chase',
  style = 'normal',
  distance = 'normal',
  cameraLook,
  rearView = false,
}) {
  if (!camera) return

  const profile = CAMERA_STYLES[style] ?? CAMERA_STYLES.normal
  const distanceScale = CAMERA_DISTANCE_SCALE[distance] ?? CAMERA_DISTANCE_SCALE.normal
  const look = cameraLook ?? { active: false, yaw: 0, pitch: 0 }
  const modeChanged = chase.mode !== mode
  const rearChanged = chase.rearView !== rearView
  chase.mode = mode
  chase.rearView = rearView

  /*
  The mouse writes a target angle; the camera flies a sprung one. Two things fall out of
  that split.

  The drag is filtered. A flick can cover half the orbit between two frames, and easing the
  *position* through a jump like that would carry the camera over the pole, where the
  sightline lines up with world up, the horizon has no defined roll, and the view arrives
  upside down. The spring keeps the path in yaw and pitch — the path the pilot dragged.

  And the return needs no state of its own: releasing the button simply moves the target to
  zero and loosens the spring, so the camera swings home from wherever it is, at whatever
  speed it was already travelling. Picking the drag back up mid-return re-seeds the target
  from the angle on screen, which is why neither surface zeroes these on pointer-down: the
  next drag continues from what the pilot is looking at rather than snapping to the tail.
  */
  const held = look.active
  if (held && !chase.freeLookHeld) {
    // Added, not assigned: a pointer move can land in the same frame as the press, and its
    // delta is already sitting here waiting to be flown.
    look.yaw += chase.freeLookYaw
    look.pitch += chase.freeLookPitch
  } else if (!held) {
    look.yaw = 0
    look.pitch = 0
  }
  chase.freeLookHeld = held

  const omega = held ? FREE_LOOK_GRIP : FREE_LOOK_RETURN
  let sprung = stepSpring(chase.freeLookYaw, chase.freeLookYawRate, look.yaw, omega, step)
  chase.freeLookYaw = sprung.value
  chase.freeLookYawRate = sprung.rate
  sprung = stepSpring(chase.freeLookPitch, chase.freeLookPitchRate, look.pitch, omega, step)
  chase.freeLookPitch = sprung.value
  chase.freeLookPitchRate = sprung.rate
  if (!held && Math.abs(chase.freeLookYaw) < 1e-4 && Math.abs(chase.freeLookYawRate) < 1e-3) {
    chase.freeLookYaw = 0
    chase.freeLookYawRate = 0
  }
  if (!held && Math.abs(chase.freeLookPitch) < 1e-4 && Math.abs(chase.freeLookPitchRate) < 1e-3) {
    chase.freeLookPitch = 0
    chase.freeLookPitchRate = 0
  }

  const rotated = chase.freeLookYaw !== 0 || chase.freeLookPitch !== 0

  // The chase camera aims down the look-ahead so the jet sits low in frame and the pilot
  // sees where it is going. Free view wants the opposite: the aircraft centred, turned about
  // its own middle rather than about a point out past the nose, which is what made the old
  // orbit swing the airframe around the frame instead of rotating around it. The aim rides
  // the same spring as the angles, so it walks between the two rather than cutting.
  //
  // It takes an actual drag, not a held button — pointer-down is a bare click as often as it
  // is the start of a look, and a click must leave the view alone. Releasing hands it back
  // while the angles are still coming home, so the aim and the orbit arrive together.
  sprung = stepSpring(
    chase.freeLookAim,
    chase.freeLookAimRate,
    held && rotated && mode !== 'nose' ? 0 : 1,
    omega,
    step,
  )
  chase.freeLookAim = MathUtils.clamp(sprung.value, 0, 1)
  chase.freeLookAimRate = sprung.rate
  if (!held && Math.abs(1 - chase.freeLookAim) < 1e-4 && Math.abs(chase.freeLookAimRate) < 1e-3) {
    chase.freeLookAim = 1
    chase.freeLookAimRate = 0
  }

  const freeLooking = !rearView && rotated
  const lookAhead = mode === 'nose' ? NOSE_CAMERA_LOOK_AHEAD : profile.lookAhead

  if (rearView) {
    // Rear view is a cut to a camera ahead of the aircraft, not a trip around it. The
    // airframe stays in frame while the abrupt positional cut removes the nauseating arc.
    chase.localOffset.copy(profile.offset).multiplyScalar(distanceScale)
    chase.localOffset.x = Math.abs(chase.localOffset.x)
  } else if (mode === 'nose') {
    chase.localOffset.copy(NOSE_CAMERA_OFFSET)
  } else {
    chase.localOffset.copy(profile.offset).multiplyScalar(distanceScale)
  }
  chase.position
    .copy(chase.localOffset)
    .applyQuaternion(aircraftState.orientation)
    .add(aircraftState.position)
  chase.target
    .copy(aircraftState.position)
    .addScaledVector(attitude.forward, lookAhead * chase.freeLookAim)

  /*
  Free view is a rotation applied on top of the pose the camera already holds, never a
  separate rig. Zero yaw and zero pitch reproduce the ordinary camera exactly, which is
  what makes grabbing and releasing the mouse continuous: there is no pose to cut to on
  the way in and none to cut back from on the way out.

  Outside, that rotation swings the chase offset — which rides the airframe, so the tail
  stays the tail through a turn — about *world* up and a horizontal axis. Rotating about
  world axes is what keeps drag-right swinging right on screen while the jet is banked,
  and it is why the old spherical basis, captured once in world space and then left behind
  by the airframe, felt untethered. `alignment` is the cosine between the rotated and the
  unrotated offset: it levels the horizon by however far the camera has come round, rather
  than snapping the roll flat the instant a drag begins.

  In the cockpit nothing moves the camera at all. The pilot's head turns: the sightline
  rotates in the airframe's own frame around a seat that stays bolted where it is.
  */
  let alignment = 1
  if (freeLooking && mode === 'nose') {
    look.pitch = MathUtils.clamp(look.pitch, -NOSE_LOOK_MAX_PITCH, NOSE_LOOK_MAX_PITCH)
    chase.freeLookPitch = MathUtils.clamp(
      chase.freeLookPitch, -NOSE_LOOK_MAX_PITCH, NOSE_LOOK_MAX_PITCH,
    )
    // What gets turned is the sightline the boresight camera already has — seat to
    // look-ahead point, in the airframe's own frame — so a head at rest sees the boresight.
    chase.freeLookBase
      .copy(FORWARD)
      .multiplyScalar(lookAhead)
      .sub(chase.localOffset)
      .applyQuaternion(chase.freeLookRotation.setFromAxisAngle(BODY_RIGHT, chase.freeLookPitch))
      .applyQuaternion(chase.freeLookRotation.setFromAxisAngle(LOCAL_UP, -chase.freeLookYaw))
      .applyQuaternion(aircraftState.orientation)
    chase.target.copy(chase.position).add(chase.freeLookBase)
  } else if (freeLooking) {
    chase.freeLookBase.copy(chase.localOffset).applyQuaternion(aircraftState.orientation)
    // Yaw about world up leaves the offset's elevation untouched, so the pitch that follows
    // adds to the chase offset's own elevation exactly and the limit is a plain subtraction.
    const baseElevation = Math.asin(MathUtils.clamp(
      chase.freeLookBase.y / Math.max(chase.freeLookBase.length(), 1e-6), -1, 1,
    ))
    // Zero is pinned into the range. Pitch the aircraft steeply and the chase offset's own
    // elevation can already exceed the limit — a 70-degree dive carries it near the zenith —
    // and a range that excluded zero would forbid the one angle that means "not free
    // looking": the camera would pop on the grab and never finish returning on the release.
    const lowest = Math.min(0, -FREE_LOOK_MAX_ELEVATION - baseElevation)
    const highest = Math.max(0, FREE_LOOK_MAX_ELEVATION - baseElevation)
    look.pitch = MathUtils.clamp(look.pitch, lowest, highest)
    chase.freeLookPitch = MathUtils.clamp(chase.freeLookPitch, lowest, highest)
    chase.freeLookOffset
      .copy(chase.freeLookBase)
      .applyQuaternion(chase.freeLookRotation.setFromAxisAngle(LOCAL_UP, chase.freeLookYaw))
    chase.freeLookAxis.crossVectors(chase.freeLookOffset, LOCAL_UP)
    if (chase.freeLookAxis.lengthSq() < 1e-8) chase.freeLookAxis.copy(attitude.cross)
    chase.freeLookAxis.normalize()
    chase.freeLookOffset.applyQuaternion(
      chase.freeLookRotation.setFromAxisAngle(chase.freeLookAxis, chase.freeLookPitch),
    )

    alignment = MathUtils.clamp(
      chase.freeLookOffset.dot(chase.freeLookBase) / Math.max(chase.freeLookBase.lengthSq(), 1e-6),
      0,
      1,
    )
    chase.position.copy(aircraftState.position).add(chase.freeLookOffset)
  } else if (rearView) {
    chase.target.copy(aircraftState.position).addScaledVector(attitude.forward, -2)
  }
  // Carry the camera by the aircraft's translation before easing the relative chase
  // offset. Without this, high-Mach flight adds speed-dependent lag and makes the jet
  // shrink away from the player even though the configured camera distance is fixed.
  chase.translation.subVectors(aircraftState.position, chase.previousPosition)
  camera.position.add(chase.translation)
  chase.previousPosition.copy(aircraftState.position)

  // How much of the level reference is worth using. It is the inverse of the selected
  // bank-follow amount in ordinary flight, faded to nothing where world up is unusable.
  const bankFollow = mode === 'nose' ? 1 : profile.bankFollow
  const levelWeight = (1 - bankFollow)
    * (1 - MathUtils.smoothstep(Math.abs(attitude.forward.y), ...CAMERA_VERTICAL_FADE))
    * MathUtils.smoothstep(attitude.up.y, ...CAMERA_INVERTED_FADE)
  chase.up
    .copy(attitude.up)
    .lerp(attitude.levelUp, levelWeight)
    .normalize()
  if (alignment < 1) {
    chase.up.lerp(LOCAL_UP, 1 - alignment)
    if (chase.up.lengthSq() < 1e-6) chase.up.copy(LOCAL_UP)
    chase.up.normalize()
  }

  const rigidNose = mode === 'nose' && !rearView
  const blend = 1 - Math.exp(-profile.positionResponse * step)
  const orbiting = freeLooking && mode !== 'nose'
  if (modeChanged || rearChanged || rigidNose) {
    camera.position.copy(chase.position)
  } else if (orbiting) {
    // Easing the world position would draw a straight line, and a straight line between two
    // points on a circle is a chord: a fast drag would cut the camera through the aircraft
    // and out the far side. Ease the direction and the radius separately instead, so the
    // camera always travels the arc and always holds the framing distance it started with.
    chase.freeLookDirection.subVectors(camera.position, aircraftState.position)
    const radius = chase.freeLookDirection.length()
    const targetRadius = chase.freeLookOffset.length()
    if (radius > 1e-6 && targetRadius > 1e-6) {
      chase.freeLookDirection.divideScalar(radius)
      chase.freeLookOffset.divideScalar(targetRadius)
      const follow = 1 - Math.exp(-FREE_LOOK_FOLLOW * step)
      chase.freeLookRotation.setFromUnitVectors(chase.freeLookDirection, chase.freeLookOffset)
      chase.freeLookDirection.applyQuaternion(
        chase.freeLookStep.identity().slerp(chase.freeLookRotation, follow),
      )
      camera.position
        .copy(aircraftState.position)
        .addScaledVector(chase.freeLookDirection, MathUtils.lerp(radius, targetRadius, follow))
    } else {
      camera.position.copy(chase.position)
    }
  } else {
    camera.position.lerp(chase.position, blend)
  }
  if (modeChanged || rearChanged || rigidNose) camera.up.copy(chase.up)
  // Easing an up that is exactly opposed to its target is a fixed point — the midpoint is
  // the zero vector and normalising it hands back the inverted up for ever. Cut to the
  // target on the way through rather than hanging upside down.
  else if (camera.up.dot(chase.up) < -0.9999) camera.up.copy(chase.up)
  else camera.up.lerp(chase.up, blend * profile.upResponse).normalize()
  // lookAt builds the camera basis by crossing the sightline with up, so an up that has
  // lagged into line with the sightline degenerates the whole basis. Take the component
  // across the sightline before handing it over and that can never happen.
  chase.look.subVectors(chase.target, camera.position)
  if (chase.look.lengthSq() > 1e-8) {
    chase.look.normalize()
    camera.up.addScaledVector(chase.look, -camera.up.dot(chase.look))
    if (camera.up.lengthSq() < 1e-6) camera.up.copy(chase.up)
    camera.up.normalize()
  }
  camera.lookAt(chase.target)

  // Deceleration and speed read on the lens: the field of view stretches a little with
  // pace and pinches under hard braking, and deep AoA puts a faint buffet on the
  // camera. All of it is feedback for forces the model is really applying — none of it
  // feeds back into the physics.
  const rawDecel = step > 0 ? (chase.previousSpeed - speed) / step : 0
  chase.previousSpeed = speed
  chase.decel = MathUtils.lerp(chase.decel, Math.max(rawDecel, 0), 1 - Math.exp(-5 * step))
  const targetFov = mode === 'nose'
    ? NOSE_FOV
    : profile.baseFov
      + (profile.speedFov * MathUtils.clamp((speed - 45) / 28, 0, 1))
      - (profile.brakingFov * MathUtils.clamp(chase.decel / 22, 0, 1))
  chase.fov = MathUtils.lerp(chase.fov, targetFov, 1 - Math.exp(-3.5 * step))
  if (Math.abs(camera.fov - chase.fov) > 0.01 && camera instanceof PerspectiveCamera) {
    camera.fov = chase.fov
    camera.updateProjectionMatrix()
  }

  const buffet = profile.shake * (0.2
    * MathUtils.smoothstep(Math.abs(aircraftState.aoaDeg), 24, 55)
    * MathUtils.clamp(speed / 30, 0, 1)
    + AFTERBURNER_SHAKE * burnerLevel)
  if (buffet > 0.01) {
    camera.position.x += (Math.random() - 0.5) * buffet
    camera.position.y += (Math.random() - 0.5) * buffet
    camera.position.z += (Math.random() - 0.5) * buffet
  }

  // Keep the HUD's boresight and flight-path marker on the exact camera pose that the
  // renderer will use this frame. Without this, the camera's world-inverse matrix can lag
  // one frame behind position/quaternion changes during hard manoeuvres.
  camera.updateMatrixWorld()
}
