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
  AdditiveBlending,
  Box3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  LoopOnce,
  MathUtils,
  Mesh,
  PMREMGenerator,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'

import { getAircraft } from '../../aircraft'
import { applySurfaceTargets } from '../flight/surfaces'
import { makeHinges } from '../../three/hinge'
import { getKTX2Loader, withKTX2 } from '../../three/ktx2'
import { prepareModelAnimations } from '../../three/pose'

// --- Engine exhaust ---------------------------------------------------------
// The plume is a single open cylinder per engine with an additive shader.
// Nothing about it may read as a solid surface: the silhouette fades out with
// the view-facing term (soft edge from every camera angle), the head blends
// out of the nozzle, the tail decays exponentially, and scrolling noise breaks
// up any remaining structure. Dry thrust is a barely-visible violet shimmer;
// afterburner brings the bright core, orange mid, violet fringe, and the
// stationary shock-diamond cells of the reference photo.

const PLUME_AXIS = new Vector3(0, 0, 1)
const EXHAUST_LIGHT_MIL = new Color('#7d8cff')
const EXHAUST_LIGHT_AB = new Color('#ff9448')

const EXHAUST_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vAxial;

  void main() {
    vAxial = position.z;

    // Turbulent breathing of the plume boundary, growing downstream so the
    // exit ring stays anchored to the nozzle petals.
    float wobble =
      sin(position.z * 11.0 - uTime * 8.5) * 0.03 +
      sin(position.z * 4.5 - uTime * 5.0 + position.x * 3.0) * 0.035;
    vec3 displaced = position;
    displaced.xy *= 1.0 + wobble * position.z;

    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    vNormal = normalMatrix * normal;
    vView = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const PLUME_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uMil;
  uniform float uAb;
  uniform float uSeed;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vAxial;

  float hash(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), f);
  }

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 view = normalize(vView);

    // Facing term doubles as fake density: silhouette rays graze a thin chord
    // of plume, rays through the middle cross the full column.
    float facing = abs(dot(normal, view));
    float silhouette = smoothstep(0.0, 0.65, facing);
    float core = pow(facing, 2.6);

    float axial = clamp(vAxial, 0.0, 1.0);
    float head = smoothstep(0.0, 0.05, axial);
    float tail = pow(clamp(1.0 - axial, 0.0, 1.0), mix(2.5, 1.7, uAb));

    float flicker = mix(
      0.84,
      1.12,
      noise1(axial * 4.0 - uTime * (2.2 + 3.5 * uAb) + uSeed) * 0.6 +
        noise1(axial * 9.0 - uTime * (3.6 + 5.5 * uAb) + uSeed * 2.0) * 0.4
    );

    // Shock diamonds stand still relative to the nozzle and wash out
    // downstream as the jet mixes with ambient air.
    float diamonds =
      pow(max(sin(axial * 40.0 + uSeed), 0.0), 6.0) * exp(-axial * 5.0) * uAb;

    float intensity =
      (uMil * 0.95 + uAb * (1.1 + diamonds * 1.7)) *
      head * tail * silhouette * mix(0.3, 1.0, core) * flicker;

    vec3 milColor = vec3(0.5, 0.58, 1.0);
    vec3 abColor = mix(
      vec3(0.55, 0.35, 1.0),
      vec3(1.0, 0.42, 0.16),
      smoothstep(0.12, 0.6, facing)
    );
    abColor = mix(
      abColor,
      vec3(1.0, 0.92, 0.8),
      pow(facing, 3.0) * (1.0 - axial * 0.65)
    );
    vec3 color = mix(milColor, abColor, clamp(uAb * 1.4, 0.0, 1.0));

    gl_FragColor = vec4(color * intensity, 1.0);
  }
