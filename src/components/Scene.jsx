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
  LoopRepeat,
  MathUtils,
  Mesh,
  PMREMGenerator,
  Quaternion,
  Vector3,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'

const MODEL_URL = '/F22_optimize.glb'
const KTX2_TRANSCODER_PATH = '/basis/'

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

function formatClipLabel(name, index) {
  return (name || `Animation ${index + 1}`)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
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

function F22Model({
  activeClip,
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
  const { actions, mixer } = useAnimations(animations, group)
  const baseAircraftQuaternion = useMemo(
    () => new Quaternion().setFromEuler(new Euler(0.04, -0.34, 0, 'XYZ')),
    [],
  )

  const model = useMemo(() => {
    const clone = cloneSkeleton(scene)
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

    return clone
  }, [scene])

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
      animations.map((clip, index) => ({
        name: clip.name || 'Untitled clip',
        label: formatClipLabel(clip.name, index),
        duration: clip.duration,
        tracks: clip.tracks.length,
      })),
    )
  }, [animations, onClipsReady])

  useEffect(() => {
    onModelBoundsReady(model.userData.viewerRadius)
  }, [model, onModelBoundsReady])

  useEffect(() => {
    if (manualFlight) {
      mixer.stopAllAction()
      mixer.update(0)
      onTimeUpdate(0)
      return undefined
    }

    const action = actions[activeClip]
    if (!action) return undefined

    Object.values(actions).forEach((item) => {
      if (item !== action) item.stop()
    })

    action.reset().setLoop(LoopRepeat, Infinity).play()

    return () => action.stop()
  }, [actions, activeClip, manualFlight, mixer, onTimeUpdate])

  useEffect(() => {
    const action = actions[activeClip]
    if (action) action.paused = manualFlight || !isPlaying
  }, [actions, activeClip, isPlaying, manualFlight])

  useEffect(() => {
    mixer.timeScale = playbackSpeed
  }, [mixer, playbackSpeed])

  useEffect(() => {
    const action = actions[activeClip]
    if (!action || !seekRequest || manualFlight) return
    action.time = MathUtils.clamp(seekRequest.time, 0, action.getClip().duration)
    mixer.update(0)
    onTimeUpdate(action.time)
  }, [actions, activeClip, manualFlight, mixer, onTimeUpdate, seekRequest])

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
    const action = actions[activeClip]
    if (!action) return
    if (state.clock.elapsedTime - reportFrame.current > 0.08) {
      reportFrame.current = state.clock.elapsedTime
      onTimeUpdate(action.time)
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
  activeClip,
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
          activeClip={activeClip}
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
