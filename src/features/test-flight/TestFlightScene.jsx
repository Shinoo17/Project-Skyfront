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
  Vector3,
} from 'three'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { Suspense, useEffect, useMemo, useRef } from 'react'

import { getAircraft } from '../../aircraft'
import { useGraphicsProfile } from '../../three/graphics'
import { makeHinges } from '../../three/hinge'
import { getKTX2Loader, withKTX2 } from '../../three/ktx2'
import { applyClosedRestPose } from '../../three/pose'
import { applySurfaceTargets } from '../flight/surfaces'
import { readAxes, readThrottleDirection } from '../flight/useFlightControls'

const TERRAIN_URL = '/Mountain_Valley_Colorado.glb'
const RANGE_SPAN = 4800
const RANGE_EDGE_MARGIN = 70
const FORWARD = new Vector3(1, 0, 0)
const LOCAL_UP = new Vector3(0, 1, 0)

// Demand rendering with a fixed tick: the range never idles, so this is what caps the
// frame rate instead of letting it run as fast as the GPU will go.
function CappedFrameLoop({ targetFps }) {
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    invalidate()
    if (!targetFps) return undefined

    const interval = window.setInterval(() => {
      if (!document.hidden) invalidate()
    }, 1000 / targetFps)
    return () => window.clearInterval(interval)
  }, [invalidate, targetFps])

  return null
}

function Terrain({ scene }) {
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
    <group scale={data.scale} position={data.position}>
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
  onTelemetry,
}) {
  const envelope = aircraft.flight.envelope
  const group = useRef()
  const previousResetId = useRef(resetId)
  const telemetryCallback = useRef(onTelemetry)
  telemetryCallback.current = onTelemetry
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
    orientation: new Quaternion(),
    rotationStep: new Quaternion(),
    rotationEuler: new Euler(0, 0, 0, 'XYZ'),
    forward: new Vector3(),
    up: new Vector3(),
    cameraPosition: new Vector3(),
    cameraTarget: new Vector3(),
    lastTelemetry: 0,
  })

  const resetFlight = (keepThrottle = true) => {
    const state = flight.current
    state.position.set(-260, spawnAltitude, 0)
    state.orientation.identity()
    if (!keepThrottle) controls.current.throttle = envelope.idleThrottle
    if (group.current) {
      group.current.position.copy(state.position)
      group.current.quaternion.identity()
    }
    camera.position.set(-286, spawnAltitude + 8, 0)
    camera.up.copy(LOCAL_UP)
    camera.lookAt(-240, spawnAltitude, 0)
  }

  useEffect(() => {
    resetFlight(false)
    // The reset function intentionally reads stable refs and Three objects only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spawnAltitude])

  useFrame((state, delta) => {
    if (!group.current) return
    if (previousResetId.current !== resetId) {
      previousResetId.current = resetId
      resetFlight()
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

    const current = flight.current
    current.rotationEuler.set(
      roll * MathUtils.degToRad(envelope.rollRate) * step,
      -yaw * MathUtils.degToRad(envelope.yawRate) * step,
      pitch * MathUtils.degToRad(envelope.pitchRate) * step,
      'XYZ',
    )
    current.rotationStep.setFromEuler(current.rotationEuler)
    current.orientation.multiply(current.rotationStep).normalize()

    const speed = envelope.minSpeed + (controls.current.throttle * envelope.speedRange)
    current.forward.copy(FORWARD).applyQuaternion(current.orientation).normalize()
    current.position.addScaledVector(current.forward, speed * step)

    const outOfRange =
      Math.abs(current.position.x) > flightBounds.x ||
      Math.abs(current.position.z) > flightBounds.z ||
      current.position.y < 8 ||
      current.position.y > flightBounds.altitude
    if (outOfRange) resetFlight()

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
      .set(-25, 8, 0)
      .applyQuaternion(current.orientation)
      .add(current.position)
    current.cameraTarget
      .copy(current.position)
      .addScaledVector(current.forward, 18)
    current.up.copy(LOCAL_UP).applyQuaternion(current.orientation).normalize()
    const cameraBlend = 1 - Math.exp(-4.5 * step)
    camera.position.lerp(current.cameraPosition, cameraBlend)
    camera.up.lerp(current.up, cameraBlend * 0.65).normalize()
    camera.lookAt(current.cameraTarget)

    const now = state.clock.elapsedTime
    if (now - current.lastTelemetry > 0.2) {
      current.lastTelemetry = now
      const heading = MathUtils.euclideanModulo(
        MathUtils.radToDeg(Math.atan2(-current.forward.z, current.forward.x)),
        360,
      )
      telemetryCallback.current({
        altitude: Math.max(0, current.position.y),
        heading,
        speed,
        throttle: controls.current.throttle,
      })
    }
  })

  return (
    <group ref={group} position={[-260, spawnAltitude, 0]}>
      <primitive object={model} />
    </group>
  )
}

function FlightWorld({ aircraft, controls, resetId, onTelemetry }) {
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
      <Terrain scene={terrainGltf.scene} />
      <FlightAircraft
        aircraft={aircraft}
        scene={aircraftGltf.scene}
        animations={aircraftGltf.animations}
        controls={controls}
        resetId={resetId}
        spawnAltitude={spawnAltitude}
        flightBounds={flightBounds}
        onTelemetry={onTelemetry}
      />
    </>
  )
}

export default function TestFlightScene({
  controls,
  resetId,
  onTelemetry,
  aircraftId,
}) {
  const aircraft = getAircraft(aircraftId)
  const graphics = useGraphicsProfile('eco')

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
          onTelemetry={onTelemetry}
        />
      </Suspense>
      <CappedFrameLoop targetFps={graphics.targetFps} />
    </Canvas>
  )
}
