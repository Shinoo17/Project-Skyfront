import {
  Grid,
  OrbitControls,
  PerspectiveCamera,
  useAnimations,
  useGLTF,
} from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  ACESFilmicToneMapping,
  Box3,
  Euler,
  LoopOnce,
  MathUtils,
  Mesh,
  PMREMGenerator,
  Quaternion,
  Vector3,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'

import { getAircraft } from '../../aircraft'
import { resolveLoadout } from '../../weapons'
import WeaponDisplay from './WeaponDisplay'
import ExhaustPlumes from '../flight/ExhaustPlumes'
import { applySurfaceTargets } from '../flight/surfaces'
import { useGraphicsProfile } from '../../three/graphics'
import { makeHinges } from '../../three/hinge'
import { getKTX2Loader, withKTX2 } from '../../three/ktx2'
import { prepareModelAnimations } from '../../three/pose'

function formatClipLabel(name) {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/\bL\b/g, 'Left')
    .replace(/\bR\b/g, 'Right')
    .replace(/\bOpen\b/gi, '')
    .replace(/\bDeploy\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function AircraftModel({
  aircraft,
  animationStates,
  isPlaying,
  playbackSpeed,
  onClipsReady,
  onModelBoundsReady,
  manualFlight,
  aircraftMotionEnabled,
  flightInput,
  flightResetId,
  throttle,
  afterburner,
  hidden,
}) {
  const group = useRef()
  const attitude = useRef(new Quaternion())
  const attitudeStep = useRef(new Quaternion())
  const attitudeEuler = useRef(new Euler(0, 0, 0, 'XYZ'))
  const previousFlightResetId = useRef(flightResetId)
  const renderer = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const ktx2Loader = useMemo(() => getKTX2Loader(renderer), [renderer])
  const { scene, animations } = useGLTF(aircraft.url, false, true, withKTX2(ktx2Loader))
  const baseAircraftQuaternion = useMemo(
    () => new Quaternion().setFromEuler(
      new Euler(...aircraft.viewer.restAttitude, 'XYZ'),
    ),
    [aircraft],
  )

  const { model, playbackAnimations } = useMemo(() => {
    const clone = cloneSkeleton(scene)

    aircraft.removedObjects.forEach((name) => {
      clone.getObjectByName(name)?.removeFromParent()
    })

    const preparedAnimations = prepareModelAnimations(clone, animations)
    const box = new Box3().setFromObject(clone)
    const center = box.getCenter(new Vector3())
    const size = box.getSize(new Vector3())
    const maxAxis = Math.max(size.x, size.y, size.z)
    const modelScale = aircraft.viewer.scale / maxAxis
    const materialCache = new Map()

    const cloneMaterial = (material) => {
      if (!materialCache.has(material.uuid)) {
        materialCache.set(material.uuid, material.clone())
      }
      return materialCache.get(material.uuid)
    }

    clone.scale.setScalar(modelScale)
    clone.position.copy(center).multiplyScalar(-modelScale)
    clone.userData.viewerRadius = size.multiplyScalar(modelScale).length() / 2

    clone.traverse((child) => {
      if (!(child instanceof Mesh) || !child.material) return
      child.material = Array.isArray(child.material)
        ? child.material.map(cloneMaterial)
        : cloneMaterial(child.material)

      child.castShadow = true
      child.receiveShadow = true
    })

    return { model: clone, playbackAnimations: preparedAnimations }
  }, [aircraft, animations, scene])

  const { actions, mixer } = useAnimations(playbackAnimations, group)

  const controlSurfaces = useMemo(
    () => makeHinges(model, aircraft.controlSurfaces),
    [aircraft, model],
  )

  useEffect(() => {
    const clipMetadata = aircraft.clipMetadata
    onClipsReady(
      playbackAnimations.map((clip) => ({
        id: clip.name,
        name: clip.name,
        label: clipMetadata[clip.name]?.label || formatClipLabel(clip.name),
        activeLabel: clipMetadata[clip.name]?.activeLabel || 'ACTIVE',
        inactiveLabel: clipMetadata[clip.name]?.inactiveLabel || 'REST',
        duration: clip.duration,
        tracks: clip.tracks.length,
      })),
    )
  }, [aircraft, onClipsReady, playbackAnimations])

  useEffect(() => {
    onModelBoundsReady(model.userData.viewerRadius)
  }, [model, onModelBoundsReady])

  useEffect(() => {
    Object.values(actions).forEach((action) => {
      action.reset()
      action.enabled = true
      action.clampWhenFinished = true
      action.setLoop(LoopOnce, 1)
      action.paused = true
      action.play()
    })
    mixer.update(0)
    invalidate()
  }, [actions, invalidate, mixer])

  useEffect(() => {
    Object.entries(actions).forEach(([systemId, action]) => {
      const isActive = Boolean(animationStates[systemId])
      const targetTime = isActive ? action.getClip().duration : 0
      const atTarget = Math.abs(action.time - targetTime) < 0.001
      action.enabled = !manualFlight
      action.timeScale = isActive ? playbackSpeed : -playbackSpeed
      action.paused = manualFlight || !isPlaying || atTarget
      action.play()
    })
    mixer.update(0)
    invalidate()
  }, [actions, animationStates, invalidate, isPlaying, manualFlight, mixer, playbackSpeed])

  useFrame((state, delta) => {
    // The airframe stays mounted behind the weapons display so its clips, its pose, and its
    // four megabytes of geometry survive the trip. Off screen it does no work.
    if (hidden) return

    if (group.current) {
      if (manualFlight) {
        if (previousFlightResetId.current !== flightResetId) {
          previousFlightResetId.current = flightResetId
          attitude.current.identity()
        }

        const step = Math.min(delta, 0.05)
        if (aircraftMotionEnabled) {
          const rates = aircraft.viewer.rates
          attitudeEuler.current.set(
            flightInput.roll * MathUtils.degToRad(rates.roll) * step,
            -flightInput.yaw * MathUtils.degToRad(rates.yaw) * step,
            flightInput.pitch * MathUtils.degToRad(rates.pitch) * step,
            'XYZ',
          )
          attitudeStep.current.setFromEuler(attitudeEuler.current)
          attitude.current.multiply(attitudeStep.current).normalize()
          group.current.quaternion
            .copy(baseAircraftQuaternion)
            .multiply(attitude.current)
        } else {
          attitude.current.identity()
          group.current.quaternion.copy(baseAircraftQuaternion)
        }

        // Close enough to see the nozzles, so the viewer drives thrust vectoring too.
        applySurfaceTargets(
          controlSurfaces,
          aircraft.mixControlSurfaces(flightInput, {
            thrustVectoring: aircraft.thrustVectoring,
          }),
          1 - Math.exp(-10 * step),
        )
      } else {
        attitude.current.identity()
        group.current.quaternion.copy(baseAircraftQuaternion)
      }
    }

    if (manualFlight) return

    let hasMovingAction = false
    Object.entries(actions).forEach(([systemId, action]) => {
      const duration = action.getClip().duration
      const targetTime = animationStates[systemId] ? duration : 0
      const reachedTarget = animationStates[systemId]
        ? action.time >= duration - 0.001
        : action.time <= 0.001

      if (reachedTarget) {
        action.time = targetTime
        action.paused = true
      } else if (isPlaying) {
        hasMovingAction = true
      }
    })

    if (hasMovingAction) invalidate()
  })

  return (
    <group
      ref={group}
      quaternion={baseAircraftQuaternion}
      position={[0, 0.25, 0]}
      visible={!hidden}
    >
      <primitive object={model} />
      <ExhaustPlumes
        aircraft={aircraft}
        model={model}
        throttle={throttle}
        afterburner={afterburner}
        active={manualFlight}
      />
    </group>
  )
}

function ContinuousRender({ active }) {
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    invalidate()
  }, [active, invalidate])

  useFrame(() => {
    if (active) invalidate()
  })

  return null
}

