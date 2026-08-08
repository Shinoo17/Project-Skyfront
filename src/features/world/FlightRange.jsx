import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'

import { getKTX2Loader, withKTX2 } from '../../three/ktx2'
import FlightAircraft from '../flight/FlightAircraft'
import Terrain from './Terrain'
import useRangeMetrics from './useRangeMetrics'

/*
One map with one aircraft flying it — the whole world, minus the camera and the chrome.

This is the piece every flight surface shares. The sortie mounts it and lets the aircraft
drive the Canvas camera; the observer page mounts the very same component and hands the
aircraft a detached camera instead, which is why the two views can never drift apart: there
is only ever one terrain, one airframe, and one physics step behind both of them.
*/
export default function FlightRange({
  map,
  aircraft,
  controls,
  resetId,
  telemetry,
  chaseCamera,
  onRangeReady,
  paused = false,
}) {
  const terrainRef = useRef()
  const renderer = useThree((state) => state.gl)
  const ktx2Loader = useMemo(() => getKTX2Loader(renderer), [renderer])
  const terrainGltf = useGLTF(map.url, false, true, withKTX2(ktx2Loader))
  const aircraftGltf = useGLTF(aircraft.url, false, true, withKTX2(ktx2Loader))

  const metrics = useRangeMetrics(terrainGltf.scene, map)

  useEffect(() => {
    onRangeReady?.(metrics)
  }, [metrics, onRangeReady])

  return (
    <>
      <Terrain scene={terrainGltf.scene} map={map} groupRef={terrainRef} />
      <FlightAircraft
        aircraft={aircraft}
        scene={aircraftGltf.scene}
        animations={aircraftGltf.animations}
        controls={controls}
        resetId={resetId}
        spawn={metrics.spawn}
        flightBounds={metrics.bounds}
        terrainRef={terrainRef}
        telemetry={telemetry}
        chaseCamera={chaseCamera}
        paused={paused}
      />
    </>
  )
}
