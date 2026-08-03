import { useGLTF } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  ArrowHelper,
  Box3,
  Color,
  Fog,
  FrontSide,
  MathUtils,
  Mesh,
  PerspectiveCamera,
  Raycaster,
  Vector3,
} from 'three'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { Suspense, useEffect, useMemo, useRef } from 'react'

import { getAircraft } from '../../aircraft'
import { useGraphicsProfile } from '../../three/graphics'
import { makeHinges } from '../../three/hinge'
import { getKTX2Loader, withKTX2 } from '../../three/ktx2'
import { applyClosedRestPose } from '../../three/pose'
import ExhaustPlumes from '../flight/ExhaustPlumes'
import {
  FLIGHT_FIXED_STEP,
  createFlightState,
  resetFlightState,
  stepFlight,
} from '../flight/flightModel'
import {
  createAfterburnerState,
  readMach,
  readTargetAirspeedKmh,
  resetAfterburnerState,
  stepAfterburner,
} from '../flight/performance'
import { applySurfaceTargets } from '../flight/surfaces'
import {
  readAfterburnerCommand,
  readAirBrake,
  readAxes,
  readHighAoA,
  readThrottleDirection,
} from '../flight/useFlightControls'

const TERRAIN_URL = '/Mountain_Valley_Colorado.glb'
const RANGE_SPAN = 3600
const RANGE_EDGE_MARGIN = 70
const FORWARD = new Vector3(1, 0, 0)
const LOCAL_UP = new Vector3(0, 1, 0)
const DOWN = new Vector3(0, -1, 0)
const CHASE_CAMERA_OFFSET = new Vector3(-22, 7, 0)
const CHASE_CAMERA_LOOK_AHEAD = 16
const BASE_FOV = 48
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

// Height above the terrain is a downward raycast against the whole range mesh, which is
// far too expensive to run per frame. Sampling at 10 Hz and easing toward the sample
// costs a tenth as much and still leads the aircraft by more than a wingspan at full
// throttle. CRASH_CLEARANCE is the eased value, not the raw one, so a single stale
// sample over rising ground cannot end the sortie on its own.
const GROUND_SAMPLE_INTERVAL = 0.1
const CRASH_CLEARANCE = 9

// Demand rendering stays synchronized to the display instead of relying on a timer,
// which avoids uneven frame spacing while retaining a deliberate upper bound.
function SyncedFrameLoop({ targetFps }) {
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    invalidate()
    if (!targetFps) return undefined

    let requestId = 0
    let previousFrame = performance.now()
    const frameInterval = 1000 / targetFps

    const tick = (now) => {
      requestId = window.requestAnimationFrame(tick)
      if (document.hidden) {
        previousFrame = now
        return
      }

      const elapsed = now - previousFrame
      if (elapsed < frameInterval - 1) return
      previousFrame = now
      invalidate()
    }

    requestId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(requestId)
  }, [invalidate, targetFps])

  return null
}

function Terrain({ scene, groupRef }) {
  const data = useMemo(() => {
    const model = scene.clone(true)
    model.updateMatrixWorld(true)
    const bounds = new Box3().setFromObject(model)
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())
    const scale = RANGE_SPAN / Math.max(size.x, size.z)

    model.traverse((child) => {
      if (!(child instanceof Mesh)) return
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach((material) => {
        material.side = FrontSide
        material.normalMap = null
        material.roughnessMap = null
        material.metalnessMap = null
        material.roughness = 1
        material.metalness = 0
        if (material.map) material.map.anisotropy = 1
        material.needsUpdate = true
      })
      child.castShadow = false
      child.receiveShadow = false
      child.frustumCulled = true
      child.updateMatrix()
      child.matrixAutoUpdate = false
    })

    return {
      model,
      scale,
      position: new Vector3(
        -center.x * scale,
        -bounds.min.y * scale,
        -center.z * scale,
      ),
    }
  }, [scene])

  return (
    <group ref={groupRef} scale={data.scale} position={data.position}>
      <primitive object={data.model} />
    </group>
  )
}