function FrameCounter({ meter }) {
  useFrame(() => {
    meter.current.frames += 1
  })

  return null
}

function FpsReadout({ meter }) {
  const output = useRef()

  useEffect(() => {
    let previousSample = performance.now()

    const sample = () => {
      const now = performance.now()
      const elapsed = now - previousSample
      const fps = elapsed > 0
        ? Math.round((meter.current.frames * 1000) / elapsed)
        : 0

      if (output.current) output.current.value = String(fps)
      meter.current.frames = 0
      previousSample = now
    }

    const interval = window.setInterval(sample, 500)
    return () => window.clearInterval(interval)
  }, [meter])

  return (
    <div className="fps-readout" aria-label="WebGL rendering performance">
      <span>FPS</span>
      <output ref={output}>0</output>
    </div>
  )
}

function StudioEnvironment({ isStealth }) {
  const { gl, scene } = useThree()

  useEffect(() => {
    const room = new RoomEnvironment()
    const pmrem = new PMREMGenerator(gl)
    const environment = pmrem.fromScene(room, 0.04).texture
    const previousEnvironment = scene.environment
    const previousIntensity = scene.environmentIntensity

    scene.environment = environment
    scene.environmentIntensity = isStealth ? 0.5 : 1.15

    room.dispose()
    pmrem.dispose()

    return () => {
      scene.environment = previousEnvironment
      scene.environmentIntensity = previousIntensity
      environment.dispose()
    }
  }, [gl, isStealth, scene])

  return null
}

