import { useGLTF } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  Box3,
  Color,
  Euler,
  Fog,
  FrontSide,
  MathUtils,
  Mesh,
  PerspectiveCamera,
  Quaternion,
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
  createAfterburnerState,
  readAccelerationKmhPerSecond,
  readMach,
  readTargetAirspeedKmh,
  readWorldSpeed,
  resetAfterburnerState,
  stepAfterburner,
} from '../flight/performance'
import { applySurfaceTargets } from '../flight/surfaces'
import {
  readAfterburnerCommand,
  readAxes,
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

// A chase camera that copies the full aircraft bank makes the pitch ladder sweep across
// the whole HUD during a turn. Following only part of the bank keeps the sightline calm
// while the ladder and terrain remain registered through the same camera.
const CAMERA_BANK_FOLLOW = 0.35

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
    position: new Vector3(-260, spawnAltitude, 0),
    previousPosition: new Vector3(-260, spawnAltitude, 0),
    orientation: new Quaternion(),
    rotationStep: new Quaternion(),
    rotationEuler: new Euler(0, 0, 0, 'XYZ'),
    forward: new Vector3(),
    up: new Vector3(),
    cameraPosition: new Vector3(),
    cameraTarget: new Vector3(),
    cameraTranslation: new Vector3(),
    cameraUp: new Vector3(),
    levelUp: new Vector3(),
    attitudeCross: new Vector3(),
    rayOrigin: new Vector3(),
    raycaster: new Raycaster(),
    groundHeight: 0,
    groundSample: 0,
    groundSampledAt: -1,
    speedKmh: 0,
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
    state.position.set(-260, spawnAltitude, 0)
    state.previousPosition.copy(state.position)
    state.orientation.identity()
    state.groundHeight = 0
    state.groundSample = 0
    state.groundSampledAt = -1
    state.resetCause = cause
    if (!keepThrottle) controls.current.throttle = envelope.idleThrottle
    state.speedKmh = readTargetAirspeedKmh(
      controls.current.throttle,
      spawnAltitude,
      0,
      envelope,
    )
    if (group.current) {
      group.current.position.copy(state.position)
      group.current.quaternion.identity()
    }
    state.cameraPosition
      .copy(CHASE_CAMERA_OFFSET)
      .applyQuaternion(state.orientation)
      .add(state.position)
    state.cameraTarget
      .copy(state.position)
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

    const step = Math.min(delta, 0.05)
    const pressed = controls.current.pressed
    const input = readAxes(pressed)
    const { pitch, roll, yaw } = input
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
    current.rotationEuler.set(
      roll * MathUtils.degToRad(envelope.rollRate) * step,
      yaw * MathUtils.degToRad(envelope.yawRate) * step,
      pitch * MathUtils.degToRad(envelope.pitchRate) * step,
      'XYZ',
    )
    current.rotationStep.setFromEuler(current.rotationEuler)
    current.orientation.multiply(current.rotationStep).normalize()

    const targetSpeedKmh = readTargetAirspeedKmh(
      controls.current.throttle,
      current.position.y,
      burner.level,
      envelope,
    )
    const acceleration = readAccelerationKmhPerSecond(
      current.speedKmh,
      targetSpeedKmh,
      burner.level,
      current.position.y,
      envelope,
    )
    current.speedKmh += MathUtils.clamp(
      targetSpeedKmh - current.speedKmh,
      -acceleration * step,
      acceleration * step,
    )
    const worldSpeed = readWorldSpeed(current.speedKmh, envelope)
    current.forward.copy(FORWARD).applyQuaternion(current.orientation).normalize()
    current.position.addScaledVector(current.forward, worldSpeed * step)

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
      current.rayOrigin.copy(current.position).setY(current.position.y + 4)
      current.raycaster.set(current.rayOrigin, DOWN)
      current.raycaster.near = 0
      current.raycaster.far = current.position.y + 60
      const hit = current.raycaster.intersectObject(terrainRef.current, true)[0]
      current.groundSample = hit ? hit.point.y : 0
    }
    current.groundHeight = MathUtils.lerp(
      current.groundHeight,
      current.groundSample,
      1 - Math.exp(-9 * step),
    )
    const groundClearance = current.position.y - current.groundHeight

    const resetCause =
      Math.abs(current.position.x) > flightBounds.x || Math.abs(current.position.z) > flightBounds.z
        ? 'range'
        : groundClearance < CRASH_CLEARANCE || current.position.y < 8
          ? 'terrain'
          : current.position.y > flightBounds.altitude
            ? 'ceiling'
            : ''
    if (resetCause) {
      resetFlight(resetCause)
      current.resetAt = now
    }

    group.current.position.copy(current.position)
    group.current.quaternion.copy(current.orientation)

    // The nozzles are not driven out here: the chase camera never frames them closely
    // enough to pay for the extra hinge work.
    applySurfaceTargets(
      surfaces,
      aircraft.mixControlSurfaces(input),
      1 - Math.exp(-10 * step),
    )

    current.cameraPosition
      .copy(CHASE_CAMERA_OFFSET)
      .applyQuaternion(current.orientation)
      .add(current.position)
    current.cameraTarget
      .copy(current.position)
      .addScaledVector(current.forward, CHASE_CAMERA_LOOK_AHEAD)
    // Carry the camera by the aircraft's translation before easing the relative chase
    // offset. Without this, high-Mach flight adds speed-dependent lag and makes the jet
    // shrink away from the player even though the configured camera distance is fixed.
    current.cameraTranslation.subVectors(current.position, current.previousPosition)
    camera.position.add(current.cameraTranslation)
    current.previousPosition.copy(current.position)
    current.up.copy(LOCAL_UP).applyQuaternion(current.orientation).normalize()
    current.levelUp
      .copy(LOCAL_UP)
      .addScaledVector(current.forward, -LOCAL_UP.dot(current.forward))
    if (current.levelUp.lengthSq() < 0.0001) current.levelUp.copy(LOCAL_UP)
    current.levelUp.normalize()
    current.cameraUp
      .copy(current.levelUp)
      .lerp(current.up, CAMERA_BANK_FOLLOW)
      .normalize()
    current.attitudeCross.crossVectors(current.levelUp, current.up)

    const cameraBlend = 1 - Math.exp(-4.5 * step)
    camera.position.lerp(current.cameraPosition, cameraBlend)
    camera.up.lerp(current.cameraUp, cameraBlend * 0.65).normalize()
    camera.lookAt(current.cameraTarget)

    // Published every frame straight into the caller's ref. Nothing here calls setState:
    // the HUD reads this object from its own animation frame and writes the DOM directly,
    // so a 60 Hz range does not re-render the React tree 60 times a second.
    const readout = telemetry.current
    // Stable references, assigned rather than copied: the HUD projects the ladder through
    // this camera and off this position, so it must see the same objects the scene renders.
    readout.camera = camera
    readout.position = current.position
    readout.forward = current.forward
    readout.heading = MathUtils.euclideanModulo(
      MathUtils.radToDeg(Math.atan2(-current.forward.z, current.forward.x)),
      360,
    )
    readout.pitch = MathUtils.radToDeg(Math.asin(MathUtils.clamp(current.forward.y, -1, 1)))
    readout.roll = MathUtils.radToDeg(Math.atan2(
      current.attitudeCross.dot(current.forward),
      current.levelUp.dot(current.up),
    ))
    readout.altitude = Math.max(0, current.position.y)
    readout.groundClearance = Math.max(0, groundClearance)
    readout.ceiling = Math.max(0, flightBounds.altitude - current.position.y)
    readout.edge = Math.max(0, Math.min(
      flightBounds.x - Math.abs(current.position.x),
      flightBounds.z - Math.abs(current.position.z),
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
    readout.mach = readMach(current.speedKmh, current.position.y, envelope)
    readout.speed = current.speedKmh
    readout.verticalSpeed = current.forward.y * worldSpeed
    readout.throttle = controls.current.throttle
    readout.flaps = input.flaps
    readout.positionX = MathUtils.clamp(current.position.x / flightBounds.x, -1, 1)
    readout.positionZ = MathUtils.clamp(current.position.z / flightBounds.z, -1, 1)
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
    altitude: rangeMetrics.terrainHeight + 460,
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
}) {
  const aircraft = getAircraft(aircraftId)
  const graphics = useGraphicsProfile('medium')

  return (
    <Canvas
      frameloop="demand"
      dpr={graphics.dpr}
      shadows={graphics.shadows}
      camera={{ position: [-286, 480, 0], fov: 48, near: 0.3, far: 3600 }}
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
      <SyncedFrameLoop targetFps={graphics.targetFps} />
    </Canvas>
  )
}