// World-space force and state arrows, driven straight off the telemetry the flight loop
// publishes. Rendered only while the debug overlay is up; costs nothing otherwise.
const DEBUG_ARROWS = [
  { key: 'forward', color: 0x37d5ff, scale: 24, fixed: true },
  { key: 'velocity', color: 0x62ff84, scale: 0.45 },
  { key: 'liftForce', color: 0x5a8dff, scale: 1.4 },
  { key: 'dragForce', color: 0xff5a5a, scale: 1.4 },
  { key: 'thrustForce', color: 0xffb347, scale: 1.4 },
]

const debugDirection = new Vector3()

function DebugVectors({ telemetry }) {
  const arrows = useMemo(
    () => DEBUG_ARROWS.map((spec) => ({
      spec,
      helper: new ArrowHelper(FORWARD, new Vector3(), 1, spec.color, 2.2, 1.4),
    })),
    [],
  )

  useFrame(() => {
    const state = telemetry.current
    arrows.forEach(({ spec, helper }) => {
      const vector = state[spec.key]
      const usable = state.live && state.position && vector && vector.lengthSq() > 1e-4
      helper.visible = Boolean(usable)
      if (!usable) return
      helper.position.copy(state.position)
      helper.setDirection(debugDirection.copy(vector).normalize())
      helper.setLength(
        spec.fixed ? spec.scale : MathUtils.clamp(vector.length() * spec.scale, 3, 46),
        2.2,
        1.4,
      )
    })
  })

  return (
    <group>
      {arrows.map(({ spec, helper }) => <primitive key={spec.key} object={helper} />)}
    </group>
  )
}

