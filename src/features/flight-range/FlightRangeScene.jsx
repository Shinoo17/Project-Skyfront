/*
The pilot's view of a range: one Canvas, one map, one aircraft, and the aircraft flying the
camera. Everything it draws now lives in shared modules — this file is the wiring that says
"the sortie's camera is the chase camera", which is the one thing that makes it the sortie.
*/

import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'
import { PerspectiveCamera } from 'three'

import { getAircraft } from '../../aircraft'
import { getMap } from '../../maps'
import {
  DEFAULT_FLIGHT_QUALITY,
  flightGraphicsKey,
  resolveFlightGraphics,
} from '../../three/graphics'
import SyncedFrameLoop from '../../three/SyncedFrameLoop'
import { FLIGHT_FOV_RANGE } from '../flight/chaseCamera'
import DebugVectors from '../flight/DebugVectors'
import FlightRange from '../world/FlightRange'
import MapEnvironment from '../world/MapEnvironment'

export default function FlightRangeScene({
  controls,
  resetId,
  telemetry,
  aircraftId,
  mapId,
  cameraMode = 'chase',
  cameraStyle = 'combat',
  cameraDistance = 'normal',
  cameraFov = FLIGHT_FOV_RANGE.default,
  debug = false,
  paused = false,
  quality = DEFAULT_FLIGHT_QUALITY,
  customGraphics = null,
}) {
  const aircraft = getAircraft(aircraftId)
  const map = getMap(mapId)
  const graphics = resolveFlightGraphics(quality, customGraphics)

  return (
    <Canvas
      // Antialiasing and the GPU power preference are fixed when the WebGL context is
      // created, so a quality change is a new context — which is a new sortie, from the
      // spawn. The menu says so before it happens. On a custom profile only the fields that
      // genuinely need a new context are in this key, so moving the frame target keeps the
      // aircraft in the air.
      key={flightGraphicsKey(quality, customGraphics)}
      // Manual, not on demand: this surface renders every frame it asks for, and demand
      // mode tops out at half the display's refresh rate. SyncedFrameLoop owns the tick.
      frameloop="never"
      dpr={graphics.dpr}
      shadows={graphics.shadows}
      camera={{
        position: [-286, 480, 0],
        // The pilot's lens, so the first frame is already at the field of view they chose
        // rather than lerping into it from the authored default.
        fov: cameraFov,
        near: map.camera.near,
        far: map.camera.far,
      }}
      gl={{
        antialias: graphics.antialias,
        alpha: false,
        depth: true,
        stencil: false,
        powerPreference: graphics.powerPreference,
      }}
      onCreated={({ camera }) => {
        if (camera instanceof PerspectiveCamera) camera.updateProjectionMatrix()
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
          cameraMode={cameraMode}
          cameraStyle={cameraStyle}
          cameraDistance={cameraDistance}
          cameraFov={cameraFov}
          paused={paused}
        />
      </Suspense>
      {debug && <DebugVectors telemetry={telemetry} />}
      {/*
        The pause. The Canvas renders on demand, so withholding the tick is the whole of it:
        no frame is requested, `useFrame` never runs, and the flight model stops integrating
        with the last frame still on screen. Nothing in the simulation has to know.
      */}
      <SyncedFrameLoop targetFps={paused ? 0 : graphics.targetFps} />
    </Canvas>
  )
}
