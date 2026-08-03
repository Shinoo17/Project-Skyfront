/*
THESIS: One world, two lenses — a free observer over the range and the pilot's own view boxed in the corner.
OWN-WORLD: The same terrain, airframe and physics the sortie flies; only the cameras differ.
STORY: The developer drags around the aircraft, watches it manoeuvre from outside, and checks the corner to see what the pilot saw at that instant.
FIRST VIEWPORT: The valley from a static observer post with the jet crossing it, its cockpit view inset bottom-right.
FORM: Composition only — no flight logic lives here, and the observer camera never turns to face the aircraft.
*/

import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PerspectiveCamera, Vector3 } from 'three'

import { getAircraft } from '../../aircraft'
import { getMap } from '../../maps'
import { useGraphicsProfile } from '../../three/graphics'
import SyncedFrameLoop from '../../three/SyncedFrameLoop'
import { BASE_FOV } from '../flight/chaseCamera'
import DebugVectors from '../flight/DebugVectors'
import ManeuverBot from '../flight/ManeuverBot'
import FlightRange from '../world/FlightRange'
import MapEnvironment from '../world/MapEnvironment'
import DualViewRenderer from './DualViewRenderer'

// Where the observer stands relative to whatever it is asked to look at. Off the nose,
// above and to one side, so the first frame shows the aircraft's plan and profile at once.
const OBSERVER_OFFSET = new Vector3(-120, 62, 130)

/*
The observer camera. Placed once when the range loads, moved by the mouse, and re-aimed only
when the developer asks for it. It has two modes and neither of them is a chase camera:

- Static (default). The camera does not move at all. The jet flies past a fixed post, which
  is the honest answer to "what does a bystander see".
- Tracking. The camera and its orbit target are both carried by the aircraft's own frame-to-
  frame translation — the same delta added to both, so the offset between them, and with it
  the viewing direction, the distance and the framing, are bit-for-bit unchanged. Only x, y
  and z move. Fly at the camera and it retreats ahead of you; fly away and it comes along.
  Nothing here reads the aircraft's *attitude*, so a roll or a loop never swings the view.

`TRACK_PRIORITY` sits between the flight loop (priority 0) and the two render passes, so the
translation is always taken from the position the same frame is about to draw.
*/
const TRACK_PRIORITY = 1

function ObserverRig({ map, spawn, telemetry, recenterId, track = false }) {
  const camera = useThree((state) => state.camera)
  const invalidate = useThree((state) => state.invalidate)
  const orbit = useRef()
  const scratch = useMemo(
    () => ({ offset: new Vector3(), point: new Vector3(), delta: new Vector3() }),
    [],
  )
  // Where the aircraft was when tracking last moved the camera. Null means "not tracking
  // yet" — the first tracked frame seeds it and moves nothing, so switching the mode on
  // never jolts the view by however far the jet has flown since the page loaded.
  const anchor = useRef(null)

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

  // Dropped on every change of the mode, in both directions. A stale anchor is the whole
  // range's worth of flying that happened while tracking was off, and applying it would
  // fling the camera across the map the instant the mode came back on.
  useEffect(() => {
    anchor.current = null
  }, [track])

  useFrame(() => {
    if (!track) return
    const position = telemetry.current.position
    const controls = orbit.current
    if (!position || !controls) return
    if (!anchor.current) {
      anchor.current = position.clone()
      return
    }

    scratch.delta.subVectors(position, anchor.current)
    anchor.current.copy(position)
    if (scratch.delta.lengthSq() < 1e-10) return

    // The same translation on both ends of the orbit, and deliberately no `update` call:
    // OrbitControls derives its spherical offset from position minus target at the top of
    // every update, so moving both leaves the angle and the distance untouched, and the
    // damping pass it already runs each frame would apply a second time if called here.
    camera.position.add(scratch.delta)
    controls.target.add(scratch.delta)
  }, TRACK_PRIORITY)

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
  track = false,
  maneuver = null,
  runNonce = 0,
  botStatus,
  botLoop = false,
  onRequestReset,
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

  // Held stable across renders on purpose. Every panel toggle re-renders this component,
  // and a fresh options object is the one thing that could talk R3F into re-seating the
  // observer camera — which would throw away the angle the developer just dragged to.
  const cameraConfig = useMemo(() => ({
    position: [-430, 300, 190],
    fov: 55,
    near: map.camera.near,
    far: map.observer.far,
  }), [map])

  const glConfig = useMemo(() => ({
    antialias: graphics.antialias,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: graphics.powerPreference,
  }), [graphics])

  return (
    <Canvas
      frameloop="demand"
      dpr={graphics.dpr}
      shadows={graphics.shadows}
      camera={cameraConfig}
      gl={glConfig}
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
      {botStatus && (
        <ManeuverBot
          maneuver={maneuver}
          runNonce={runNonce}
          controls={controls}
          telemetry={telemetry}
          status={botStatus}
          loop={botLoop}
          onRequestReset={onRequestReset}
        />
      )}
      <ObserverRig
        map={map}
        spawn={spawn}
        telemetry={telemetry}
        recenterId={recenterId}
        track={track}
      />
      <DualViewRenderer pipCamera={pipCamera} enabled={pip} onRect={onPipRect} />
      <SyncedFrameLoop targetFps={graphics.targetFps} />
    </Canvas>
  )
}