function FlightAircraft({
  aircraft,
  scene,
  animations,
  controls,
  resetId,
  spawnAltitude,
  flightBounds,
  terrainRef,
  telemetry,
}) {
  const envelope = aircraft.flight.envelope
  const group = useRef()
  const previousResetId = useRef(resetId)
  const { camera } = useThree()

  const model = useMemo(() => {
    const clone = cloneSkeleton(scene)
    applyClosedRestPose(clone, animations)

    aircraft.removedObjects.forEach((name) => {
      clone.getObjectByName(name)?.removeFromParent()
    })

    const bounds = new Box3().setFromObject(clone)
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())
    const scale = aircraft.flight.scale / Math.max(size.x, size.y, size.z)
    clone.scale.setScalar(scale)
    clone.position.copy(center).multiplyScalar(-scale)

    clone.traverse((child) => {
      if (!(child instanceof Mesh)) return
      if (aircraft.flight.isFlightDetail(child.name)) child.visible = false
      child.castShadow = false
      child.receiveShadow = false
      child.frustumCulled = true
    })

    return clone
  }, [aircraft, animations, scene])

  const surfaces = useMemo(
    () => makeHinges(model, aircraft.controlSurfaces),
    [aircraft, model],
  )

  const flight = useRef({
    // The 6-DOF-lite state — position, attitude, velocity, and body rates — lives in the
    // flight model. Everything else here is presentation: camera scratch, ground samples,
    // FPS accounting.
    model: createFlightState(),
    accumulator: 0,
    spawn: new Vector3(-260, spawnAltitude, 0),
    previousPosition: new Vector3(-260, spawnAltitude, 0),
    forward: new Vector3(),
    up: new Vector3(),
    cameraPosition: new Vector3(),
    cameraTarget: new Vector3(),
    cameraTranslation: new Vector3(),
    cameraUp: new Vector3(),
    cameraLook: new Vector3(),
    levelUp: new Vector3(),
    attitudeCross: new Vector3(),
    rayOrigin: new Vector3(),
    raycaster: new Raycaster(),
    groundHeight: 0,
    groundSample: 0,
    groundSampledAt: -1,
    decel: 0,
    previousSpeed: 0,
    fov: BASE_FOV,
    fps: 0,
    fpsFrames: 0,
    fpsSampledAt: 0,
    resetAt: -99,
    resetCause: '',
  })

  // Reheat lives beside the flight state rather than on the control ref: the keyboard says
  // only that the pilot is holding the burner, and everything about whether it is alight —
  // the reserve, the spool, the lockout — belongs to the flight model. The plume reads the
  // same object, so the flame can never show thrust the aircraft is not making.
  const reheat = useRef(createAfterburnerState())

  const resetFlight = (cause, keepThrottle = true) => {
    const state = flight.current
    resetAfterburnerState(reheat.current)
    state.spawn.set(-260, spawnAltitude, 0)
    if (!keepThrottle) controls.current.throttle = envelope.idleThrottle
    resetFlightState(
      state.model,
      state.spawn,
      readTargetAirspeedKmh(controls.current.throttle, spawnAltitude, 0, envelope),
      envelope,
    )
    state.previousPosition.copy(state.model.position)
    state.accumulator = 0
    state.groundHeight = 0
    state.groundSample = 0
    state.groundSampledAt = -1
    state.decel = 0
    state.previousSpeed = state.model.velocity.length()
    state.resetCause = cause
    if (group.current) {
      group.current.position.copy(state.model.position)
      group.current.quaternion.identity()
    }
    state.cameraPosition
      .copy(CHASE_CAMERA_OFFSET)
      .applyQuaternion(state.model.orientation)
      .add(state.model.position)
    state.cameraTarget
      .copy(state.model.position)
      .addScaledVector(FORWARD, CHASE_CAMERA_LOOK_AHEAD)
    camera.position.copy(state.cameraPosition)
    camera.up.copy(LOCAL_UP)
    camera.lookAt(state.cameraTarget)
  }

  useEffect(() => {
    resetFlight('', false)
    // The reset function intentionally reads stable refs and Three objects only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spawnAltitude])

  useFrame((state, delta) => {
    if (!group.current) return
    if (previousResetId.current !== resetId) {
      previousResetId.current = resetId
      resetFlight('manual')
      flight.current.resetAt = state.clock.elapsedTime
    }

    // Frame delta is capped so a stalled tab cannot feed the physics a huge step; the
    // model itself always integrates at FLIGHT_FIXED_STEP regardless of refresh rate.
    const step = Math.min(delta, 0.1)
    const pressed = controls.current.pressed
    const input = readAxes(pressed)
    const throttleDirection = readThrottleDirection(pressed)
    controls.current.throttle = MathUtils.clamp(
      controls.current.throttle + (throttleDirection * step * envelope.throttleRate),
      envelope.minThrottle,
      1,
    )

    const burner = stepAfterburner(reheat.current, {
      commanded: readAfterburnerCommand(pressed),
      step,
    }, envelope)

    const current = flight.current
    const aircraftState = current.model

    const command = {
      pitch: input.pitch,
      roll: input.roll,
      yaw: input.yaw,
      flaps: input.flaps,
      throttle: controls.current.throttle,
      airBrake: readAirBrake(pressed),
      highAoA: readHighAoA(pressed),
      burnerLevel: burner.level,
    }

    current.accumulator += step
    while (current.accumulator >= FLIGHT_FIXED_STEP) {
      stepFlight(aircraftState, command, envelope, FLIGHT_FIXED_STEP)
      current.accumulator -= FLIGHT_FIXED_STEP
    }

    const speed = aircraftState.velocity.length()
    current.forward.copy(FORWARD).applyQuaternion(aircraftState.orientation).normalize()

    const now = state.clock.elapsedTime
    if (!current.fpsSampledAt) current.fpsSampledAt = now
    current.fpsFrames += 1
    const fpsElapsed = now - current.fpsSampledAt
    if (fpsElapsed >= 0.5) {
      current.fps = Math.round(current.fpsFrames / fpsElapsed)
      current.fpsFrames = 0
      current.fpsSampledAt = now
    }

    if (terrainRef.current && now - current.groundSampledAt > GROUND_SAMPLE_INTERVAL) {
      current.groundSampledAt = now
      current.rayOrigin.copy(aircraftState.position).setY(aircraftState.position.y + 4)
      current.raycaster.set(current.rayOrigin, DOWN)
      current.raycaster.near = 0
      current.raycaster.far = aircraftState.position.y + 60
      const hit = current.raycaster.intersectObject(terrainRef.current, true)[0]
      current.groundSample = hit ? hit.point.y : 0
    }
    current.groundHeight = MathUtils.lerp(
      current.groundHeight,
      current.groundSample,
      1 - Math.exp(-9 * step),
    )
    const groundClearance = aircraftState.position.y - current.groundHeight

    const resetCause =
      Math.abs(aircraftState.position.x) > flightBounds.x
        || Math.abs(aircraftState.position.z) > flightBounds.z
        ? 'range'
        : groundClearance < CRASH_CLEARANCE || aircraftState.position.y < 8
          ? 'terrain'
          : aircraftState.position.y > flightBounds.altitude
            ? 'ceiling'
            : ''
    if (resetCause) {
      resetFlight(resetCause)
      current.resetAt = now
    }

    group.current.position.copy(aircraftState.position)
    group.current.quaternion.copy(aircraftState.orientation)

    // The surfaces animate from the FCC's smoothed stick, so they move with the same
    // response the airframe answers to. The nozzles are still not driven out here: the
    // chase camera never frames them closely enough to pay for the extra hinge work.
    applySurfaceTargets(
      surfaces,
      aircraft.mixControlSurfaces({
        pitch: aircraftState.input.pitch,
        roll: aircraftState.input.roll,
        yaw: aircraftState.input.yaw,
        flaps: input.flaps,
      }),
      1 - Math.exp(-10 * step),
    )

    current.cameraPosition
      .copy(CHASE_CAMERA_OFFSET)
      .applyQuaternion(aircraftState.orientation)
      .add(aircraftState.position)
    current.cameraTarget
      .copy(aircraftState.position)
      .addScaledVector(current.forward, CHASE_CAMERA_LOOK_AHEAD)
    // Carry the camera by the aircraft's translation before easing the relative chase
    // offset. Without this, high-Mach flight adds speed-dependent lag and makes the jet
    // shrink away from the player even though the configured camera distance is fixed.
    current.cameraTranslation.subVectors(aircraftState.position, current.previousPosition)
    camera.position.add(current.cameraTranslation)
    current.previousPosition.copy(aircraftState.position)
    current.up.copy(LOCAL_UP).applyQuaternion(aircraftState.orientation).normalize()
    current.levelUp
      .copy(LOCAL_UP)
      .addScaledVector(current.forward, -LOCAL_UP.dot(current.forward))
    if (current.levelUp.lengthSq() < 0.0001) current.levelUp.copy(LOCAL_UP)
    current.levelUp.normalize()
    // How much of the level reference is worth using. Identically 1 - CAMERA_BANK_FOLLOW in
    // ordinary flight, faded to nothing where world up stops being a usable roll reference.
    const levelWeight = (1 - CAMERA_BANK_FOLLOW)
      * (1 - MathUtils.smoothstep(Math.abs(current.forward.y), ...CAMERA_VERTICAL_FADE))
      * MathUtils.smoothstep(current.up.y, ...CAMERA_INVERTED_FADE)
    current.cameraUp
      .copy(current.up)
      .lerp(current.levelUp, levelWeight)
      .normalize()
    current.attitudeCross.crossVectors(current.levelUp, current.up)

    const cameraBlend = 1 - Math.exp(-4.5 * step)
    camera.position.lerp(current.cameraPosition, cameraBlend)
    camera.up.lerp(current.cameraUp, cameraBlend * 0.65).normalize()
    // lookAt builds the camera basis by crossing the sightline with up, so an up that has
    // lagged into line with the sightline degenerates the whole basis. Take the component
    // across the sightline before handing it over and that can never happen.
    current.cameraLook.subVectors(current.cameraTarget, camera.position)
    if (current.cameraLook.lengthSq() > 1e-8) {
      current.cameraLook.normalize()
      camera.up.addScaledVector(current.cameraLook, -camera.up.dot(current.cameraLook))
      if (camera.up.lengthSq() < 1e-6) camera.up.copy(current.cameraUp)
      camera.up.normalize()
    }
    camera.lookAt(current.cameraTarget)

    // Deceleration and speed read on the lens: the field of view stretches a little with
    // pace and pinches under hard braking, and deep AoA puts a faint buffet on the
    // camera. All of it is feedback for forces the model is really applying — none of it
    // feeds back into the physics.
    const rawDecel = step > 0 ? (current.previousSpeed - speed) / step : 0
    current.previousSpeed = speed
    current.decel = MathUtils.lerp(current.decel, Math.max(rawDecel, 0), 1 - Math.exp(-5 * step))
    const targetFov = BASE_FOV
      + (7 * MathUtils.clamp((speed - 45) / 28, 0, 1))
      - (8 * MathUtils.clamp(current.decel / 22, 0, 1))
    current.fov = MathUtils.lerp(current.fov, targetFov, 1 - Math.exp(-3.5 * step))
    if (Math.abs(camera.fov - current.fov) > 0.01 && camera instanceof PerspectiveCamera) {
      camera.fov = current.fov
      camera.updateProjectionMatrix()
    }
    const buffet = 0.2
      * MathUtils.smoothstep(Math.abs(aircraftState.aoaDeg), 24, 55)
      * MathUtils.clamp(speed / 30, 0, 1)
      + AFTERBURNER_SHAKE * burner.level
    if (buffet > 0.01) {
      camera.position.x += (Math.random() - 0.5) * buffet
      camera.position.y += (Math.random() - 0.5) * buffet
      camera.position.z += (Math.random() - 0.5) * buffet
    }

    // Published every frame straight into the caller's ref. Nothing here calls setState:
    // the HUD reads this object from its own animation frame and writes the DOM directly,
    // so a 60 Hz range does not re-render the React tree 60 times a second.
    const readout = telemetry.current
    // Stable references, assigned rather than copied: the HUD projects the ladder through
    // this camera and off this position, so it must see the same objects the scene renders.
    readout.camera = camera
    readout.position = aircraftState.position
    readout.forward = current.forward
    readout.velocity = aircraftState.velocity
    readout.liftForce = aircraftState.liftForce
    readout.dragForce = aircraftState.dragForce
    readout.thrustForce = aircraftState.thrustForce
    readout.heading = MathUtils.euclideanModulo(
      MathUtils.radToDeg(Math.atan2(current.forward.z, current.forward.x)),
      360,
    )
    readout.pitch = MathUtils.radToDeg(Math.asin(MathUtils.clamp(current.forward.y, -1, 1)))
    readout.roll = MathUtils.radToDeg(Math.atan2(
      current.attitudeCross.dot(current.forward),
      current.levelUp.dot(current.up),
    ))
    readout.altitude = Math.max(0, aircraftState.position.y)
    readout.groundClearance = Math.max(0, groundClearance)
    readout.ceiling = Math.max(0, flightBounds.altitude - aircraftState.position.y)
    readout.edge = Math.max(0, Math.min(
      flightBounds.x - Math.abs(aircraftState.position.x),
      flightBounds.z - Math.abs(aircraftState.position.z),
    ))
    readout.fps = current.fps
    readout.afterburner = burner.lit
    readout.afterburnerLevel = burner.level
    readout.afterburnerReserve = burner.reserve
    readout.afterburnerSeconds = burner.seconds
    readout.afterburnerCooldown = burner.cooldown
    // One word for the whole burner, so the HUD never has to re-derive the state machine.
    readout.afterburnerState = burner.lockedOut
      ? 'depleted'
      : burner.lit
        ? 'engaged'
        : 'off'
    readout.mach = readMach(aircraftState.speedKmh, aircraftState.position.y, envelope)
    readout.speed = aircraftState.speedKmh
    readout.verticalSpeed = aircraftState.velocity.y
    readout.throttle = controls.current.throttle
    readout.flaps = input.flaps
    readout.aoa = aircraftState.aoaDeg
    readout.sideslip = aircraftState.sideslipDeg
    readout.gLoad = aircraftState.gLoad
    readout.pitchRate = MathUtils.radToDeg(aircraftState.angularVelocity.z)
    readout.rollRate = MathUtils.radToDeg(aircraftState.angularVelocity.x)
    readout.yawRate = MathUtils.radToDeg(aircraftState.angularVelocity.y)
    readout.highAoA = aircraftState.highAoA
    readout.airBrake = aircraftState.airBrake
    readout.thrustVector = aircraftState.thrustVectorDeg
    readout.maneuver = aircraftState.maneuver
    readout.positionX = MathUtils.clamp(aircraftState.position.x / flightBounds.x, -1, 1)
    readout.positionZ = MathUtils.clamp(aircraftState.position.z / flightBounds.z, -1, 1)
    readout.resetCause = current.resetCause
    readout.sinceReset = now - current.resetAt
    readout.live = true
  })

  return (
    <group ref={group} position={[-260, spawnAltitude, 0]}>
      <primitive object={model} />
      <ExhaustPlumes
        aircraft={aircraft}
        model={model}
        controls={controls}
        reheat={reheat}
        continuous
      />
    </group>
  )
}

function FlightWorld({ aircraft, controls, resetId, telemetry }) {
  const terrainRef = useRef()
  const renderer = useThree((state) => state.gl)
  const ktx2Loader = useMemo(() => getKTX2Loader(renderer), [renderer])
  const terrainGltf = useGLTF(TERRAIN_URL, false, true, withKTX2(ktx2Loader))
  const aircraftGltf = useGLTF(aircraft.url, false, true, withKTX2(ktx2Loader))

  const rangeMetrics = useMemo(() => {
    terrainGltf.scene.updateMatrixWorld(true)
    const size = new Box3().setFromObject(terrainGltf.scene).getSize(new Vector3())
    const scale = RANGE_SPAN / Math.max(size.x, size.z)
    return {
      terrainHeight: size.y * scale,
      halfWidth: (size.x * scale * 0.5) - RANGE_EDGE_MARGIN,
      halfDepth: (size.z * scale * 0.5) - RANGE_EDGE_MARGIN,
    }
  }, [terrainGltf.scene])
  const spawnAltitude = Math.max(190, rangeMetrics.terrainHeight + 58)
  const flightBounds = useMemo(() => ({
    x: rangeMetrics.halfWidth,
    z: rangeMetrics.halfDepth,
    altitude: rangeMetrics.terrainHeight + 1460,
  }), [rangeMetrics])

  return (
    <>
      <Terrain scene={terrainGltf.scene} groupRef={terrainRef} />
      <FlightAircraft
        aircraft={aircraft}
        scene={aircraftGltf.scene}
        animations={aircraftGltf.animations}
        controls={controls}
        resetId={resetId}
        spawnAltitude={spawnAltitude}
        flightBounds={flightBounds}
        terrainRef={terrainRef}
        telemetry={telemetry}
      />
    </>
  )
}

export default function TestFlightScene({
  controls,
  resetId,
  telemetry,
  aircraftId,
  debug = false,
}) {
  const aircraft = getAircraft(aircraftId)
  const graphics = useGraphicsProfile('medium')

  return (
    <Canvas
      frameloop="demand"
      dpr={graphics.dpr}
      shadows={graphics.shadows}
      camera={{ position: [-286, 480, 0], fov: BASE_FOV, near: 0.3, far: 3600 }}
      gl={{
        antialias: graphics.antialias,
        alpha: false,
        depth: true,
        stencil: false,
        powerPreference: graphics.powerPreference,
      }}
      onCreated={({ gl, scene, camera }) => {
        gl.setClearColor(new Color('#688293'))
        gl.toneMappingExposure = 1.05
        scene.fog = new Fog('#78909d', 460, 2700)
        if (camera instanceof PerspectiveCamera) camera.updateProjectionMatrix()
      }}
    >
      <hemisphereLight args={['#dbe9ee', '#26352f', 2.2]} />
      <directionalLight position={[-180, 260, 120]} intensity={2.8} color="#fff2d4" />
      <Suspense fallback={null}>
        <FlightWorld
          aircraft={aircraft}
          controls={controls}
          resetId={resetId}
          telemetry={telemetry}
        />
      </Suspense>
      {debug && <DebugVectors telemetry={telemetry} />}
      <SyncedFrameLoop targetFps={graphics.targetFps} />
    </Canvas>
  )
}
