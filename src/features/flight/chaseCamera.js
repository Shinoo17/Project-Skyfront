import { MathUtils, PerspectiveCamera, Vector3 } from 'three'

/*
The pilot's camera, lifted out of the flight scene so more than one surface can drive it.

Nothing here reads `useThree`. The camera to move is an argument, which is the whole point:
the sortie hands over the Canvas's own camera and sees exactly the view it always had,
while the observer page hands over a detached camera it renders into a picture-in-picture.
One set of numbers, one basis, two views that can never disagree.
*/

const FORWARD = new Vector3(1, 0, 0)
const LOCAL_UP = new Vector3(0, 1, 0)

export const CHASE_CAMERA_OFFSET = new Vector3(-22, 7, 0)
export const CHASE_CAMERA_LOOK_AHEAD = 16
export const BASE_FOV = 48
const AFTERBURNER_SHAKE = 0.05

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
// airframe up's world Y.
const CAMERA_BANK_FOLLOW = 0.35
const CAMERA_VERTICAL_FADE = [0.6, 0.95]
const CAMERA_INVERTED_FADE = [-0.1, 0.4]

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
}) {
  if (!camera) return

  chase.position
    .copy(CHASE_CAMERA_OFFSET)
    .applyQuaternion(aircraftState.orientation)
    .add(aircraftState.position)
  chase.target
    .copy(aircraftState.position)
    .addScaledVector(attitude.forward, CHASE_CAMERA_LOOK_AHEAD)
  // Carry the camera by the aircraft's translation before easing the relative chase
  // offset. Without this, high-Mach flight adds speed-dependent lag and makes the jet
  // shrink away from the player even though the configured camera distance is fixed.
  chase.translation.subVectors(aircraftState.position, chase.previousPosition)
  camera.position.add(chase.translation)
  chase.previousPosition.copy(aircraftState.position)

  // How much of the level reference is worth using. Identically 1 - CAMERA_BANK_FOLLOW in
  // ordinary flight, faded to nothing where world up stops being a usable roll reference.
  const levelWeight = (1 - CAMERA_BANK_FOLLOW)
    * (1 - MathUtils.smoothstep(Math.abs(attitude.forward.y), ...CAMERA_VERTICAL_FADE))
    * MathUtils.smoothstep(attitude.up.y, ...CAMERA_INVERTED_FADE)
  chase.up
    .copy(attitude.up)
    .lerp(attitude.levelUp, levelWeight)
    .normalize()

  const blend = 1 - Math.exp(-4.5 * step)
  camera.position.lerp(chase.position, blend)
  camera.up.lerp(chase.up, blend * 0.65).normalize()
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
  const targetFov = BASE_FOV
    + (7 * MathUtils.clamp((speed - 45) / 28, 0, 1))
    - (8 * MathUtils.clamp(chase.decel / 22, 0, 1))
  chase.fov = MathUtils.lerp(chase.fov, targetFov, 1 - Math.exp(-3.5 * step))
  if (Math.abs(camera.fov - chase.fov) > 0.01 && camera instanceof PerspectiveCamera) {
    camera.fov = chase.fov
    camera.updateProjectionMatrix()
  }

  const buffet = 0.2
    * MathUtils.smoothstep(Math.abs(aircraftState.aoaDeg), 24, 55)
    * MathUtils.clamp(speed / 30, 0, 1)
    + AFTERBURNER_SHAKE * burnerLevel
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
