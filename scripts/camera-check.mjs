/*
Free view is a rotation laid on top of the ordinary camera pose, not a second rig. That
claim is only worth anything if it holds numerically, because the failure it prevents — a
pop on the frame the mouse is grabbed or released — is exactly the kind of single-frame
discontinuity nobody catches by eye while flying.

So: zero yaw and zero pitch must leave the camera bit-for-bit where the ordinary camera
would have put it, the sweep across the full drag range must never jump, and the orbit must
ride the airframe through a turn instead of being left behind in world space.
*/
import assert from 'node:assert/strict'

import {
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three'

import {
  FLIGHT_CAMERA_DISTANCE_OPTIONS,
  FLIGHT_CAMERA_ROLL_OPTIONS,
  createChaseCameraState,
  readFlightCameraDistance,
  readFlightCameraRoll,
  resetChaseCamera,
  updateChaseCamera,
} from '../src/features/flight/chaseCamera.js'

const FRAME = 1 / 60
const FORWARD = new Vector3(1, 0, 0)
const LOCAL_UP = new Vector3(0, 1, 0)

function createAircraft(speed = 200) {
  return {
    position: new Vector3(0, 400, 0),
    orientation: new Quaternion(),
    velocity: new Vector3(speed, 0, 0),
    aoaDeg: 0,
    noseOffPathDeg: 0,
    highGBlend: 0,
    psmBlend: 0,
    psmPhase: 'normal',
    input: { pitch: 0 },
  }
}

function createAttitude() {
  return {
    forward: new Vector3(),
    up: new Vector3(),
    levelUp: new Vector3(),
    cross: new Vector3(),
  }
}

// The same basis FlightAircraft builds for its telemetry, rebuilt here so the camera sees
// exactly the inputs it sees in the scene.
function refreshAttitude(attitude, aircraft) {
  attitude.forward.copy(FORWARD).applyQuaternion(aircraft.orientation).normalize()
  attitude.up.copy(LOCAL_UP).applyQuaternion(aircraft.orientation).normalize()
  attitude.levelUp
    .copy(LOCAL_UP)
    .addScaledVector(attitude.forward, -LOCAL_UP.dot(attitude.forward))
  if (attitude.levelUp.lengthSq() < 0.0001) attitude.levelUp.copy(LOCAL_UP)
  attitude.levelUp.normalize()
  attitude.cross.crossVectors(attitude.levelUp, attitude.up)
}

function createRig({
  mode = 'chase',
  rollMode = 'on',
  distance = 'normal',
  pitchDeg = 0,
  speed = 200,
  terrain = null,
  target = null,
  targetHeld = false,
} = {}) {
  const aircraft = createAircraft(speed)
  const attitude = createAttitude()
  const camera = new PerspectiveCamera(48, 16 / 9, 0.1, 20000)
  const chase = createChaseCameraState()
  const look = { active: false, yaw: 0, pitch: 0 }
  resetChaseCamera(chase, camera, aircraft)
  if (pitchDeg !== 0) {
    aircraft.orientation.setFromAxisAngle(new Vector3(0, 0, 1), MathUtils.degToRad(pitchDeg))
    aircraft.velocity.copy(FORWARD).applyQuaternion(aircraft.orientation).multiplyScalar(speed)
  }
  refreshAttitude(attitude, aircraft)

  const step = ({ bodyRate, preserveVelocity = false } = {}) => {
    if (bodyRate) {
      aircraft.orientation
        .multiply(new Quaternion().setFromAxisAngle(bodyRate.axis, bodyRate.rate * FRAME))
        .normalize()
      refreshAttitude(attitude, aircraft)
      if (!preserveVelocity) {
        aircraft.velocity.copy(FORWARD).applyQuaternion(aircraft.orientation).multiplyScalar(speed)
      }
    }
    aircraft.position.addScaledVector(aircraft.velocity, FRAME)
    updateChaseCamera(chase, camera, {
      aircraftState: aircraft,
      attitude,
      speed: aircraft.velocity.length(),
      burnerLevel: 0,
      step: FRAME,
      mode,
      rollMode,
      distance,
      cameraLook: look,
      rearView: false,
      terrain,
      target,
      targetHeld,
    })
  }

  return { aircraft, attitude, camera, chase, look, step }
}

function settle(rig, frames = 240) {
  for (let frame = 0; frame < frames; frame += 1) rig.step()
}

/*
The basis actually rendered, pulled off the camera's world matrix rather than off
`camera.up`. The two are not the same thing: `camera.up` is the hint `lookAt` is given, and
three re-orthogonalises it against the sightline before building the matrix. A degenerate
hint — up parallel to the view — is exactly what a camera frame can fail at, and it shows up
here as a basis that stops being orthonormal, not as anything wrong with the hint.
*/
const BASIS = { right: new Vector3(), up: new Vector3(), back: new Vector3() }
function cameraBasis(camera) {
  camera.updateMatrixWorld()
  camera.matrixWorld.extractBasis(BASIS.right, BASIS.up, BASIS.back)
  return BASIS
}

/*
How far the horizon is tipped on the screen, in degrees, signed.

Measured off the camera's screen-right axis rather than off its up, because `camera.up`
carries the sightline's own pitch: the boom sits above the aircraft and aims ahead of it, so
even a perfectly level camera has an up vector several degrees off world up. Screen-right is
immune to that — it lies in the horizontal plane exactly when the horizon is level, whatever
the camera is pitched to.
*/
function horizonRollDeg(camera) {
  const { right } = cameraBasis(camera)
  return MathUtils.radToDeg(Math.asin(MathUtils.clamp(right.y, -1, 1)))
}

function basisError(camera) {
  const { right, up, back } = cameraBasis(camera)
  return Math.max(
    Math.abs(right.length() - 1),
    Math.abs(up.length() - 1),
    Math.abs(back.length() - 1),
    Math.abs(right.dot(up)),
    Math.abs(up.dot(back)),
    Math.abs(back.dot(right)),
  )
}

// ---------------------------------------------------------------- identity is a no-op
// A held button that has not moved must be indistinguishable from no button at all — a
// press is a bare click as often as it is the start of a look. Two rigs through the same
// frames, one of them holding free look at zero yaw and zero pitch.
for (const mode of ['chase', 'nose']) {
  const quiet = createRig({ mode })
  const grabbed = createRig({ mode })
  settle(quiet)
  settle(grabbed)
  grabbed.look.active = true

  for (let frame = 0; frame < 120; frame += 1) {
    quiet.step()
    grabbed.step()
    assert.ok(
      quiet.camera.position.distanceTo(grabbed.camera.position) < 1e-9,
      `${mode}: a held button at zero must not move the camera`,
    )
    assert.ok(
      // acos in angleTo lands on the square root of float epsilon; a real pop is degrees.
      quiet.camera.quaternion.angleTo(grabbed.camera.quaternion) < 1e-6,
      `${mode}: a held button at zero must not turn the camera`,
    )
  }
}

// Drag it, though, and the aim walks off the look-ahead point and onto the aircraft's own
// middle — turning the jet about itself rather than about a point out past the nose. It
// has to be a pan: never more than a degree or so of sightline in any one frame.
{
  const rig = createRig()
  settle(rig)
  rig.look.active = true
  rig.look.yaw = 0.05
  const previous = new Quaternion().copy(rig.camera.quaternion)
  for (let frame = 0; frame < 120; frame += 1) {
    rig.step()
    assert.ok(
      previous.angleTo(rig.camera.quaternion) < MathUtils.degToRad(1),
      'the aim must pan onto the aircraft, not cut',
    )
    previous.copy(rig.camera.quaternion)
  }
  const centred = new Vector3()
    .subVectors(rig.aircraft.position, rig.camera.position)
    .normalize()
    .dot(new Vector3(0, 0, -1).applyQuaternion(rig.camera.quaternion))
  assert.ok(centred > 0.9999, `free view must settle its aim on the aircraft, ${centred}`)

  // The cockpit keeps its boresight: a pilot looking ahead is looking where the jet is
  // going, not at the jet.
  const nose = createRig({ mode: 'nose' })
  const quiet = createRig({ mode: 'nose' })
  settle(nose)
  settle(quiet)
  nose.look.active = true
  nose.look.yaw = 0.05
  for (let frame = 0; frame < 120; frame += 1) {
    nose.step()
    quiet.step()
  }
  assert.equal(nose.chase.freeLookAim, 1, 'cockpit free look must keep its look-ahead')
}

// The invariant has to survive every attitude, not just level flight. Steeply nose-down or
// nose-up, the chase offset's own elevation is already past the limit the orbit clamps to,
// and a clamp that then excluded zero would forbid the one angle that means "not free
// looking" — popping on the grab and never finishing the return on the release.
for (let pitchDeg = -80; pitchDeg <= 80; pitchDeg += 10) {
  const quiet = createRig({ pitchDeg })
  const grabbed = createRig({ pitchDeg })
  settle(quiet)
  settle(grabbed)
  grabbed.look.active = true
  for (let frame = 0; frame < 60; frame += 1) {
    quiet.step()
    grabbed.step()
  }
  assert.ok(
    quiet.camera.position.distanceTo(grabbed.camera.position) < 1e-9,
    `free look at zero must be a no-op at ${pitchDeg} degrees of pitch`,
  )
  assert.equal(
    grabbed.chase.freeLookPitch, 0, `the pitch clamp must admit zero at ${pitchDeg} degrees`,
  )

  // And the release must actually complete: a clamp that pushed the angle back every frame
  // would hold the camera in free look for as long as the attitude lasted.
  grabbed.look.pitch = 0.5
  for (let frame = 0; frame < 30; frame += 1) grabbed.step()
  grabbed.look.active = false
  for (let frame = 0; frame < 300; frame += 1) grabbed.step()
  assert.equal(
    grabbed.chase.freeLookPitch, 0, `released free look must come home at ${pitchDeg} degrees`,
  )
  assert.equal(grabbed.chase.freeLookAim, 1, `the aim must come home at ${pitchDeg} degrees`)
}

// ------------------------------------------------------------------ the sweep is smooth
// Drag the full range in both axes and watch the per-frame travel. A pole singularity, a
// wrap, or a basis captured in the wrong frame all show up here as one oversized step.
{
  const rig = createRig()
  settle(rig)
  rig.look.active = true
  const previous = new Vector3().copy(rig.camera.position)
  const travel = new Vector3()
  const settledRadius = rig.camera.position.distanceTo(rig.aircraft.position)
  let worst = 0
  let closest = Infinity
  let farthest = 0
  for (let frame = 0; frame < 720; frame += 1) {
    rig.look.yaw += Math.PI / 120
    rig.look.pitch += (frame < 360 ? 1 : -1) * (Math.PI / 240)
    rig.step()
    travel.subVectors(rig.camera.position, previous).addScaledVector(rig.aircraft.velocity, -FRAME)
    worst = Math.max(worst, travel.length())
    const radius = rig.camera.position.distanceTo(rig.aircraft.position)
    closest = Math.min(closest, radius)
    farthest = Math.max(farthest, radius)
    previous.copy(rig.camera.position)
  }
  assert.ok(worst < 1.6, `free look sweep must stay continuous, worst frame travel ${worst}`)
  // The orbit is a circle, not a wander: the framing distance the drag started with is the
  // framing distance it keeps, all the way round.
  assert.ok(
    Math.abs(closest - settledRadius) < 0.01 && Math.abs(farthest - settledRadius) < 0.01,
    `free look must hold its radius, ${closest} to ${farthest} against ${settledRadius}`,
  )
}

// A flick that crosses half the orbit in a single frame must travel the arc. Easing the
// world position instead would cut the chord, which runs straight through the aircraft.
{
  const rig = createRig()
  settle(rig)
  const radius = rig.camera.position.distanceTo(rig.aircraft.position)
  rig.look.active = true
  rig.look.yaw = Math.PI
  let nearest = Infinity
  for (let frame = 0; frame < 120; frame += 1) {
    rig.step()
    nearest = Math.min(nearest, rig.camera.position.distanceTo(rig.aircraft.position))
  }
  assert.ok(
    nearest > radius * 0.98,
    `a fast drag must arc around the aircraft, closed to ${nearest} of ${radius}`,
  )
}

// The clamp is written back onto the shared input, so a drag that overruns the limit stores
// no slack: releasing the mouse starts easing home from the angle actually being shown.
{
  const rig = createRig()
  settle(rig)
  rig.look.active = true
  rig.look.pitch = 40
  rig.step()
  assert.ok(Math.abs(rig.look.pitch) < Math.PI, 'overrun pitch must be clamped on the input')
  const elevation = Math.asin(MathUtils.clamp(
    (rig.camera.position.y - rig.aircraft.position.y)
      / rig.camera.position.distanceTo(rig.aircraft.position),
    -1,
    1,
  ))
  assert.ok(
    MathUtils.radToDeg(elevation) < 80.5,
    `orbit must stay clear of the pole, reached ${MathUtils.radToDeg(elevation)}`,
  )
}

// ------------------------------------------------------------- the orbit rides the airframe
// Half a turn of yaw is "look at the nose from in front". Hold it through 60 degrees of
// heading change: the camera must stay ahead of the nose the whole way. A basis captured
// once in world space, which is what the orbit used to do, is left behind by the first
// heading the aircraft flies to.
{
  const rig = createRig()
  settle(rig)
  rig.look.active = true
  rig.look.yaw = Math.PI
  const bodyRate = { axis: new Vector3(0, 1, 0), rate: 0.35 }
  for (let frame = 0; frame < 60; frame += 1) rig.step({ bodyRate })

  const ahead = new Vector3()
  let lowest = 1
  let highest = -1
  for (let frame = 0; frame < 180; frame += 1) {
    rig.step({ bodyRate })
    ahead.subVectors(rig.camera.position, rig.aircraft.position).normalize()
    const alignment = ahead.dot(rig.attitude.forward)
    lowest = Math.min(lowest, alignment)
    highest = Math.max(highest, alignment)
  }
  assert.ok(lowest > 0.9, `held free look must stay ahead of the nose, worst ${lowest}`)
  assert.ok(
    highest - lowest < 0.02,
    `held free look must hold its framing through the turn, spread ${highest - lowest}`,
  )
}

// The same hold through a roll: the offset is rotated about world axes on purpose, so the
// horizon stays put while the airframe turns over, and the jet must remain in front.
{
  const rig = createRig()
  settle(rig)
  rig.look.active = true
  rig.look.yaw = Math.PI
  const bodyRate = { axis: new Vector3(1, 0, 0), rate: 1.2 }
  for (let frame = 0; frame < 60; frame += 1) rig.step()
  const ahead = new Vector3()
  for (let frame = 0; frame < 360; frame += 1) {
    rig.step({ bodyRate })
    ahead.subVectors(rig.camera.position, rig.aircraft.position).normalize()
    assert.ok(
      ahead.dot(rig.attitude.forward) > 0.8,
      `free look must hold through a roll, alignment ${ahead.dot(rig.attitude.forward)}`,
    )
    assert.ok(rig.camera.up.y > 0, `free look must keep the horizon upright through a roll ${frame} ${rig.camera.up.toArray()} ${rig.attitude.up.toArray()}`)
  }
}

// ------------------------------------------------------------------ the cockpit stays put
// Nose free look turns the pilot's head. The seat does not move, and the sightline must
// actually leave the boresight when it does.
{
  const rig = createRig({ mode: 'nose' })
  settle(rig)
  const seat = new Vector3().subVectors(rig.camera.position, rig.aircraft.position)
  rig.look.active = true
  rig.look.yaw = Math.PI / 2
  rig.look.pitch = 0.4
  for (let frame = 0; frame < 30; frame += 1) rig.step()
  const moved = new Vector3().subVectors(rig.camera.position, rig.aircraft.position)
  assert.ok(seat.distanceTo(moved) < 1e-6, 'cockpit free look must not move the camera off the seat')
  const sightline = new Vector3(0, 0, -1).applyQuaternion(rig.camera.quaternion)
  assert.ok(
    sightline.dot(rig.attitude.forward) < 0.2,
    'cockpit free look must actually turn the sightline off the boresight',
  )
}

// ------------------------------------------------------------------- release comes home
// Letting go must swing back to the ordinary camera — not snap, which is nauseating, and
// not dawdle. Measure the time to close the last of the gap and hold it to the half second
// or so an inner ear expects, then confirm nothing is left over.
{
  const rig = createRig()
  settle(rig)
  const quiet = createRig()
  settle(quiet)
  const chaseOffset = new Vector3().subVectors(quiet.camera.position, quiet.aircraft.position)
  const offset = new Vector3()

  rig.look.active = true
  rig.look.yaw = 2.1
  rig.look.pitch = 0.6
  for (let frame = 0; frame < 60; frame += 1) rig.step()
  const released = offset.subVectors(rig.camera.position, rig.aircraft.position)
    .distanceTo(chaseOffset)
  rig.look.active = false

  let homeFrame = -1
  let previous = new Vector3().copy(rig.camera.position)
  let worst = 0
  const travel = new Vector3()
  for (let frame = 0; frame < 300; frame += 1) {
    rig.step()
    travel.subVectors(rig.camera.position, previous).addScaledVector(rig.aircraft.velocity, -FRAME)
    worst = Math.max(worst, travel.length())
    previous.copy(rig.camera.position)
    offset.subVectors(rig.camera.position, rig.aircraft.position)
    if (homeFrame < 0 && offset.distanceTo(chaseOffset) < released * 0.02) homeFrame = frame + 1
  }
  const seconds = homeFrame * FRAME
  assert.ok(seconds > 0.3 && seconds < 0.7, `the return must be sprung, not cut: ${seconds}s`)
  // A spring leaves at rest, so the first frame of the return is among the slowest, never
  // the jump an exponential ease would open with.
  assert.ok(worst < released / 8, `the return must not lurch, worst frame travel ${worst}`)

  assert.equal(rig.chase.freeLookYaw, 0, 'released free look must recentre its yaw')
  assert.equal(rig.chase.freeLookPitch, 0, 'released free look must recentre its pitch')
  assert.equal(rig.chase.freeLookAim, 1, 'released free look must hand the look-ahead back')
  assert.ok(
    offset.distanceTo(chaseOffset) < 1e-6,
    'released free look must settle back onto the ordinary chase offset',
  )
}

// Grabbing again mid-return picks up from what is on screen. Zeroing the angles on the grab
// — which is what both pointer surfaces used to do — would cut straight back to the tail.
{
  const rig = createRig()
  settle(rig)
  rig.look.active = true
  rig.look.yaw = 2.1
  for (let frame = 0; frame < 60; frame += 1) rig.step()
  rig.look.active = false
  for (let frame = 0; frame < 12; frame += 1) rig.step()

  const before = new Vector3().subVectors(rig.camera.position, rig.aircraft.position)
  rig.step()
  const coasting = new Vector3()
    .subVectors(rig.camera.position, rig.aircraft.position)
    .distanceTo(before)

  const during = new Vector3().subVectors(rig.camera.position, rig.aircraft.position)
  const midReturn = rig.chase.freeLookYaw
  rig.look.active = true
  rig.step()
  assert.equal(rig.look.yaw, midReturn, 'a new drag must resume from the angle on screen')
  // The camera was already travelling when the button came back down, and it carries that
  // speed rather than stopping dead or restarting. What it must not do is step further in
  // the grab frame than it did in the frame before — that would be a cut back to the tail.
  const grabbed = new Vector3()
    .subVectors(rig.camera.position, rig.aircraft.position)
    .distanceTo(during)
  assert.ok(
    grabbed < coasting * 1.05,
    `grabbing again mid-return must not jump the camera, ${grabbed} against ${coasting}`,
  )
}

// ------------------------------------------------------------------ the camera options
// Every option the pause menu offers has to resolve to real behaviour, and each axis has to
// do what its label claims: distance moves the camera out, and the roll positions take
// visibly different shares of the same bank.
{
  assert.deepEqual(
    FLIGHT_CAMERA_ROLL_OPTIONS.map(({ id, label }) => ({ id, label })),
    [
      { id: 'off', label: 'Off' },
      { id: 'hybrid', label: 'Hybrid' },
      { id: 'on', label: 'On' },
    ],
    'settings must expose exactly Off, Hybrid and On',
  )

  const distances = {}
  for (const option of FLIGHT_CAMERA_DISTANCE_OPTIONS) {
    const rig = createRig({ distance: option.id })
    settle(rig)
    distances[option.id] = rig.camera.position.distanceTo(rig.aircraft.position)
  }
  assert.ok(
    distances.near < distances.normal && distances.normal < distances.far,
    `chase distance must order near < normal < far, got ${JSON.stringify(distances)}`,
  )

  /*
  The bank share, at the one angle the acceptance criteria name. Ninety degrees of bank is
  where the three positions must be unmistakably different from each other: Off holds the
  horizon, Hybrid takes a slice that stays inside its clamp, and On goes the whole way.

  The Hybrid window is the clamp rather than the share — 90° at 0.25 would be 22.5°, so a
  reading anywhere near that means the clamp has stopped binding and the setting has quietly
  become a scale.
  */
  const banks = {}
  for (const option of FLIGHT_CAMERA_ROLL_OPTIONS) {
    const rig = createRig({ rollMode: option.id })
    settle(rig)
    rig.aircraft.orientation.setFromAxisAngle(new Vector3(1, 0, 0), MathUtils.degToRad(90))
    rig.aircraft.velocity.set(200, 0, 0)
    refreshAttitude(rig.attitude, rig.aircraft)
    for (let frame = 0; frame < 240; frame += 1) rig.step({ preserveVelocity: true })
    banks[option.id] = Math.abs(horizonRollDeg(rig.camera))
  }
  assert.ok(
    banks.off < 1,
    `Roll Off must hold the horizon at a 90° bank, got ${banks.off}°`,
  )
  assert.ok(
    banks.hybrid > 10 && banks.hybrid < 18,
    `Roll Hybrid must take 10-18° of a 90° bank, got ${banks.hybrid}°`,
  )
  assert.ok(
    banks.on > 88 && banks.on < 92,
    `Roll On must carry the whole 90° bank, got ${banks.on}°`,
  )

  const base = createRig({ speed: 45 })
  settle(base)
  assert.ok(
    base.camera.fov >= 68 && base.camera.fov <= 72,
    `the chase base FOV must be 68-72 degrees, got ${base.camera.fov}`,
  )

  /*
  Every FOV assertion above runs with no load and no reheat, which is exactly the condition
  under which the manoeuvre terms are worth nothing. Hold everything at once — a maximum
  High-G pull, full reheat, and enough speed to saturate the speed term — and pin the total.

  The bound is what "slight" means in numbers. A lens that walks 15 degrees on a key the
  player presses and releases through a whole dogfight is a pulse, not feedback, and the
  brief rules it out; nothing here may drift past a swing the eye reads as weight.
  */
  {
    const quiet = createRig({ speed: 1500 / 22 })
    const loaded = createRig({ speed: 1500 / 22 })
    settle(quiet)
    loaded.aircraft.highGBlend = 1
    for (let frame = 0; frame < 480; frame += 1) {
      loaded.step()
      updateChaseCamera(loaded.chase, loaded.camera, {
        aircraftState: loaded.aircraft,
        attitude: loaded.attitude,
        speed: loaded.aircraft.velocity.length(),
        burnerLevel: 1,
        step: FRAME,
        cameraLook: loaded.look,
      })
    }
    assert.ok(
      loaded.camera.fov > quiet.camera.fov + 1,
      `the lens must open under load and reheat, ${loaded.camera.fov} vs ${quiet.camera.fov}`,
    )
    assert.ok(
      loaded.camera.fov < 82,
      `worst-case FOV must stay under 82°, got ${loaded.camera.fov}°`,
    )
    // And the swing, which is what the player actually sees, because both ends of it are on
    // keys they hold and release constantly. This is the assertion that fails first if the
    // manoeuvre and reheat terms are ever tuned up together.
    const swing = loaded.camera.fov - quiet.camera.fov
    assert.ok(
      swing < 9,
      `the lens must breathe rather than pulse, swings ${swing}° end to end`,
    )
    assert.ok(
      loaded.camera.position.distanceTo(loaded.aircraft.position)
        > quiet.camera.position.distanceTo(quiet.aircraft.position),
      'the boom must ease out under load rather than only opening the lens',
    )
  }

  // No storage here at all, which is the same shape as a browser in private mode: both
  // readers have to fall back rather than throw on the way to the range.
  assert.equal(readFlightCameraRoll(), 'hybrid', 'camera roll must fall back without storage')
  assert.equal(
    readFlightCameraDistance(), 'normal', 'camera distance must fall back without storage',
  )

  globalThis.window = {
    localStorage: {
      getItem: (key) => (key === 'f22-flight-camera-roll' ? 'off' : null),
    },
  }
  assert.equal(
    readFlightCameraRoll(), 'off', 'a stored roll preference must be honoured',
  )
  delete globalThis.window
}

// --------------------------------------------------------- the chase is a flight frame
// Nose and velocity are deliberately separated here. The camera's follow axis must land
// between them, proving it does not merely copy the aircraft quaternion.
{
  const rig = createRig()
  settle(rig)
  rig.aircraft.orientation.setFromAxisAngle(
    new Vector3(0, 1, 0),
    MathUtils.degToRad(70),
  )
  refreshAttitude(rig.attitude, rig.aircraft)
  // Momentum continues along world +X while the nose yaws away from it.
  for (let frame = 0; frame < 180; frame += 1) rig.step({ preserveVelocity: true })
  const noseGap = MathUtils.radToDeg(rig.chase.followForward.angleTo(rig.attitude.forward))
  const pathGap = MathUtils.radToDeg(rig.chase.followForward.angleTo(
    new Vector3().copy(rig.aircraft.velocity).normalize(),
  ))
  assert.ok(
    noseGap > 5 && pathGap > noseGap,
    `the chase must blend nose and velocity, got nose ${noseGap}° path ${pathGap}°`,
  )

  // Under Roll On the roll axis is rigid: a held 60° bank puts the camera 60° off level,
  // because the camera's up *is* the airframe's up. No filter and no share to settle into —
  // the horizon goes round and the aircraft does not. This is the pre-setting rig, and it
  // has to remain recoverable exactly, or Roll On is a new camera wearing the old name.
  rig.aircraft.orientation.setFromAxisAngle(
    new Vector3(1, 0, 0),
    MathUtils.degToRad(60),
  )
  rig.aircraft.velocity.set(200, 0, 0)
  refreshAttitude(rig.attitude, rig.aircraft)
  for (let frame = 0; frame < 120; frame += 1) rig.step({ preserveVelocity: true })
  const bankFollow = MathUtils.radToDeg(rig.chase.followUp.angleTo(LOCAL_UP))
  assert.ok(
    bankFollow > 58 && bankFollow < 62,
    `Roll On must carry the whole 60° bank, got ${bankFollow}°`,
  )
  const bodyGap = MathUtils.radToDeg(rig.chase.followUp.angleTo(rig.attitude.up))
  assert.ok(
    bodyGap < 0.5,
    `Roll On up must be the airframe's up, off by ${bodyGap}°`,
  )
  assert.ok(
    Math.abs(rig.chase.screenRoll) < 1e-9,
    `Roll On must ask the pointer stick for no correction, got ${rig.chase.screenRoll}`,
  )
}

// ------------------------------------------------- the stick owes the setting a rotation
/*
Roll Off is the position where screen-up stops being body pitch-up, and the correction the
rig publishes is what puts them back together. The requirement is exact rather than
directional: the airframe appears rotated inside the frame by precisely the bank the camera
declined to take, so the published angle must equal the airframe's own bank at Roll Off and
be a fraction of it at Hybrid.

Without this the roll setting would silently re-map the mouse — a control changing meaning
because of a camera preference, which is the one failure a player could never diagnose.
*/
{
  for (const [mode, expected] of [['off', 1], ['hybrid', 0.75], ['on', 0]]) {
    const rig = createRig({ rollMode: mode })
    settle(rig)
    rig.aircraft.orientation.setFromAxisAngle(new Vector3(1, 0, 0), MathUtils.degToRad(40))
    rig.aircraft.velocity.set(200, 0, 0)
    refreshAttitude(rig.attitude, rig.aircraft)
    for (let frame = 0; frame < 240; frame += 1) rig.step({ preserveVelocity: true })
    const bank = MathUtils.radToDeg(rig.chase.rollAngle)
    const screen = MathUtils.radToDeg(rig.chase.screenRoll)
    assert.ok(
      Math.abs(Math.abs(bank) - 40) < 1,
      `${mode} must measure the airframe's own 40° bank, got ${bank}°`,
    )
    assert.ok(
      Math.abs(Math.abs(screen) - (40 * expected)) < 2,
      `${mode} must publish a ${40 * expected}° stick correction, got ${screen}°`,
    )
    // Same sign as the bank, always. A correction that pointed the other way would double
    // the error instead of cancelling it, and would still pass a magnitude-only check.
    if (expected > 0) {
      assert.ok(
        Math.sign(screen) === Math.sign(bank),
        `${mode} stick correction must share the bank's sign, ${screen}° against ${bank}°`,
      )
    }
  }
}

// -------------------------------------------------------------- the aircraft rolls, not
/*
A barrel roll is where the three settings have to be three different cameras, and where all
three have to be continuous.

What differs is how far over the camera goes. Roll On carries the whole bank, so `up.y` must
reach below −0.9 at the top of each turn; Roll Off holds the horizon, so it must never get
anywhere near that; Hybrid sits between and inside its clamp. The cockpit is in the loop
because a pilot's head is bolted to the airframe and must behave exactly like Roll On.

What none of them may do is step. At 120°/s and a sixtieth of a second the honest per-frame
travel is 2°, so anything above 3 is a discontinuity, and the basis must stay orthonormal and
finite the whole way round — three full turns, so an accumulating drift has room to show
rather than being caught once at a lucky attitude. That is the assertion that would have
failed if the up vector were blended instead of built from an angle: opposed vectors are a
fixed point for a lerp and a barrel roll passes through opposed twice per turn.
*/
for (const subject of [
  { rollMode: 'on', over: true },
  { rollMode: 'hybrid', over: false },
  { rollMode: 'off', over: false },
  { mode: 'nose', over: true },
]) {
  const { over, ...options } = subject
  const name = options.mode ?? `roll-${options.rollMode}`
  const rig = createRig(options)
  settle(rig)
  const bodyRate = { axis: new Vector3(1, 0, 0), rate: MathUtils.degToRad(120) }
  let worstJump = 0
  let worstSkew = 0
  let lowest = 1
  let previousUp = new Vector3().copy(rig.camera.up)
  for (let frame = 0; frame < 540; frame += 1) {
    rig.step({ bodyRate, preserveVelocity: true })
    assert.ok(
      Number.isFinite(rig.camera.up.x + rig.camera.up.y + rig.camera.up.z),
      `${name} camera up must stay finite, frame ${frame}`,
    )
    lowest = Math.min(lowest, rig.camera.up.y)
    worstJump = Math.max(worstJump, MathUtils.radToDeg(rig.camera.up.angleTo(previousUp)))
    worstSkew = Math.max(worstSkew, basisError(rig.camera))
    previousUp = new Vector3().copy(rig.camera.up)
  }
  if (over) {
    assert.ok(
      lowest < -0.9,
      `${name} must roll all the way over with the airframe, lowest up.y ${lowest}`,
    )
  } else {
    // 0.9 is a little over 25 degrees off level, which is comfortably outside the widest
    // clamp any position uses and comfortably inside "the horizon stayed readable".
    assert.ok(
      lowest > 0.9,
      `${name} must keep the horizon through a barrel roll, lowest up.y ${lowest}`,
    )
  }
  assert.ok(
    worstJump < 3,
    `${name} camera up must never step, worst frame ${worstJump}°`,
  )
  assert.ok(
    worstSkew < 1e-5,
    `${name} rendered camera basis must stay orthonormal, worst ${worstSkew}`,
  )
}

// ------------------------------------------------------- changing the setting mid-flight
/*
The setting is a runtime control, so a pilot may move it while banked — the pause menu is
reachable at any attitude, and the change lands on the first frame after they resume.

The share it resolves is continuous in the blend terms but not in the setting itself, so the
one thing this can never do is jump: the camera has to walk from one share of the bank to the
other. It does that for free, because the up vector is rebuilt from an angle every frame and
the response of the whole rig is what limits how fast the rendered basis can follow it.
*/
{
  const rig = createRig({ rollMode: 'on' })
  settle(rig)
  rig.aircraft.orientation.setFromAxisAngle(new Vector3(1, 0, 0), MathUtils.degToRad(75))
  rig.aircraft.velocity.set(200, 0, 0)
  refreshAttitude(rig.attitude, rig.aircraft)
  for (let frame = 0; frame < 240; frame += 1) rig.step({ preserveVelocity: true })

  let previousUp = new Vector3().copy(rig.camera.up)
  let worstJump = 0
  // Same rig, same aircraft, new setting — exactly what the menu does.
  for (let frame = 0; frame < 240; frame += 1) {
    rig.aircraft.position.addScaledVector(rig.aircraft.velocity, FRAME)
    updateChaseCamera(rig.chase, rig.camera, {
      aircraftState: rig.aircraft,
      attitude: rig.attitude,
      speed: rig.aircraft.velocity.length(),
      burnerLevel: 0,
      step: FRAME,
      rollMode: 'off',
      cameraLook: rig.look,
    })
    worstJump = Math.max(worstJump, MathUtils.radToDeg(rig.camera.up.angleTo(previousUp)))
    previousUp = new Vector3().copy(rig.camera.up)
  }
  assert.ok(
    worstJump < 6,
    `changing the roll setting must walk the horizon over rather than cut, worst ${worstJump}°`,
  )
  assert.ok(
    Math.abs(horizonRollDeg(rig.camera)) < 1,
    `the camera must finish level after switching to Roll Off, ${horizonRollDeg(rig.camera)}°`,
  )
}

// ------------------------------------------------------------------- straight up and down
/*
The attitude a level horizon cannot survive on its own. World up across the sightline
vanishes at the pole and comes back pointing the other way — a camera behind an aircraft
going over the top of a loop looks up-range on the way up and down-range on the way down, so
the horizon it was holding is now behind it. That half-turn is real and no reference frame
removes it.

The airframe's own up has no such degeneracy, which is why the riding family and the cockpit
are held to a strict bound here: at 90°/s and a sixtieth of a second the honest travel is
1.5°, so 4 is generous and a genuine step would be tens of degrees.

The stabilised family is held to its designed bound instead, which is a different claim
rather than a weaker one. `ROLL_CORRECTION_RATE` caps the recovery at 200°/s — 3.33° a frame
— and the sightline is meanwhile turning at 90°/s, so 5 is the arithmetic worst case for the
two composing. What the test is really asserting is that the half-turn is *paid for over
about a second at a bounded rate* rather than taken in one frame; the same code with the rate
limit removed reads 180 here.
*/
for (const subject of [
  { rollMode: 'on', ceiling: 4 },
  { rollMode: 'hybrid', ceiling: 5 },
  { rollMode: 'off', ceiling: 5 },
  { mode: 'nose', ceiling: 4 },
]) {
  const { ceiling, ...options } = subject
  const name = options.mode ?? `roll-${options.rollMode}`
  const rig = createRig(options)
  settle(rig)
  // Pitch, not roll: this drives the sightline straight up, over the top, and straight down.
  const bodyRate = { axis: new Vector3(0, 0, 1), rate: MathUtils.degToRad(90) }
  let worstJump = 0
  let worstSkew = 0
  let previousUp = new Vector3().copy(rig.camera.up)
  for (let frame = 0; frame < 480; frame += 1) {
    rig.step({ bodyRate })
    assert.ok(
      Number.isFinite(rig.camera.up.x + rig.camera.up.y + rig.camera.up.z)
        && Math.abs(rig.camera.up.length() - 1) < 1e-6,
      `${name} camera up must stay a unit vector through the pole, frame ${frame}`,
    )
    worstJump = Math.max(worstJump, MathUtils.radToDeg(rig.camera.up.angleTo(previousUp)))
    worstSkew = Math.max(worstSkew, basisError(rig.camera))
    previousUp = new Vector3().copy(rig.camera.up)
  }
  assert.ok(
    worstJump < ceiling,
    `${name} camera up must not step at the pole, worst frame ${worstJump}°`,
  )
  assert.ok(
    worstSkew < 1e-5,
    `${name} rendered camera basis must stay orthonormal at the pole, worst ${worstSkew}`,
  )
}

// -------------------------------------------- the post-stall shot holds the entry flight path
/*
A full Kulbit rotates inside the velocity frame captured at entry. The shot is allowed a
small deterministic dolly, arc, tilt, and lens breath, but none may become a second turn that
chases the aircraft nose around the loop.

Entry is measured separately from the hold, because the two make opposite promises. Entry is
a move: the camera leaves the cruise framing and composes onto the closer post-stall one over
the settle window, which is what puts the airframe big enough in frame to watch it rotate.
The hold is a promise not to move, and it is the one the pilot was given. Measuring both
across one window would let a sloppy hold hide inside the entry travel.
*/
{
  const rig = createRig()
  settle(rig)
  const cruiseRadius = rig.camera.position.distanceTo(rig.aircraft.position)
  rig.aircraft.psmPhase = 'post-stall'
  rig.aircraft.psmBlend = 1
  rig.aircraft.input.pitch = 1
  const fullFlip = { axis: new Vector3(0, 0, 1), rate: Math.PI / 2 }

  // The settle window is a little under half a second; 40 frames clears it with margin.
  let worstEntryStep = 0
  let previousRadius = cruiseRadius
  for (let frame = 0; frame < 40; frame += 1) {
    rig.step({ bodyRate: fullFlip, preserveVelocity: true })
    const radius = rig.camera.position.distanceTo(rig.aircraft.position)
    worstEntryStep = Math.max(worstEntryStep, Math.abs(radius - previousRadius))
    previousRadius = radius
  }
  assert.ok(
    previousRadius < cruiseRadius * 0.9,
    `entry must pull in to the closer post-stall framing, ${cruiseRadius} to ${previousRadius}`,
  )
  assert.ok(
    worstEntryStep < 0.5,
    `entry must dolly rather than cut, worst frame moved ${worstEntryStep} units`,
  )

  const entryView = new Quaternion().copy(rig.camera.quaternion)
  const entryFov = rig.camera.fov
  let worstView = 0
  let worstFov = 0
  let closestRadius = Infinity
  let farthestRadius = 0
  for (let frame = 0; frame < 440; frame += 1) {
    rig.step({ bodyRate: frame < 200 ? fullFlip : undefined, preserveVelocity: true })
    const radius = rig.camera.position.distanceTo(rig.aircraft.position)
    closestRadius = Math.min(closestRadius, radius)
    farthestRadius = Math.max(farthestRadius, radius)
    worstView = Math.max(worstView, rig.camera.quaternion.angleTo(entryView))
    worstFov = Math.max(worstFov, Math.abs(rig.camera.fov - entryFov))
  }
  assert.equal(rig.chase.actionHeld, true, 'the shot must hold indefinitely after a Kulbit')
  assert.ok(
    rig.chase.actionFrameForward.angleTo(new Vector3(1, 0, 0)) < 1e-6,
    'the shot must capture the entry velocity direction, not the rotating nose',
  )
  assert.ok(
    MathUtils.radToDeg(worstView) < 6,
    `cinematic drift must stay subtle through the flip, moved ${MathUtils.radToDeg(worstView)}°`,
  )
  assert.ok(
    farthestRadius / closestRadius < 1.08,
    `the held dolly must stay inside an 8% framing window, ${closestRadius} to ${farthestRadius}`,
  )
  assert.ok(
    worstFov < 1,
    `lens breath must stay below one degree during the hold, moved ${worstFov}°`,
  )
}

/*
A centred stick keeps a Cobra in the inertial shot for as long as the pilot wants. Pitch Down
is the handoff: recovery follows the returning nose, starts without a cut, travels an orbit
instead of a chord through the aircraft, and completes inside the authored window.

Run at both ends of the roll setting, because the release is where the two systems touch. The
held shot freezes the camera's own up in a world frame for the duration; when it lets go, that
frozen up slerps back to whatever the live rig is holding — the airframe's up under Roll On,
a level one under Roll Off. Those can be most of a half-turn apart after a shot composed
through inverted flight, and the handoff has to absorb it on the same clock as the boom
either way.
*/
for (const rollMode of ['on', 'off']) {
  const rig = createRig({ rollMode })
  settle(rig)
  rig.aircraft.psmPhase = 'post-stall'
  rig.aircraft.psmBlend = 1
  rig.aircraft.input.pitch = 1
  rig.aircraft.noseOffPathDeg = 90
  const cobraPull = { axis: new Vector3(0, 0, 1), rate: Math.PI / 2 }
  for (let frame = 0; frame < 60; frame += 1) {
    rig.step({ bodyRate: cobraPull, preserveVelocity: true })
  }
  rig.aircraft.input.pitch = 0
  rig.aircraft.psmPhase = 'cobra-hold'
  for (let frame = 0; frame < 300; frame += 1) rig.step({ preserveVelocity: true })
  assert.equal(rig.chase.actionHeld, true, 'a centred Cobra must keep the inertial shot')
  assert.equal(rig.chase.actionReturning, false, 'elapsed hold time must not return Action')

  const heldView = new Quaternion().copy(rig.camera.quaternion)
  const returnStartRadius = rig.camera.position.distanceTo(rig.aircraft.position)
  let nearestReturnRadius = returnStartRadius
  let returnFrames = -1
  rig.aircraft.input.pitch = -1
  rig.aircraft.psmPhase = 'recovery'
  const pitchDown = { axis: new Vector3(0, 0, 1), rate: -MathUtils.degToRad(120) }
  for (let frame = 0; frame < 90; frame += 1) {
    rig.aircraft.noseOffPathDeg = Math.max(0, 90 - ((frame + 1) * 2))
    rig.step({ bodyRate: frame < 45 ? pitchDown : undefined, preserveVelocity: true })
    nearestReturnRadius = Math.min(
      nearestReturnRadius,
      rig.camera.position.distanceTo(rig.aircraft.position),
    )
    if (returnFrames < 0 && !rig.chase.actionReturning) returnFrames = frame + 1
    if (frame === 0) {
      assert.ok(
        heldView.angleTo(rig.camera.quaternion) < MathUtils.degToRad(2),
        'the first Pitch Down recovery frame must not snap toward the nose',
      )
    }
  }
  const returnSeconds = returnFrames * FRAME
  assert.equal(rig.chase.actionHeld, false, 'Pitch Down must release the inertial hold')
  assert.ok(
    returnSeconds >= 0.6 && returnSeconds <= 0.9,
    `Action recovery must finish in 0.6–0.9s, took ${returnSeconds}s`,
  )
  assert.ok(
    nearestReturnRadius > returnStartRadius * 0.72,
    `Action recovery must orbit, not cut through the aircraft: ${nearestReturnRadius}`,
  )
  for (let frame = 0; frame < 180; frame += 1) rig.step({ preserveVelocity: true })
  assert.ok(
    rig.camera.position.distanceTo(rig.chase.position) < 0.06,
    `Action must settle back onto the live nose-follow position, gap ${rig.camera.position.distanceTo(rig.chase.position)}`,
  )
  assert.equal(rig.chase.actionReturning, false, 'Action recovery must finish cleanly')
}

// The flight model lets an early Pitch Down release interrupt recovery and hold the new
// attitude. The camera must honour the same ownership: recapture the current screen pose
// without a cut instead of finishing a return the pilot cancelled.
{
  const rig = createRig()
  settle(rig)
  rig.aircraft.psmPhase = 'post-stall'
  rig.aircraft.psmBlend = 1
  rig.aircraft.input.pitch = 1
  for (let frame = 0; frame < 45; frame += 1) {
    rig.step({
      bodyRate: { axis: new Vector3(0, 0, 1), rate: Math.PI / 2 },
      preserveVelocity: true,
    })
  }
  rig.aircraft.psmPhase = 'recovery'
  rig.aircraft.input.pitch = -1
  rig.aircraft.noseOffPathDeg = 65
  rig.step({ preserveVelocity: true })
  assert.equal(rig.chase.actionReturning, true, 'Pitch Down must begin camera recovery')
  const interruptedView = new Quaternion().copy(rig.camera.quaternion)

  rig.aircraft.psmPhase = 'cobra-hold'
  rig.aircraft.input.pitch = 0
  rig.step({ preserveVelocity: true })
  assert.equal(rig.chase.actionHeld, true, 'an interrupted recovery must resume Action hold')
  assert.equal(rig.chase.actionReturning, false, 'resumed hold must cancel camera recovery')
  assert.ok(
    interruptedView.angleTo(rig.camera.quaternion) < MathUtils.degToRad(1),
    'resuming hold must capture the current view without a cut',
  )
}

/*
Which reference wins, and when — the whole of the merged camera in one comparison.

Two identical half-loops with the velocity held along the original flight path, so the nose
ends up reversed relative to the motion. The only difference is whether the flight model is
reporting post-stall authority.

Without it the camera is nose-dominant and stays behind the nose. That is the readable
Battlefield-side camera and it is what ordinary flight has to feel like: a lens that chased
the flight path in level flight would lag every input by however long the trajectory takes
to answer it, and the aircraft would stop feeling connected to the hand.

With it the camera leans hard onto the flight path, which keeps it behind the *motion* while
the reversed nose points back toward the screen — the cinematic front view a Cobra or an
Immelmann needs, and the reason the post-stall shot reads as a manoeuvre rather than as the
camera being dragged around by a quaternion.
*/
{
  const halfLoop = { axis: new Vector3(0, 0, 1), rate: Math.PI / 2 }
  const fly = (psmBlend) => {
    const rig = createRig()
    settle(rig)
    rig.aircraft.psmBlend = psmBlend
    for (let frame = 0; frame < 120; frame += 1) {
      rig.step({ bodyRate: halfLoop, preserveVelocity: true })
    }
    for (let frame = 0; frame < 90; frame += 1) rig.step({ preserveVelocity: true })
    return {
      towardCamera: new Vector3()
        .subVectors(rig.camera.position, rig.aircraft.position)
        .normalize()
        .dot(rig.attitude.forward),
      pathGap: MathUtils.radToDeg(rig.chase.followForward.angleTo(
        new Vector3().copy(rig.aircraft.velocity).normalize(),
      )),
    }
  }

  const cruise = fly(0)
  assert.ok(
    cruise.towardCamera < 0.2,
    `ordinary flight must stay behind the nose, nose-to-lens ${cruise.towardCamera}`,
  )
  assert.ok(
    cruise.pathGap > 100,
    `ordinary flight must read the nose rather than the path, gap ${cruise.pathGap}°`,
  )

  const postStall = fly(1)
  assert.ok(
    postStall.towardCamera > 0.8,
    `an Immelmann nose must point toward the post-stall lens, ${postStall.towardCamera}`,
  )
  assert.ok(
    postStall.pathGap < 10,
    `the post-stall shot must stay close to the flight path, gap ${postStall.pathGap}°`,
  )
}

// --------------------------------------------------------------- the boom yields to terrain
/*
A chase camera ten units behind the aircraft is ten units closer to a ridge every time the
jet crosses one at low level, and a lens inside a hill is a frame of solid rock at the moment
the pilot most needs to see out of it.

The aircraft is parked so the geometry stays fixed and the assertions are about the boom
rather than about where anything happened to have flown. The wall sits between the aircraft
and where the boom wants to be, so the camera has to come in; taking the wall away has to let
it back out, and — the part worth testing — it has to do that without a step, because a boom
that snapped back to full length the instant a ridge cleared would lurch on every terrain
feature the aircraft passed.
*/
{
  const wall = new Mesh(new PlaneGeometry(400, 400), new MeshBasicMaterial())
  wall.rotation.y = Math.PI / 2
  wall.position.set(-5, 400, 0)
  wall.updateMatrixWorld()

  const free = createRig({ speed: 0 })
  settle(free)
  const freeRadius = free.camera.position.distanceTo(free.aircraft.position)

  const blocked = createRig({ speed: 0, terrain: wall })
  settle(blocked)
  const blockedRadius = blocked.camera.position.distanceTo(blocked.aircraft.position)
  assert.equal(blocked.chase.collision.blocked, true, 'the wall must be reported as blocking')
  assert.ok(
    blockedRadius < freeRadius * 0.6,
    `the boom must pull in past a wall, ${blockedRadius} against a free ${freeRadius}`,
  )
  assert.ok(
    blockedRadius > 1,
    `the boom must keep a working framing distance, got ${blockedRadius}`,
  )

  // The wall goes away. The camera may take its time coming back out but may not jump.
  let previousRadius = blockedRadius
  let worstStep = 0
  for (let frame = 0; frame < 240; frame += 1) {
    updateChaseCamera(blocked.chase, blocked.camera, {
      aircraftState: blocked.aircraft,
      attitude: blocked.attitude,
      speed: 0,
      burnerLevel: 0,
      step: FRAME,
      cameraLook: blocked.look,
    })
    const radius = blocked.camera.position.distanceTo(blocked.aircraft.position)
    worstStep = Math.max(worstStep, Math.abs(radius - previousRadius))
    previousRadius = radius
  }
  assert.ok(
    worstStep < 0.35,
    `the boom must ease back out rather than snap, worst frame moved ${worstStep} units`,
  )
  assert.ok(
    Math.abs(previousRadius - freeRadius) < 0.2,
    `the boom must return to its authored length, ${previousRadius} against ${freeRadius}`,
  )
}

// ------------------------------------------------------------------ the target reference
/*
The look-at-the-enemy camera, which the project has no enemy for yet. What is testable today
is everything on the camera's side of that gap: a held target bends the lens toward it, the
bend is damped rather than a snap, the boom and lens open as the target moves off the nose so
both can share a frame, and letting go puts the ordinary chase back without a cut.

Nothing here touches the aircraft, which is the whole premise of the shot — it is a look, not
a change of heading — and there is nothing to assert about that because the rig has no way to
reach the flight state at all.
*/
{
  // Ninety degrees off the nose, which is the angle that exercises the separation terms.
  const target = { position: new Vector3(0, 400, 600) }
  const plain = createRig({ speed: 0 })
  settle(plain)
  const plainRadius = plain.camera.position.distanceTo(plain.aircraft.position)
  const plainFov = plain.camera.fov

  const tracking = createRig({ speed: 0, target, targetHeld: true })
  settle(tracking)

  const lens = new Vector3(0, 0, -1).applyQuaternion(tracking.camera.quaternion)
  const toTarget = new Vector3().subVectors(target.position, tracking.camera.position).normalize()
  const plainLens = new Vector3(0, 0, -1).applyQuaternion(plain.camera.quaternion)
  assert.ok(
    lens.dot(toTarget) > plainLens.dot(toTarget) + 0.3,
    `holding a target must swing the lens toward it, ${lens.dot(toTarget)}`,
  )
  // Deliberately short of pinning the enemy dead centre: a camera that did would read as a
  // turret and would drop every cue about where the aircraft itself is pointing.
  assert.ok(
    lens.dot(toTarget) < 0.995,
    `target tracking must stay damped rather than pinning the enemy, ${lens.dot(toTarget)}`,
  )
  assert.ok(
    tracking.camera.position.distanceTo(tracking.aircraft.position) > plainRadius * 1.05,
    'a target well off the nose must open the boom so both fit the frame',
  )
  assert.ok(
    tracking.camera.fov > plainFov + 1,
    `a target well off the nose must open the lens, ${tracking.camera.fov} against ${plainFov}`,
  )

  // Let go. The shot has to come back to the ordinary chase, and the release has to be a
  // move rather than a cut.
  let previousView = new Quaternion().copy(tracking.camera.quaternion)
  let worstStep = 0
  for (let frame = 0; frame < 300; frame += 1) {
    updateChaseCamera(tracking.chase, tracking.camera, {
      aircraftState: tracking.aircraft,
      attitude: tracking.attitude,
      speed: 0,
      burnerLevel: 0,
      step: FRAME,
      cameraLook: tracking.look,
      target,
      targetHeld: false,
    })
    worstStep = Math.max(worstStep, previousView.angleTo(tracking.camera.quaternion))
    previousView = new Quaternion().copy(tracking.camera.quaternion)
  }
  assert.ok(
    MathUtils.radToDeg(worstStep) < 2,
    `releasing a target must pan back, worst frame ${MathUtils.radToDeg(worstStep)}°`,
  )
  assert.ok(
    plain.camera.quaternion.angleTo(tracking.camera.quaternion) < MathUtils.degToRad(1),
    'releasing a target must return the ordinary chase view',
  )
  assert.equal(tracking.chase.targetRef.blend, 0, 'a released target must settle fully off')
}

// ------------------------------------------------------- manoeuvre buffet is intentionally calm
// At full High-G/PSM blend the random positional buffet is reduced to 15% of its normal
// amplitude. Pinning Math.random makes that camera-only feedback measurable.
{
  const savedRandom = Math.random
  Math.random = () => 1
  try {
    const normal = createRig()
    const manoeuvring = createRig()
    settle(normal)
    settle(manoeuvring)
    normal.aircraft.aoaDeg = 55
    manoeuvring.aircraft.aoaDeg = 55
    manoeuvring.aircraft.highGBlend = 1
    // Both rigs are flown to a steady state before either is measured. High-G also walks the
    // boom out, and the camera's ease toward a boom that is still moving is a real gap
    // between the camera and its chase position — but it is not buffet, and measuring it as
    // if it were would report the opposite of what this check is about.
    for (let frame = 0; frame < 240; frame += 1) {
      normal.step()
      manoeuvring.step()
    }
    const ordinaryShake = normal.camera.position.distanceTo(normal.chase.position)
    const calmShake = manoeuvring.camera.position.distanceTo(manoeuvring.chase.position)
    assert.ok(
      calmShake < ordinaryShake * 0.2,
      `full-manoeuvre buffet must be strongly reduced, ${calmShake} vs ${ordinaryShake}`,
    )
  } finally {
    Math.random = savedRandom
  }
}

console.log('camera checks passed')