`

const GLOW_FRAGMENT_SHADER = /* glsl */ `
  uniform float uMil;
  uniform float uAb;
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float intensity = pow(facing, 1.7) * (uMil * 1.1 + uAb * 2.4);

    vec3 milColor = vec3(0.5, 0.58, 1.0);
    vec3 abColor = mix(
      vec3(1.0, 0.5, 0.2),
      vec3(1.0, 0.86, 0.72),
      pow(facing, 2.0)
    );
    vec3 color = mix(milColor, abColor, clamp(uAb * 1.3, 0.0, 1.0));

    gl_FragColor = vec4(color * intensity, 1.0);
  }
`

let plumeGeometry
function getPlumeGeometry() {
  if (!plumeGeometry) {
    // Unit plume along +Z: exit ring radius 1 at z=0, tapering to z=1.
    plumeGeometry = new CylinderGeometry(1, 0.45, 1, 28, 20, true)
    plumeGeometry.translate(0, -0.5, 0)
    plumeGeometry.rotateX(-Math.PI / 2)
  }
  return plumeGeometry
}

let glowGeometry
function getGlowGeometry() {
  if (!glowGeometry) {
    glowGeometry = new SphereGeometry(1, 20, 14)
  }
  return glowGeometry
}

function makeExhaustMaterial(fragmentShader, seed) {
  return new ShaderMaterial({
    vertexShader: EXHAUST_VERTEX_SHADER,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uMil: { value: 0 },
      uAb: { value: 0 },
      uSeed: { value: seed },
    },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  })
}

function EngineExhaust({ engine, spool }) {
  const plume = useRef()
  const glow = useRef()
  const light = useRef()
  const plumeMaterial = useMemo(
    () => makeExhaustMaterial(PLUME_FRAGMENT_SHADER, engine.seed),
    [engine.seed],
  )
  const glowMaterial = useMemo(
    () => makeExhaustMaterial(GLOW_FRAGMENT_SHADER, engine.seed),
    [engine.seed],
  )
  const temps = useMemo(
    () => ({
      upper: new Vector3(),
      lower: new Vector3(),
      exit: new Vector3(),
      hinge: new Vector3(),
      direction: new Vector3(),
      parentQuaternion: new Quaternion(),
    }),
    [],
  )

  useEffect(
    () => () => {
      plumeMaterial.dispose()
      glowMaterial.dispose()
    },
    [glowMaterial, plumeMaterial],
  )

  useFrame((state) => {
    if (!plume.current || !glow.current || !light.current) return

    const { mil, ab } = spool.current
    const active = mil > 0.02 || ab > 0.01
    plume.current.visible = active
    glow.current.visible = active
    light.current.visible = active
    if (!active) return

    const { flapUpper, flapLower } = engine
    const time = state.clock.elapsedTime

    // Nozzle exit sits between the two flap petals; the plume leaves along the
    // hinge-to-petal bisector, so thrust vectoring steers it for free.
    flapUpper.getWorldPosition(temps.upper)
    flapLower.getWorldPosition(temps.lower)
    temps.exit.addVectors(temps.upper, temps.lower).multiplyScalar(0.5)
    flapUpper.parent.getWorldPosition(temps.upper)
    flapLower.parent.getWorldPosition(temps.lower)
    temps.hinge.addVectors(temps.upper, temps.lower).multiplyScalar(0.5)
    const radius = MathUtils.clamp(
      temps.upper.distanceTo(temps.lower) * 0.8,
      0.12,
      0.5,
    )
    temps.direction.subVectors(temps.exit, temps.hinge).normalize()

    const parent = plume.current.parent
    parent.updateWorldMatrix(true, false)
    parent.worldToLocal(temps.exit)
    parent.getWorldQuaternion(temps.parentQuaternion)
    temps.direction.applyQuaternion(temps.parentQuaternion.invert())

    const flicker =
      0.94 + 0.11 * Math.sin(time * 14 + engine.seed) * Math.sin(time * 6.1 + engine.seed * 1.7)
    const length =
      radius *
      (1.6 + mil * 5.5 + ab * (12.5 + 0.7 * Math.sin(time * 3 + engine.seed)))
    const width = radius * (1 + 0.3 * ab)

    plume.current.position
      .copy(temps.exit)
      .addScaledVector(temps.direction, radius * 0.1)
    plume.current.quaternion.setFromUnitVectors(PLUME_AXIS, temps.direction)
    plume.current.scale.set(width, width, length)

    glow.current.position
      .copy(temps.exit)
      .addScaledVector(temps.direction, -radius * 0.2)
    glow.current.scale.setScalar(radius * (0.75 + 0.25 * ab))

    light.current.position
      .copy(temps.exit)
      .addScaledVector(temps.direction, length * 0.3)
    light.current.intensity = (mil * 2.5 + ab * 26) * flicker
    light.current.color
      .copy(EXHAUST_LIGHT_MIL)
      .lerp(EXHAUST_LIGHT_AB, Math.min(ab * 1.3, 1))

    plumeMaterial.uniforms.uTime.value = time
    plumeMaterial.uniforms.uMil.value = mil
    plumeMaterial.uniforms.uAb.value = ab
    glowMaterial.uniforms.uMil.value = mil
    glowMaterial.uniforms.uAb.value = ab
  })

  return (
    <>
      <mesh
        ref={plume}
        geometry={getPlumeGeometry()}
        material={plumeMaterial}
        renderOrder={12}
        frustumCulled={false}
        visible={false}
      />
      <mesh
        ref={glow}
        geometry={getGlowGeometry()}
        material={glowMaterial}
        renderOrder={11}
        frustumCulled={false}
        visible={false}
      />
      <pointLight ref={light} visible={false} distance={10} decay={2} intensity={0} />
    </>
  )
}

function ExhaustPlumes({ aircraft, model, throttle, afterburner, manualFlight }) {
  const spool = useRef({ mil: 0, ab: 0 })
  const invalidate = useThree((state) => state.invalidate)
  const engines = useMemo(
    () =>
      aircraft.engines
        .map(({ id, flapUpper: upperName, flapLower: lowerName }) => {
          const flapUpper = model.getObjectByName(upperName)
          const flapLower = model.getObjectByName(lowerName)
          // Shared seed keeps both engines breathing in phase.
          if (!flapUpper?.parent || !flapLower?.parent) return null
          return { id, flapUpper, flapLower, seed: 0 }
        })
        .filter(Boolean),
    [aircraft, model],
  )

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.05)
    const milTarget = manualFlight ? throttle : 0
    const abTarget = manualFlight && afterburner ? 1 : 0
    const state = spool.current

    // Engines spool slowly; the afterburner lights faster than it cuts out.
    state.mil += (milTarget - state.mil) * (1 - Math.exp(-2.4 * step))
    state.ab +=
      (abTarget - state.ab) *
      (1 - Math.exp(-(abTarget > state.ab ? 3.6 : 5.5) * step))

    // Keep demand rendering alive just long enough to finish the spool-down
    // after flight mode exits, instead of freezing a half-visible exhaust.
    if (
      Math.abs(milTarget - state.mil) > 0.001 ||
      Math.abs(abTarget - state.ab) > 0.001
    ) {
      invalidate()
    }
  })

  return engines.map((engine) => (
    <EngineExhaust key={engine.id} engine={engine} spool={spool} />
  ))
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
    >
      <primitive object={model} />
      <ExhaustPlumes
        aircraft={aircraft}
        model={model}
        throttle={throttle}
        afterburner={afterburner}
        manualFlight={manualFlight}
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
}) {
  const controls = useRef()
  const fpsMeter = useRef({ frames: 0 })
  const [modelRadius, setModelRadius] = useState(5.3)
  const isStealth = lightingMode === 'stealth'
  const aircraft = getAircraft(aircraftId)

  return (
    <>
      <Canvas
        frameloop="demand"
        dpr={[1, 1.25]}
        shadows
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'default',
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
          shadow-mapSize={[1024, 1024]}
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
            onModelBoundsReady={setModelRadius}
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
        <ContinuousRender active={autoRotate || manualFlight} />
        <FrameCounter meter={fpsMeter} />
      </Canvas>
      <FpsReadout meter={fpsMeter} />
    </>
  )
}
