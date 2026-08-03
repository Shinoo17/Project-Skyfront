import { useMemo } from 'react'
import { Box3, FrontSide, Mesh, Vector3 } from 'three'

/*
One range mesh, rescaled to the map's declared span and dropped so its lowest point sits on
y = 0. The material stripping is deliberate: terrain this large is read at distance through
fog, where normal, roughness and metalness maps cost fill rate and buy nothing, and the
matrices are frozen because nothing in the mesh ever moves.

The same component serves every scene that flies a map — the sortie and the observer page
render the identical object, which is what lets the two views agree.
*/
export default function Terrain({ scene, map, groupRef }) {
  const data = useMemo(() => {
    const model = scene.clone(true)
    model.updateMatrixWorld(true)
    const bounds = new Box3().setFromObject(model)
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())
    const scale = map.span / Math.max(size.x, size.z)

    model.traverse((child) => {
      if (!(child instanceof Mesh)) return
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach((material) => {
        material.side = FrontSide
        material.normalMap = null
        material.roughnessMap = null
        material.metalnessMap = null
        material.roughness = 1
        material.metalness = 0
        if (material.map) material.map.anisotropy = 1
        material.needsUpdate = true
      })
      child.castShadow = false
      child.receiveShadow = false
      child.frustumCulled = true
      child.updateMatrix()
      child.matrixAutoUpdate = false
    })

    return {
      model,
      scale,
      position: new Vector3(
        -center.x * scale,
        -bounds.min.y * scale,
        -center.z * scale,
      ),
    }
  }, [map, scene])

  return (
    <group ref={groupRef} scale={data.scale} position={data.position}>
      <primitive object={data.model} />
    </group>
  )
}
