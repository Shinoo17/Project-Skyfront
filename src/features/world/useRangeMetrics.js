import { useMemo } from 'react'
import { Box3, Vector3 } from 'three'

/*
Everything the flight loop needs to know about a range, measured off the terrain the map
actually shipped rather than restated as constants.

The mesh is scaled to `map.span` along its longest horizontal axis, so its own bounds at
that scale give the range walls, the height of the highest ground, and from there the
spawn altitude and the ceiling. A second map with taller peaks or a different footprint
gets a correct envelope without touching this file.
*/
export default function useRangeMetrics(terrainScene, map) {
  return useMemo(() => {
    terrainScene.updateMatrixWorld(true)
    const size = new Box3().setFromObject(terrainScene).getSize(new Vector3())
    const scale = map.span / Math.max(size.x, size.z)
    const terrainHeight = size.y * scale

    const spawnAltitude = Math.max(
      map.spawn.minAltitude,
      terrainHeight + map.spawn.clearance,
    )

    return {
      terrainHeight,
      spawnAltitude,
      spawn: new Vector3(map.spawn.x, spawnAltitude, map.spawn.z),
      bounds: {
        x: (size.x * scale * 0.5) - map.edgeMargin,
        z: (size.z * scale * 0.5) - map.edgeMargin,
        altitude: terrainHeight + map.ceilingAboveTerrain,
      },
    }
  }, [map, terrainScene])
}