function CameraRig({
  autoRotate,
  viewRequest,
  controlsRef,
  lightingMode,
  modelRadius,
}) {
  const { camera, gl, size } = useThree()
  const verticalFov = MathUtils.degToRad(camera.fov)
  const horizontalFov =
    2 * Math.atan(Math.tan(verticalFov / 2) * (size.width / size.height))
  const fitDistance =
    (modelRadius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * 1.12

  useEffect(() => {
    gl.toneMappingExposure = lightingMode === 'stealth' ? 0.9 : 1.28
  }, [gl, lightingMode])

  useEffect(() => {
    if (!viewRequest || !controlsRef.current) return

    const directions = {
      perspective: new Vector3(0.62, 0.31, 0.72),
      front: new Vector3(0, 0.08, 1),
      side: new Vector3(1, 0.08, 0),
      top: new Vector3(0.001, 1, 0.001),
    }
    const direction =
      directions[viewRequest.view] || directions.perspective
    camera.position.copy(direction.normalize().multiplyScalar(fitDistance))
    controlsRef.current.target.set(0, 0, 0)
    controlsRef.current.update()
  }, [camera, controlsRef, fitDistance, size.width, size.height, viewRequest])

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      autoRotate={autoRotate}
      autoRotateSpeed={0.55}
      enableDamping
      dampingFactor={0.055}
      minDistance={Math.max(modelRadius * 1.15, fitDistance * 0.3)}
      maxDistance={fitDistance * 1.5}
      minPolarAngle={0.05}
      maxPolarAngle={Math.PI * 0.93}
    />
  )
}

