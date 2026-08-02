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
  AnimationClip,
  Box3,
  Euler,
  LoopOnce,
  MathUtils,
  Mesh,
  PMREMGenerator,
  PropertyBinding,
  Quaternion,
  Vector3,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'

const MODEL_URL = '/F22_model.glb'
const KTX2_TRANSCODER_PATH = '/basis/'
const CLIP_METADATA = {
  WeaponBay_Main_L_Open: {
    label: 'Main weapon bay · left',
    activeLabel: 'OPEN',
    inactiveLabel: 'CLOSED',
  },
  WeaponBay_Main_R_Open: {
    label: 'Main weapon bay · right',
    activeLabel: 'OPEN',
    inactiveLabel: 'CLOSED',
  },
  WeaponBay_Side_L_Open: {
    label: 'Side weapon bay · left',
    activeLabel: 'OPEN',
    inactiveLabel: 'CLOSED',
  },
  WeaponBay_Side_R_Open: {
    label: 'Side weapon bay · right',
    activeLabel: 'OPEN',
    inactiveLabel: 'CLOSED',
  },
  Canopy_Open: {
    label: 'Canopy',
    activeLabel: 'OPEN',
    inactiveLabel: 'CLOSED',
  },
  LandingGear_Deploy: {
    label: 'Landing gear',
    activeLabel: 'DOWN',
    inactiveLabel: 'UP',
  },
  Aero_Demo: {
    label: 'Aerodynamic demo',
    activeLabel: 'ACTIVE',
    inactiveLabel: 'REST',
  },
  Tailhook_Deploy: {
    label: 'Tail hook',
    activeLabel: 'DOWN',
    inactiveLabel: 'UP',
  },
}

// Every control-surface bone hinges about its own local Y axis, and every nozzle bone
// about its own local X. Those axes already carry the real geometry — 15 degrees of
// trailing-edge sweep on the flaperons and ailerons, 42 degrees of leading-edge sweep
// on the LE flaps, and the 28 degree outward cant of the vertical tails. Rotating them
// about a straight world axis instead shears the part out of the airframe.
const SPAR_AXIS = new Vector3(0, 1, 0)
const NOZZLE_AXIS = new Vector3(1, 0, 0)

// The bone axes mirror between sides, so each hinge is flipped to point in a shared
// direction. A positive angle then means the same thing everywhere — trailing edge down,
// leading edge up on the LE flaps, trailing edge to starboard on the vertical tails, and
// trailing edge up on the nozzles.
const STARBOARD_REFERENCE = new Vector3(0, 0, 1)
const UP_REFERENCE = new Vector3(0, 1, 0)
const PORT_REFERENCE = new Vector3(0, 0, -1)

// [mesh name, hinge axis in bone space, reference direction, deflection limit in degrees].
// The limits are the values keyed in the model's own showcase animation.
const CONTROL_SURFACE_MESHES = {
  stabilatorLeft: ['Tail_Stabilator_L', SPAR_AXIS, STARBOARD_REFERENCE, 20],
  stabilatorRight: ['Tail_Stabilator_R', SPAR_AXIS, STARBOARD_REFERENCE, 20],
  flaperonLeft: ['Wing_Flaperon_L', SPAR_AXIS, STARBOARD_REFERENCE, 22.6],
  flaperonRight: ['Wing_Flaperon_R', SPAR_AXIS, STARBOARD_REFERENCE, 22.6],
  aileronLeft: ['Wing_Aileron_L', SPAR_AXIS, STARBOARD_REFERENCE, 25],
  aileronRight: ['Wing_Aileron_R', SPAR_AXIS, STARBOARD_REFERENCE, 25],
  leadingEdgeFlapLeft: ['Wing_LEFlap_L', SPAR_AXIS, STARBOARD_REFERENCE, 11.4],
  leadingEdgeFlapRight: ['Wing_LEFlap_R', SPAR_AXIS, STARBOARD_REFERENCE, 11.4],
  rudderLeft: ['Tail_VerticalFin_L', SPAR_AXIS, UP_REFERENCE, 22.6],
  rudderRight: ['Tail_VerticalFin_R', SPAR_AXIS, UP_REFERENCE, 22.6],

  nozzleLeftFlapUpper: ['Engine_Nozzle_L_Flap_Upper', NOZZLE_AXIS, PORT_REFERENCE, 20],
  nozzleLeftFlapLower: ['Engine_Nozzle_L_Flap_Lower', NOZZLE_AXIS, PORT_REFERENCE, 20],
  nozzleLeftVaneUpper: ['Engine_Nozzle_L_Vane_Upper', NOZZLE_AXIS, PORT_REFERENCE, 10],
  nozzleLeftVaneLower: ['Engine_Nozzle_L_Vane_Lower', NOZZLE_AXIS, PORT_REFERENCE, 10],
  nozzleRightFlapUpper: ['Engine_Nozzle_R_Flap_Upper', NOZZLE_AXIS, PORT_REFERENCE, 20],
  nozzleRightFlapLower: ['Engine_Nozzle_R_Flap_Lower', NOZZLE_AXIS, PORT_REFERENCE, 20],
  nozzleRightVaneUpper: ['Engine_Nozzle_R_Vane_Upper', NOZZLE_AXIS, PORT_REFERENCE, 10],
  nozzleRightVaneLower: ['Engine_Nozzle_R_Vane_Lower', NOZZLE_AXIS, PORT_REFERENCE, 10],
}

