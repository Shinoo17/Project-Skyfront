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

import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three'

import {
  FLIGHT_CAMERA_DISTANCE_OPTIONS,
  FLIGHT_CAMERA_STYLE_OPTIONS,
  createChaseCameraState,
  readFlightCameraDistance,
  readFlightCameraStyle,
  resetChaseCamera,
  updateChaseCamera,
} from '../src/features/flight/chaseCamera.js'

const FRAME = 1 / 60
const FORWARD = new Vector3(1, 0, 0)
const LOCAL_UP = new Vector3(0, 1, 0)

function createAircraft() {
  return {
    position: new Vector3(0, 400, 0),
    orientation: new Quaternion(),
    velocity: new Vector3(200, 0, 0),
    aoaDeg: 0,
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

function createRig({ mode = 'chase', style = 'normal', distance = 'normal', pitchDeg = 0 } = {}) {
  const aircraft = createAircraft()
  const attitude = createAttitude()
  const camera = new PerspectiveCamera(48, 16 / 9, 0.1, 20000)
  const chase = createChaseCameraState()
  const look = { active: false, yaw: 0, pitch: 0 }
  resetChaseCamera(chase, camera, aircraft)
  if (pitchDeg !== 0) {
    aircraft.orientation.setFromAxisAngle(new Vector3(0, 0, 1), MathUtils.degToRad(pitchDeg))
    aircraft.velocity.copy(FORWARD).applyQuaternion(aircraft.orientation).multiplyScalar(200)
  }
  refreshAttitude(attitude, aircraft)

  const step = ({ bodyRate } = {}) => {
    if (bodyRate) {
      aircraft.orientation
        .multiply(new Quaternion().setFromAxisAngle(bodyRate.axis, bodyRate.rate * FRAME))
        .normalize()
      refreshAttitude(attitude, aircraft)
      aircraft.velocity.copy(FORWARD).applyQuaternion(aircraft.orientation).multiplyScalar(200)
    }
    aircraft.position.addScaledVector(aircraft.velocity, FRAME)
    updateChaseCamera(chase, camera, {
      aircraftState: aircraft,
      attitude,
      speed: aircraft.velocity.length(),
      burnerLevel: 0,
      step: FRAME,
      mode,
      style,
      distance,
      cameraLook: look,
      rearView: false,
    })
  }

  return { aircraft, attitude, camera, chase, look, step }
}

function settle(rig, frames = 240) {
  for (let frame = 0; frame < frames; frame += 1) rig.step()
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
// Every option the pause menu offers has to resolve to a real profile, and the two axes
// have to do what their labels claim: distance moves the camera out, action frames closer
// through a wider lens.
{
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

  const styles = {}
  for (const option of FLIGHT_CAMERA_STYLE_OPTIONS) {
    const rig = createRig({ style: option.id })
    settle(rig)
    styles[option.id] = {
      radius: rig.camera.position.distanceTo(rig.aircraft.position),
      fov: rig.camera.fov,
    }
  }
  assert.ok(
    styles.action.radius < styles.normal.radius && styles.action.fov > styles.normal.fov,
    `action must frame closer through a wider lens, got ${JSON.stringify(styles)}`,
  )

  // No storage here at all, which is the same shape as a browser in private mode: both
  // readers have to fall back rather than throw on the way to the range.
  assert.equal(readFlightCameraStyle(), 'normal', 'camera style must fall back without storage')
  assert.equal(
    readFlightCameraDistance(), 'normal', 'camera distance must fall back without storage',
  )
}

console.log('camera checks passed')
