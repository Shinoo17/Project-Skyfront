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
import { DEFAULT_FLIGHT_QUALITY, useGraphicsProfile } from '../../three/graphics'
import SyncedFrameLoop from '../../three/SyncedFrameLoop'
import { BASE_FOV } from '../flight/chaseCamera'
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
  debug = false,
  paused = false,
  quality = DEFAULT_FLIGHT_QUALITY,
}) {
  const aircraft = getAircraft(aircraftId)
  const map = getMap(mapId)
  const graphics = useGraphicsProfile(quality)

  return (
    <Canvas
      // Antialiasing and the GPU power preference are fixed when the WebGL context is
      // created, so a quality change is a new context — which is a new sortie, from the
      // spawn. The menu says so before it happens.
      key={quality}
      // Manual, not on demand: this surface renders every frame it asks for, and demand
      // mode tops out at half the display's refresh rate. SyncedFrameLoop owns the tick.
      frameloop="never"
      dpr={graphics.dpr}
      shadows={graphics.shadows}
      camera={{
        position: [-286, 480, 0],
        fov: BASE_FOV,
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
