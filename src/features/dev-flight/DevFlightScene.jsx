/*
THESIS: One world, two lenses — a free observer over the range and the pilot's own view boxed in the corner.
OWN-WORLD: The same terrain, airframe and physics the sortie flies; only the cameras differ.
STORY: The developer drags around the aircraft, watches it manoeuvre from outside, and checks the corner to see what the pilot saw at that instant.
FIRST VIEWPORT: The valley from a static observer post with the jet crossing it, its cockpit view inset bottom-right.
FORM: Composition only — no flight logic lives here, and the observer camera never follows the aircraft.
*/

import { OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PerspectiveCamera, Vector3 } from 'three'

import { getAircraft } from '../../aircraft'
import { getMap } from '../../maps'
import { useGraphicsProfile } from '../../three/graphics'
import SyncedFrameLoop from '../../three/SyncedFrameLoop'
import { BASE_FOV } from '../flight/chaseCamera'
import DebugVectors from '../flight/DebugVectors'
import FlightRange from '../world/FlightRange'
import MapEnvironment from '../world/MapEnvironment'
import DualViewRenderer from './DualViewRenderer'

// Where the observer stands relative to whatever it is asked to look at. Off the nose,
// above and to one side, so the first frame shows the aircraft's plan and profile at once.
const OBSERVER_OFFSET = new Vector3(-120, 62, 130)

/*
The observer camera. It is deliberately inert: it is placed once when the range loads, moved
only by the mouse, and re-aimed only when the developer explicitly asks for it. Nothing in
here reads the aircraft every frame, which is the whole point of the page — what you see is
what a bystander in the world would see, not a rig bolted to the jet.
*/
function ObserverRig({ map, spawn, telemetry, recenterId }) {
  const camera = useThree((state) => state.camera)
  const invalidate = useThree((state) => state.invalidate)
  const orbit = useRef()
  const scratch = useMemo(() => ({ offset: new Vector3(), point: new Vector3() }), [])

  const aim = useCallback((point, reseat) => {
    const controls = orbit.current
    if (!controls) return
    if (reseat) {
      scratch.offset.copy(OBSERVER_OFFSET)
    } else {
      // Keep the developer's own framing — distance and angle — and slide it onto the
      // new point rather than snapping back to the default post.
      scratch.offset.subVectors(camera.position, controls.target)
    }
    controls.target.copy(point)
    camera.position.copy(point).add(scratch.offset)
    controls.update()
    invalidate()
  }, [camera, invalidate, scratch])

  // First placement, once the range has been measured and the spawn point is known.
  useEffect(() => {
    if (!spawn) return
    aim(spawn, true)
  }, [aim, spawn])

  // Explicit re-aim. `recenterId` starts at 0 and is only ever bumped by the panel button,
  // so this cannot turn into a follow camera by accident.
  useEffect(() => {
    if (!recenterId) return
    aim(scratch.point.copy(telemetry.current.position ?? spawn ?? scratch.point), false)
  }, [aim, recenterId, scratch, spawn, telemetry])

  return (
    <OrbitControls
      ref={orbit}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.75}
      zoomSpeed={0.9}
      panSpeed={0.8}
      minDistance={map.observer.minDistance}
      maxDistance={map.observer.maxDistance}
      // Just short of level so the observer cannot orbit down inside the terrain.
      maxPolarAngle={Math.PI * 0.49}
    />
  )
}

export default function DevFlightScene({
  controls,
  resetId,
  telemetry,
  aircraftId,
  mapId,
  debug = false,
  pip = true,
  recenterId = 0,
  onPipRect,
}) {
  const aircraft = getAircraft(aircraftId)
  const map = getMap(mapId)
  const graphics = useGraphicsProfile('medium')
  const [spawn, setSpawn] = useState(null)

  // The pilot's camera is a real camera that simply never reaches the screen whole: the
  // flight loop flies it exactly as it flies the sortie's camera, and the renderer scissors
  // it into the corner. Detached from the scene graph on purpose — a camera needs no parent
  // to be rendered through, and keeping it out means nothing can reparent or cull it.
  const pipCamera = useMemo(
    () => new PerspectiveCamera(BASE_FOV, 16 / 9, map.camera.near, map.camera.far),
    [map],
  )

  const handleRangeReady = useCallback((metrics) => setSpawn(metrics.spawn), [])

  return (
    <Canvas
      frameloop="demand"
      dpr={graphics.dpr}
      shadows={graphics.shadows}
      camera={{
        position: [-430, 300, 190],
        fov: 55,
        near: map.camera.near,
        far: map.observer.far,
      }}
      gl={{
        antialias: graphics.antialias,
        alpha: false,
        depth: true,
        stencil: false,
        powerPreference: graphics.powerPreference,
      }}
    >
      <MapEnvironment map={map} />
      <Suspense fallback={null}>
        <FlightRange
          map={map}
          aircraft={aircraft}
          controls={controls}
          resetId={resetId}
          telemetry={telemetry}
          chaseCamera={pipCamera}
          onRangeReady={handleRangeReady}
        />
      </Suspense>
      {debug && <DebugVectors telemetry={telemetry} />}
      <ObserverRig
        map={map}
        spawn={spawn}
        telemetry={telemetry}
        recenterId={recenterId}
      />
      <DualViewRenderer pipCamera={pipCamera} enabled={pip} onRect={onPipRect} />
      <SyncedFrameLoop targetFps={graphics.targetFps} />
    </Canvas>
  )
}