export default function Scene({
  animationStates,
  isPlaying,
  playbackSpeed,
  autoRotate,
  viewRequest,
  lightingMode,
  manualFlight,
  aircraftMotionEnabled,
  flightInput,
  flightResetId,
  throttle,
  afterburner,
  onClipsReady,
  aircraftId,
  weaponView,
}) {
  const controls = useRef()
  const fpsMeter = useRef({ frames: 0 })
  const [aircraftRadius, setAircraftRadius] = useState(5.3)
  const [weaponRadius, setWeaponRadius] = useState(4)
  const isStealth = lightingMode === 'stealth'
  const aircraft = getAircraft(aircraftId)
  const loadout = useMemo(() => resolveLoadout(aircraft.weapons), [aircraft])
  const graphics = useGraphicsProfile('studio')

  // Each subject reports its own bounds and keeps them, so leaving the weapons display reframes the
  // airframe without it having to measure itself a second time.
  const modelRadius = weaponView ? weaponRadius : aircraftRadius

  return (
    <>
      <Canvas
        frameloop="demand"
        dpr={graphics.dpr}
        shadows={graphics.shadows}
        gl={{
          antialias: graphics.antialias,
          alpha: false,
          powerPreference: graphics.powerPreference,
        }}
        onCreated={({ gl }) => {
          gl.toneMapping = ACESFilmicToneMapping
          gl.toneMappingExposure = isStealth ? 0.9 : 1.28
          gl.setClearColor('#050709')
        }}
      >
        <PerspectiveCamera makeDefault position={[9.4, 4.7, 10.8]} fov={34} />
        <fog attach="fog" args={['#050709', 30, 90]} />
        {graphics.environment && <StudioEnvironment isStealth={isStealth} />}

        <hemisphereLight
          args={['#d9f1f7', '#11161a', isStealth ? 0.55 : 1.35]}
        />
        <ambientLight intensity={isStealth ? 0.38 : 0.8} color="#b8d7df" />
        <directionalLight
          castShadow={graphics.shadows}
          position={[7, 9, 4]}
          intensity={isStealth ? 3.2 : 5.8}
          color="#bdeaff"
          shadow-mapSize={graphics.shadowMapSize ?? [512, 512]}
          shadow-camera-near={0.5}
          shadow-camera-far={32}
          shadow-camera-left={-12}
          shadow-camera-right={12}
          shadow-camera-top={12}
          shadow-camera-bottom={-12}
          shadow-bias={-0.0004}
          shadow-normalBias={0.035}
          shadow-radius={4}
        />
        <directionalLight
          position={[-6, 2, 8]}
          intensity={isStealth ? 1.1 : 3.4}
          color="#789caf"
        />
        <spotLight
          position={[-8, 3, -6]}
          angle={0.6}
          penumbra={0.72}
          intensity={isStealth ? 4.5 : 7.5}
          color="#ffb15c"
        />
        <pointLight
          position={[0, -2, 5]}
          intensity={isStealth ? 2.4 : 5.2}
          color="#4b7d95"
        />

        <Suspense fallback={null}>
          <AircraftModel
            aircraft={aircraft}
            animationStates={animationStates}
            isPlaying={isPlaying}
            playbackSpeed={playbackSpeed}
            manualFlight={manualFlight}
            aircraftMotionEnabled={aircraftMotionEnabled}
            flightInput={flightInput}
            flightResetId={flightResetId}
            throttle={throttle}
            afterburner={afterburner}
            onClipsReady={onClipsReady}
            onModelBoundsReady={setAircraftRadius}
            hidden={Boolean(weaponView)}
          />
        </Suspense>

        {weaponView && (
          <Suspense fallback={null}>
            <WeaponDisplay
              loadout={loadout}
              selectedId={weaponView === 'all' ? null : weaponView}
              onBoundsReady={setWeaponRadius}
            />
          </Suspense>
        )}

        <Grid
          position={[0, -2.07, 0]}
          args={[36, 36]}
          cellSize={0.65}
          cellThickness={0.7}
          cellColor="#40484d"
          sectionSize={3.25}
          sectionThickness={1.15}
          sectionColor="#6f7a80"
          fadeDistance={64}
          fadeStrength={1.2}
          infiniteGrid
        />
        <mesh
          position={[0, -2.045, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
          renderOrder={2}
        >
          <planeGeometry args={[80, 80]} />
          <shadowMaterial
            transparent
            opacity={isStealth ? 0.28 : 0.42}
            depthWrite={false}
          />
        </mesh>
        <CameraRig
          autoRotate={autoRotate}
          viewRequest={viewRequest}
          controlsRef={controls}
          lightingMode={lightingMode}
          modelRadius={modelRadius}
        />
        <ContinuousRender active={autoRotate || manualFlight} />
        <FrameCounter meter={fpsMeter} />
      </Canvas>
      <FpsReadout meter={fpsMeter} />
    </>
  )
}
