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
export const CHASE_CAMERA_LOOK_AHEAD = 18
export const BASE_FOV = 70
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
    id: 'combat',
    label: 'Combat Chase',
    detail: '70° lens · sprung nose + velocity follow',
  },
  {
    id: 'action',
    label: 'Action',
    detail: 'Close 69° lens · cinematic PSM orbit',
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
    // A tighter, calmer lens than Combat Chase. The aircraft occupies the shot instead of
    // becoming a marker at the end of a long boom, while enough sky remains ahead to read
    // the exit from a manoeuvre.
    offset: new Vector3(-15.5, 4.8, 0),
    lookAhead: 13,
    // Less of the sightline is given to momentum than it was. The velocity share is what
    // makes the camera hang behind the nose during a pitch change, and past about a quarter
    // it stops reading as weight and starts reading as the aim not keeping up.
    velocityBlend: 0.26,
    positionResponse: 3.4,
    targetResponse: 4.4,
    returnResponse: 1.9,
    returnDuration: 2.8,
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

export function readFlightCameraStyle() {
  try {
    const saved = window.localStorage.getItem(CAMERA_STYLE_KEY)
    // `normal` was the pre-Combat-Chase id. Preserve the user's stable-camera choice
    // across the rename instead of silently moving them to Action.
    if (saved === 'normal') return 'combat'
    return CAMERA_STYLES[saved] ? saved : 'combat'
  } catch {
    return 'combat'
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

/*
The camera rolls with the aircraft, all the way round, and there is no horizon lock.

That is a reversal of what this file used to do, and the reason is motion sickness rather
than composition. A camera that keeps the horizon level while the airframe rolls under it
puts two different rotation rates on the screen at once: the world turning at very nearly the
aircraft's rate, and the aircraft appearing to turn at whatever share of it the camera was
told to take. Neither cue matches what the hand asked for, and the mismatch is precisely the
thing that makes a barrel roll unpleasant to watch. Taking the whole bank leaves one rotation
on the screen. The aircraft sits still in the frame and the world goes round it, which is what
the pilot is actually doing, and it reads as flying rather than as being swung.

It is also the only mapping under which the screen is a control surface. Screen-up is body
pitch-up at every attitude, so the pointer stick can be a position on the glass — see the
stick in `flightInput.js`, which depends on this and would be lying without it.

So there is nothing to configure and no branch. The camera's up is the airframe's up across
the follow axis, for the cockpit and for both chase styles alike, and everything the old
angle-domain horizon needed — a world-up reference that is undefined at the vertical, a
signed bank that wraps at 180, two fades and a filter to cover both — is gone with it. Body
up has neither failure: it is defined at every attitude the aircraft can reach, and inverted
is not a special case of anything.

Two places still hold a level frame on purpose, and both are authored shots rather than
horizon lock: `chase.actionUp` freezes the camera's own up for the duration of a post-stall
manoeuvre, and the release path eases back toward world up as the aircraft rejoins the
airflow. Those are compositions the pilot was promised would hold still. They stay.
*/
// The boom breathes with load and reheat rather than stepping, and slower than the lens: a
// camera that changes distance faster than it changes angle reads as the aircraft lurching.
const CAMERA_BOOM_RESPONSE = 2.5

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
    aim: new Vector3(),
    translation: new Vector3(),
    up: new Vector3(),
    look: new Vector3(),
    followForward: new Vector3(),
    followUp: new Vector3(),
    followRight: new Vector3(),
    // The airframe's up across the follow axis, which is the camera's up.
    bodyUp: new Vector3(),
    // How far the boom is extended over its authored length, 1 in ordinary flight.
    boom: 1,
    velocityDirection: new Vector3(),
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
    // Action camera captures these three world-space offsets on the first controlled PSM
    // frame. Only aircraft translation is applied while they are held, so the jet is free
    // to pitch, flip, or reverse inside a stable shot.
    actionOffset: new Vector3(),
    actionTargetOffset: new Vector3(),
    actionUp: new Vector3(),
    actionReturnUp: new Vector3(),
    actionReturnOffset: new Vector3(),
    actionReturnDirection: new Vector3(),
    actionReturnTargetDirection: new Vector3(),
    actionReturnRotation: new Quaternion(),
    actionReturnStep: new Quaternion(),
    actionReturnElapsed: 0,
    actionHeld: false,
    actionBlocked: false,
    actionReturning: false,
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
  chase.actionHeld = false
  chase.actionBlocked = false
  chase.actionReturning = false
  chase.actionReturnElapsed = 0
  chase.boom = 1
  chase.followUp.copy(LOCAL_UP)
  chase.position
    .copy(CHASE_CAMERA_OFFSET)
    .applyQuaternion(aircraftState.orientation)
    .add(aircraftState.position)
  chase.target
    .copy(aircraftState.position)
    .addScaledVector(FORWARD, CHASE_CAMERA_LOOK_AHEAD)
  chase.aim.copy(chase.target)
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
  style = 'combat',
  distance = 'normal',
  cameraLook,
  rearView = false,
  accelerateRequested = false,
}) {
  if (!camera) return

  const profile = CAMERA_STYLES[style] ?? CAMERA_STYLES.combat
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

  // Action is not a looser chase camera. It is a shot held in the world frame the instant
  // controlled post-stall flight begins. The stored offsets still inherit aircraft
  // translation, so the jet cannot fly away from the lens, but attitude is deliberately
  // absent: a Cobra stands upright in frame and a full flip turns inside an unchanged shot.
  const psmPhase = aircraftState.psmPhase ?? 'normal'
  const psmManeuver = psmPhase !== 'normal' && psmPhase !== 'high-aoa'
  const pitchHeld = Math.abs(aircraftState.input?.pitch ?? 0) > 0.12
  if (!psmManeuver) chase.actionBlocked = false
  const actionEligible = style === 'action'
    && mode === 'chase'
    && !rearView
    && !freeLooking
    && psmManeuver

  if (!chase.actionHeld
    && !chase.actionBlocked
    && actionEligible
    && pitchHeld
    && !accelerateRequested) {
    // Capture against the previous aircraft position. The translation pass below carries
    // camera and aim onto this frame before either is compared with its captured target.
    chase.actionOffset.subVectors(camera.position, chase.previousPosition)
    chase.actionTargetOffset.subVectors(chase.aim, chase.previousPosition)
    chase.actionUp.copy(camera.up)
    chase.actionHeld = true
    chase.actionReturning = false
    chase.actionReturnElapsed = 0
  } else if (chase.actionHeld && (accelerateRequested
    || style !== 'action'
    || mode !== 'chase'
    || rearView
    || freeLooking)) {
    // Releasing pitch or Alt deliberately does not hand the shot back. A Cobra may be held
    // upright for several seconds, or stopped near 180 degrees, without the camera beginning
    // to chase the nose. W is the flight-control handoff; explicit camera controls remain an
    // escape hatch so free look, rear view, and the nose camera cannot become trapped.
    chase.actionHeld = false
    chase.actionBlocked = psmManeuver
    chase.actionReturning = true
    chase.actionReturnOffset.copy(chase.actionOffset)
    // The horizon the held shot was composed on. It has to come back with the boom, on the
    // same clock: now that the ordinary camera rides the full airframe roll, a shot held
    // through an inverted Cobra can be a half-turn away from where the chase rig wants to
    // be, and handing the up axis straight back would spend the whole return in one frame.
    chase.actionReturnUp.copy(camera.up)
    chase.actionReturnElapsed = 0
  }
  if (style !== 'action') {
    chase.actionHeld = false
    chase.actionBlocked = false
    chase.actionReturning = false
  }

  // Combat Chase is placed on a flight-frame basis rather than copied from the aircraft
  // quaternion. A measured share of velocity keeps momentum visible while the majority
  // nose share retains direct control feel. The up axis carries only the selected amount
  // of bank, keeping the horizon readable without flattening the aircraft's roll.
  chase.followForward.copy(attitude.forward)
  if (mode !== 'nose' && !rearView && aircraftState.velocity.lengthSq() > 1) {
    chase.velocityDirection.copy(aircraftState.velocity).normalize()
    chase.followForward.lerp(chase.velocityDirection, profile.velocityBlend).normalize()
  }
  /*
  The camera's up is the airframe's up, for the cockpit and for both chase styles alike. The
  cockpit's head is bolted to the aircraft and the chase rig now rides the same roll, so
  there is one path rather than a branch.

  Projected across the follow axis because that axis is the nose blended with the velocity
  vector, not the nose itself, so the airframe's up is not exactly perpendicular to it. The
  guard is unreachable in practice — the two only align if the aircraft is flying along its
  own up axis, and even a Cobra at ninety degrees alpha leaves the projection at most of its
  length — but a degenerate up would take the whole basis with it, so it stays.
  */
  chase.bodyUp.copy(attitude.up)
  chase.bodyUp.addScaledVector(chase.followForward, -chase.bodyUp.dot(chase.followForward))
  if (chase.bodyUp.lengthSq() < 1e-8) chase.bodyUp.copy(attitude.up)
  chase.followUp.copy(chase.bodyUp).normalize()

  chase.followUp.addScaledVector(
    chase.followForward,
    -chase.followUp.dot(chase.followForward),
  )
  if (chase.followUp.lengthSq() < 1e-6) chase.followUp.copy(attitude.up)
  chase.followUp.normalize()
  chase.followRight.crossVectors(chase.followForward, chase.followUp).normalize()
  chase.up.copy(chase.followUp)

  /*
  How hard the wing is working, as the one number the lens and the boom both read. Load and
  reheat push the camera back and open the lens a little; that is the G-force feedback, and it
  is deliberately all of it. Screen shake is the cheap version of this effect and it competes
  with the manoeuvre for the player's attention — the buffet below is already cut to 15% at
  full blend for exactly that reason. The aircraft is the subject of the shot.

  It reads `highGBlend` and deliberately not the post-stall one. PSM manoeuvres are authored
  shots: Action holds the Cobra and the Kulbit in a fixed world-space frame on purpose, and a
  lens that opened underneath a held shot would be recomposing a frame the player was told
  would not move — the same intrusion as swinging the camera, arriving through the one channel
  a quaternion comparison cannot see. High-G is a turn, not a shot, and has no such contract.

  Both terms ride a slow chase of their own, so entering and leaving a turn breathes rather
  than steps, and a blend that is zero leaves the authored framing untouched.
  */
  const loadBlend = MathUtils.clamp(aircraftState.highGBlend ?? 0, 0, 1)
  chase.boom = MathUtils.lerp(
    chase.boom,
    1 + (profile.maneuverBoom * loadBlend) + (profile.burnerBoom * burnerLevel),
    1 - Math.exp(-CAMERA_BOOM_RESPONSE * step),
  )

  if (rearView) {
    // Rear view is a cut to a camera ahead of the aircraft, not a trip around it. The
    // airframe stays in frame while the abrupt positional cut removes the nauseating arc.
    chase.localOffset.copy(profile.offset).multiplyScalar(distanceScale * chase.boom)
    chase.localOffset.x = Math.abs(chase.localOffset.x)
  } else if (mode === 'nose') {
    chase.localOffset.copy(NOSE_CAMERA_OFFSET)
  } else {
    chase.localOffset.copy(profile.offset).multiplyScalar(distanceScale * chase.boom)
  }
  if (mode === 'nose') {
    chase.position
      .copy(chase.localOffset)
      .applyQuaternion(aircraftState.orientation)
      .add(aircraftState.position)
  } else {
    chase.position
      .copy(aircraftState.position)
      .addScaledVector(chase.followForward, chase.localOffset.x)
      .addScaledVector(chase.followUp, chase.localOffset.y)
      .addScaledVector(chase.followRight, chase.localOffset.z)
  }
  chase.target
    .copy(aircraftState.position)
    .addScaledVector(chase.followForward, lookAhead * chase.freeLookAim)

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
    chase.freeLookBase.subVectors(chase.position, aircraftState.position)
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

  if (chase.actionHeld) {
    chase.position.copy(aircraftState.position).add(chase.actionOffset)
    chase.target.copy(aircraftState.position).add(chase.actionTargetOffset)
    chase.up.copy(chase.actionUp)
    alignment = 1
  }

  // Carry the camera by the aircraft's translation before easing the relative chase
  // offset. Without this, high-Mach flight adds speed-dependent lag and makes the jet
  // shrink away from the player even though the configured camera distance is fixed.
  chase.translation.subVectors(aircraftState.position, chase.previousPosition)
  camera.position.add(chase.translation)
  chase.aim.add(chase.translation)
  chase.previousPosition.copy(aircraftState.position)

  if (alignment < 1) {
    chase.up.lerp(LOCAL_UP, 1 - alignment)
    if (chase.up.lengthSq() < 1e-6) chase.up.copy(LOCAL_UP)
    chase.up.normalize()
  }

  const rigidNose = mode === 'nose' && !rearView
  const response = chase.actionReturning
    ? (profile.returnResponse ?? profile.positionResponse)
    : profile.positionResponse
  const blend = 1 - Math.exp(-response * step)
  const orbiting = freeLooking && mode !== 'nose'
  const actionFollowing = style === 'action' && mode === 'chase' && !rearView
  if (modeChanged || rearChanged || rigidNose || chase.actionHeld) {
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
  } else if (chase.actionReturning) {
    /*
    W hands the shot back along an orbit, not a world-space chord. The direction turns on
    the unit sphere while the boom length closes independently, so even a Cobra that left
    the camera in front of the nose travels around the aircraft rather than through it.

    The smoothstep clock is intentional here instead of a frame-wise lerp: it leaves the
    held shot at rest, gathers pace, then arrives behind the aircraft at rest. The chase
    target stays live throughout, allowing the player to accelerate into the exit without
    the camera returning to a tail position the aircraft has already left behind.
    */
    chase.actionReturnElapsed = Math.min(
      chase.actionReturnElapsed + step,
      profile.returnDuration ?? 2.4,
    )
    const duration = profile.returnDuration ?? 2.4
    const progress = MathUtils.smoothstep(chase.actionReturnElapsed / duration, 0, 1)
    const startRadius = chase.actionReturnOffset.length()
    chase.actionReturnTargetDirection.subVectors(chase.position, aircraftState.position)
    const targetRadius = chase.actionReturnTargetDirection.length()
    if (startRadius > 1e-6 && targetRadius > 1e-6) {
      chase.actionReturnDirection.copy(chase.actionReturnOffset).divideScalar(startRadius)
      chase.actionReturnTargetDirection.divideScalar(targetRadius)
      chase.actionReturnRotation.setFromUnitVectors(
        chase.actionReturnDirection,
        chase.actionReturnTargetDirection,
      )
      chase.actionReturnDirection.applyQuaternion(
        chase.actionReturnStep.identity().slerp(chase.actionReturnRotation, progress),
      )
      camera.position
        .copy(aircraftState.position)
        .addScaledVector(
          chase.actionReturnDirection,
          MathUtils.lerp(startRadius, targetRadius, progress),
        )
    } else {
      camera.position.copy(chase.position)
    }

    /*
    The horizon rejoins on the same clock as the boom, turned on the unit sphere rather than
    lerped: the held up and the live one can be exactly antipodal after a shot composed
    through inverted flight, and a straight lerp between antipodal vectors collapses through
    zero length instead of going round. `setFromUnitVectors` picks a perpendicular axis in
    that case — arbitrary, but continuous, which is the whole requirement.
    */
    chase.actionReturnRotation.setFromUnitVectors(chase.actionReturnUp, chase.up)
    chase.up
      .copy(chase.actionReturnUp)
      .applyQuaternion(chase.actionReturnStep.identity().slerp(
        chase.actionReturnRotation, progress,
      ))
  } else if (actionFollowing) {
    // Ordinary Action follow uses the same radial decomposition at a lower response. Nose
    // and velocity changes therefore describe a restrained boom arc instead of dragging the
    // lens diagonally through world space. Combat Chase keeps its more immediate linear rig.
    chase.freeLookDirection.subVectors(camera.position, aircraftState.position)
    chase.freeLookOffset.subVectors(chase.position, aircraftState.position)
    const radius = chase.freeLookDirection.length()
    const targetRadius = chase.freeLookOffset.length()
    if (radius > 1e-6 && targetRadius > 1e-6) {
      chase.freeLookDirection.divideScalar(radius)
      chase.freeLookOffset.divideScalar(targetRadius)
      chase.freeLookRotation.setFromUnitVectors(chase.freeLookDirection, chase.freeLookOffset)
      chase.freeLookDirection.applyQuaternion(
        chase.freeLookStep.identity().slerp(chase.freeLookRotation, blend),
      )
      camera.position
        .copy(aircraftState.position)
        .addScaledVector(
          chase.freeLookDirection,
          MathUtils.lerp(radius, targetRadius, blend),
        )
    } else {
      camera.position.copy(chase.position)
    }
  } else {
    camera.position.lerp(chase.position, blend)
  }
  // Taken whole rather than eased onto. The horizon is already a filtered quantity — one
  // first-order chase on the roll angle, applied where the roll actually lives — and a second
  // filter on the vector would only add the lag that made the camera slow to answer a pitch
  // change. It would also be the wrong filter for the job: easing an up that is exactly
  // opposed to its target is a fixed point, because the midpoint is the zero vector and
  // normalising that hands back the inverted up for ever. An angle has no such state.
  camera.up.copy(chase.up)
  // lookAt builds the camera basis by crossing the sightline with up, so an up that has
  // lagged into line with the sightline degenerates the whole basis. Take the component
  // across the sightline before handing it over and that can never happen.
  const aimDirect = modeChanged || rearChanged || rigidNose || orbiting || chase.actionHeld
  if (aimDirect) chase.aim.copy(chase.target)
  else chase.aim.lerp(chase.target, 1 - Math.exp(-(
    chase.actionReturning ? response : profile.targetResponse
  ) * step))

  chase.look.subVectors(chase.aim, camera.position)
  if (chase.look.lengthSq() > 1e-8) {
    chase.look.normalize()
    camera.up.addScaledVector(chase.look, -camera.up.dot(chase.look))
    if (camera.up.lengthSq() < 1e-6) camera.up.copy(chase.up)
    camera.up.normalize()
  }
  camera.lookAt(chase.aim)

  if (chase.actionReturning
    && chase.actionReturnElapsed >= (profile.returnDuration ?? 2.4)
    && camera.position.distanceToSquared(chase.position) < 0.0025
    && chase.aim.distanceToSquared(chase.target) < 0.0025) {
    chase.actionReturning = false
  }

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
      + (profile.maneuverFov * loadBlend)
      + (profile.burnerFov * burnerLevel)
  chase.fov = MathUtils.lerp(chase.fov, targetFov, 1 - Math.exp(-3.5 * step))
  if (Math.abs(camera.fov - chase.fov) > 0.01 && camera instanceof PerspectiveCamera) {
    camera.fov = chase.fov
    camera.updateProjectionMatrix()
  }

  // Hard manoeuvres already create strong visual motion. Suppressing 85% of the random
  // buffet at full blend preserves aerodynamic feedback without making the authored shot
  // vibrate around the aircraft. This one *does* read post-stall as well: a held Cobra shot
  // is exactly the frame that must not be shaken, which is the opposite of the lens argument
  // above — the buffet is a thing being taken away from the shot, not added to it.
  const maneuverShake = MathUtils.lerp(1, 0.15, MathUtils.clamp(Math.max(
    loadBlend,
    aircraftState.psmBlend ?? 0,
  ), 0, 1))
  const buffet = profile.shake * maneuverShake * (0.2
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
