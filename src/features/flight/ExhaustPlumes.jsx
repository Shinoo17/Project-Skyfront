import { useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  MathUtils,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import { useEffect, useMemo, useRef } from 'react'

// One open additive cylinder per engine gives the plume a soft, view-dependent edge.
// Dry thrust stays a restrained violet shimmer; reheat adds a bright core, warm fringe,
// turbulent breathing, and stationary shock diamonds without a post-processing pass.
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
    plumeGeometry = new CylinderGeometry(1, 0.45, 1, 28, 20, true)
    plumeGeometry.translate(0, -0.5, 0)
    plumeGeometry.rotateX(-Math.PI / 2)
  }
  return plumeGeometry
}

let glowGeometry
function getGlowGeometry() {
  if (!glowGeometry) glowGeometry = new SphereGeometry(1, 20, 14)
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

export default function ExhaustPlumes({
  aircraft,
  model,
  throttle = 0,
  afterburner = false,
  active = true,
  controls,
  reheat,
  continuous = false,
}) {
  const spool = useRef({ mil: 0, ab: 0 })
  const invalidate = useThree((state) => state.invalidate)
  const engines = useMemo(
    () =>
      aircraft.engines
        .map(({ id, flapUpper: upperName, flapLower: lowerName }) => {
          const flapUpper = model.getObjectByName(upperName)
          const flapLower = model.getObjectByName(lowerName)
          if (!flapUpper?.parent || !flapLower?.parent) return null
          return { id, flapUpper, flapLower, seed: 0 }
        })
        .filter(Boolean),
    [aircraft, model],
  )

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.05)
    const liveThrottle = controls?.current?.throttle ?? throttle
    // On the range the burner is a flight-model state with a spool and a fuel reserve, so
    // the flame follows how much of it is actually alight. The airframe viewer has no
    // flight model behind its switch, so there reheat is simply on or off.
    const reheatLevel = reheat ? reheat.current.level : Number(afterburner)
    const milTarget = active ? liveThrottle : 0
    const abTarget = active ? reheatLevel : 0
    const state = spool.current

    state.mil += (milTarget - state.mil) * (1 - Math.exp(-2.4 * step))
    state.ab +=
      (abTarget - state.ab) *
      (1 - Math.exp(-(abTarget > state.ab ? 3.6 : 5.5) * step))

    if (!continuous && (
      Math.abs(milTarget - state.mil) > 0.001 ||
      Math.abs(abTarget - state.ab) > 0.001
    )) {
      invalidate()
    }
  })

  return engines.map((engine) => (
    <EngineExhaust key={engine.id} engine={engine} spool={spool} />
  ))
}
