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
import { useGraphicsProfile } from '../../three/graphics'
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
  debug = false,
}) {
  const aircraft = getAircraft(aircraftId)
  const map = getMap(mapId)
  const graphics = useGraphicsProfile('medium')

  return (
    <Canvas
      frameloop="demand"
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
        />
      </Suspense>
      {debug && <DebugVectors telemetry={telemetry} />}
      <SyncedFrameLoop targetFps={graphics.targetFps} />
    </Canvas>
  )
}