// Vectoring geometry read straight off the showcase (frames 381-700): the flap on the
// side the exhaust turns toward swings 20 degrees, its opposite number follows at 8, and
// the vane on that side closes 10 degrees the other way. Perfectly mirrored for the
// opposite direction, so one function covers both.
function nozzleAngles(vector, side) {
  const up = Math.max(vector, 0)
  const down = Math.max(-vector, 0)
  return {
    [`nozzle${side}FlapUpper`]: (up * 20) - (down * 8),
    [`nozzle${side}FlapLower`]: (up * 8) - (down * 20),
    [`nozzle${side}VaneUpper`]: up * -10,
    [`nozzle${side}VaneLower`]: down * 10,
  }
}
const ktx2Loaders = new WeakMap()

function getKTX2Loader(renderer) {
  if (!ktx2Loaders.has(renderer)) {
    ktx2Loaders.set(
      renderer,
      new KTX2Loader()
        .setTranscoderPath(KTX2_TRANSCODER_PATH)
        .detectSupport(renderer),
    )
  }

  return ktx2Loaders.get(renderer)
}

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

// Orientation of a bone relative to the aircraft body, independent of where the model
// currently sits in the scene graph.
function bodyQuaternion(bone, root) {
  const quaternion = new Quaternion()
  for (let node = bone; node; node = node.parent) {
    quaternion.premultiply(node.quaternion)
    if (node === root) break
  }
  return quaternion
}

function makeHinge(model, meshName, hingeAxis, reference, limit) {
  const mesh = model.getObjectByName(meshName)
  const bone = mesh?.parent
  if (!bone) return null

  const localAxis = hingeAxis.clone()
  const bodyAxis = localAxis.clone().applyQuaternion(bodyQuaternion(bone, model))
  if (bodyAxis.dot(reference) < 0) localAxis.negate()

  return {
    bone,
    localAxis,
    limit,
    rest: bone.quaternion.clone(),
    rotation: new Quaternion(),
    target: new Quaternion(),
  }
}

function trackHasMotion(track) {
  const valueSize = track.getValueSize()
  if (track.times.length < 2 || !valueSize) return false

  const first = track.values.slice(0, valueSize)
  const isQuaternion = track.name.endsWith('.quaternion')

  for (let offset = valueSize; offset < track.values.length; offset += valueSize) {
    if (isQuaternion) {
      let dot = 0
      let firstLengthSq = 0
      let sampleLengthSq = 0

      for (let component = 0; component < valueSize; component += 1) {
        const firstValue = first[component]
        const sampleValue = track.values[offset + component]
        dot += firstValue * sampleValue
        firstLengthSq += firstValue * firstValue
        sampleLengthSq += sampleValue * sampleValue
      }

      const length = Math.sqrt(firstLengthSq * sampleLengthSq)
      const cosine = length
        ? MathUtils.clamp(Math.abs(dot / length), -1, 1)
        : 1
      if (2 * Math.acos(cosine) > 0.0001) return true
      continue
    }

    for (let component = 0; component < valueSize; component += 1) {
      if (Math.abs(track.values[offset + component] - first[component]) > 0.00001) {
        return true
      }
    }
  }

  return false
}

function prepareModelAnimations(model, animations) {
  const appliedTracks = new Set()

  // The exported bind pose has several doors deployed. Apply frame zero once so
  // the viewer's true rest pose is the closed/stowed state before actions bind.
  animations.forEach((clip) => {
    clip.tracks.forEach((track) => {
      if (appliedTracks.has(track.name)) return

      const binding = PropertyBinding.create(model, track.name)
      const value = track.createInterpolant().evaluate(0)
      binding.setValue(value, 0)
      binding.unbind()
      appliedTracks.add(track.name)
    })
  })
  model.updateMatrixWorld(true)

  // Blender sampled every bone into several independent clips. Keeping those
  // static tracks makes AnimationMixer average unrelated actions, which reduces
  // the travel of doors and landing gear. Retain only properties that move.
  return animations.map((clip) => new AnimationClip(
    clip.name,
    clip.duration,
    clip.tracks.filter(trackHasMotion).map((track) => track.clone()),
    clip.blendMode,
  ))
}

function F22Model({
  animationStates,
  isPlaying,
  playbackSpeed,
  seekRequest,
  onClipsReady,
  onModelBoundsReady,
  onTimeUpdate,
  manualFlight,
  aircraftMotionEnabled,
  flightInput,
  flightResetId,
}) {
  const group = useRef()
  const reportFrame = useRef(0)
  const attitude = useRef(new Quaternion())
  const attitudeStep = useRef(new Quaternion())
  const attitudeEuler = useRef(new Euler(0, 0, 0, 'XYZ'))
  const previousFlightResetId = useRef(flightResetId)
  const renderer = useThree((state) => state.gl)
  const ktx2Loader = useMemo(() => getKTX2Loader(renderer), [renderer])
  const { scene, animations } = useGLTF(
    MODEL_URL,
    false,
    true,
    (loader) => loader.setKTX2Loader(ktx2Loader),
  )
  const baseAircraftQuaternion = useMemo(
    () => new Quaternion().setFromEuler(new Euler(0.04, -0.34, 0, 'XYZ')),
    [],
  )

  const { model, playbackAnimations } = useMemo(() => {
    const clone = cloneSkeleton(scene)
    const preparedAnimations = prepareModelAnimations(clone, animations)
    const box = new Box3().setFromObject(clone)
    const center = box.getCenter(new Vector3())
    const size = box.getSize(new Vector3())
    const maxAxis = Math.max(size.x, size.y, size.z)
    const modelScale = 9.8 / maxAxis
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
  }, [animations, scene])

  const { actions, mixer } = useAnimations(playbackAnimations, group)
  const systemDuration = useMemo(
    () => Math.max(0, ...playbackAnimations.map((clip) => clip.duration)),
    [playbackAnimations],
  )

  const controlSurfaces = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(CONTROL_SURFACE_MESHES).map(
          ([controlName, [meshName, hingeAxis, reference, limit]]) => [
            controlName,
            makeHinge(model, meshName, hingeAxis, reference, limit),
          ],
        ),
      ),
    [model],
  )

  useEffect(() => {
    onClipsReady(
      playbackAnimations.map((clip) => ({
        id: clip.name,
        name: clip.name,
        label: CLIP_METADATA[clip.name]?.label || formatClipLabel(clip.name),
        activeLabel: CLIP_METADATA[clip.name]?.activeLabel || 'ACTIVE',
        inactiveLabel: CLIP_METADATA[clip.name]?.inactiveLabel || 'REST',
        duration: clip.duration,
        tracks: clip.tracks.length,
      })),
    )
  }, [onClipsReady, playbackAnimations])

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
  }, [actions, mixer])

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
  }, [actions, animationStates, isPlaying, manualFlight, mixer, playbackSpeed])

  useEffect(() => {
    if (!seekRequest || manualFlight || !systemDuration) return
    const progress = MathUtils.clamp(seekRequest.time / systemDuration, 0, 1)
    Object.entries(actions).forEach(([systemId, action]) => {
      if (!animationStates[systemId]) return
      action.time = action.getClip().duration * progress
      action.paused = !isPlaying || progress === 1
    })
    mixer.update(0)
    onTimeUpdate(seekRequest.time)
  }, [actions, animationStates, isPlaying, manualFlight, mixer, onTimeUpdate, seekRequest, systemDuration])

  useFrame((state, delta) => {
    if (group.current) {
      if (manualFlight) {
        if (previousFlightResetId.current !== flightResetId) {
          previousFlightResetId.current = flightResetId
          attitude.current.identity()
        }

        const step = Math.min(delta, 0.05)
        if (aircraftMotionEnabled) {
          attitudeEuler.current.set(
            flightInput.roll * MathUtils.degToRad(54) * step,
            -flightInput.yaw * MathUtils.degToRad(30) * step,
            flightInput.pitch * MathUtils.degToRad(38) * step,
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

        const flapSetting = MathUtils.clamp(flightInput.flaps ?? 0, 0, 1)

        // Aerodynamic sign convention, positive as defined on the hinges above.
        // Nose up needs the tail pushed down, so the stabilators and the flaperons
        // (which act as elevons) go trailing edge up. Rolling right needs more lift on
        // the left wing, so the left surfaces go trailing edge down. Both vertical tails
        // deflect together for yaw, and the LE flaps droop with the flaps.
        const targetAngles = {
          stabilatorLeft: (flightInput.pitch * -20) + (flightInput.roll * 8),
          stabilatorRight: (flightInput.pitch * -20) - (flightInput.roll * 8),
          aileronLeft: flightInput.roll * 25,
          aileronRight: -flightInput.roll * 25,
          flaperonLeft:
            (flightInput.pitch * -10) +
            (flightInput.roll * 15) +
            (flapSetting * 22),
          flaperonRight:
            (flightInput.pitch * -10) -
            (flightInput.roll * 15) +
            (flapSetting * 22),
          leadingEdgeFlapLeft: flapSetting * -11,
          leadingEdgeFlapRight: flapSetting * -11,
          rudderLeft: flightInput.yaw * 22,
          rudderRight: flightInput.yaw * 22,

          // Thrust vectoring. Turning the exhaust up pushes the tail down for nose up,
          // so pitch drives both engines together. Roll is differential: for a right
          // roll the left engine turns its exhaust down and lifts that wing.
          ...nozzleAngles(
            MathUtils.clamp(flightInput.pitch - (flightInput.roll * 0.5), -1, 1),
            'Left',
          ),
          ...nozzleAngles(
            MathUtils.clamp(flightInput.pitch + (flightInput.roll * 0.5), -1, 1),
            'Right',
          ),
        }
        const surfaceBlend = 1 - Math.exp(-10 * step)

        Object.entries(targetAngles).forEach(([name, degrees]) => {
          const surface = controlSurfaces[name]
          if (!surface) return
          surface.target
            .copy(surface.rest)
            .multiply(
              surface.rotation.setFromAxisAngle(
                surface.localAxis,
                MathUtils.degToRad(
                  MathUtils.clamp(degrees, -surface.limit, surface.limit),
                ),
              ),
            )
          surface.bone.quaternion.slerp(surface.target, surfaceBlend)
        })
      } else {
        attitude.current.identity()
        group.current.quaternion.copy(baseAircraftQuaternion)
      }
    }

    if (manualFlight) return

    let furthestProgress = 0
    Object.entries(actions).forEach(([systemId, action]) => {
      const duration = action.getClip().duration
      const targetTime = animationStates[systemId] ? duration : 0
      const reachedTarget = animationStates[systemId]
        ? action.time >= duration - 0.001
        : action.time <= 0.001

      if (reachedTarget) {
        action.time = targetTime
        action.paused = true
      }
      if (animationStates[systemId] && duration) {
        furthestProgress = Math.max(furthestProgress, action.time / duration)
      }
    })

    if (state.clock.elapsedTime - reportFrame.current > 0.08) {
      reportFrame.current = state.clock.elapsedTime
      onTimeUpdate(furthestProgress * systemDuration)
    }
  })

  return (
    <group
      ref={group}
      quaternion={baseAircraftQuaternion}
      position={[0, 0.25, 0]}
    >
      <primitive object={model} />
    </group>
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
  seekRequest,
  autoRotate,
  viewRequest,
  lightingMode,
  manualFlight,
  aircraftMotionEnabled,
  flightInput,
  flightResetId,
  onClipsReady,
  onTimeUpdate,
}) {
  const controls = useRef()
  const [modelRadius, setModelRadius] = useState(5.3)
  const isStealth = lightingMode === 'stealth'

  return (
    <Canvas
      dpr={[1, 1.8]}
      shadows
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping
        gl.toneMappingExposure = isStealth ? 0.9 : 1.28
        gl.setClearColor('#050709')
      }}
    >
      <PerspectiveCamera makeDefault position={[9.4, 4.7, 10.8]} fov={34} />
      <fog attach="fog" args={['#050709', 30, 90]} />
      <StudioEnvironment isStealth={isStealth} />

      <hemisphereLight
        args={['#d9f1f7', '#11161a', isStealth ? 0.55 : 1.35]}
      />
      <ambientLight intensity={isStealth ? 0.38 : 0.8} color="#b8d7df" />
      <directionalLight
        castShadow
        position={[7, 9, 4]}
        intensity={isStealth ? 3.2 : 5.8}
        color="#bdeaff"
        shadow-mapSize={[2048, 2048]}
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
        <F22Model
          animationStates={animationStates}
          isPlaying={isPlaying}
          playbackSpeed={playbackSpeed}
          seekRequest={seekRequest}
          manualFlight={manualFlight}
          aircraftMotionEnabled={aircraftMotionEnabled}
          flightInput={flightInput}
          flightResetId={flightResetId}
          onClipsReady={onClipsReady}
          onModelBoundsReady={setModelRadius}
          onTimeUpdate={onTimeUpdate}
        />
      </Suspense>

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
    </Canvas>
  )
}
