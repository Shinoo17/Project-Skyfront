import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Color, Fog } from 'three'

/*
Sky, haze and sun for one map, applied to whichever Canvas mounts it.

The clear colour, exposure and fog used to be set once in `onCreated`, which is fine while
there is exactly one range. Doing it in an effect keyed on the map means switching ranges
swaps the whole atmosphere without recreating the renderer, and it keeps the numbers where
the rest of the map lives.
*/
export default function MapEnvironment({ map }) {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const environment = map.environment

  useEffect(() => {
    gl.setClearColor(new Color(environment.clearColor))
    gl.toneMappingExposure = environment.toneMappingExposure ?? 1
    scene.fog = environment.fog
      ? new Fog(environment.fog.color, environment.fog.near, environment.fog.far)
      : null
    return () => {
      scene.fog = null
    }
  }, [environment, gl, scene])

  return (
    <>
      <hemisphereLight
        args={[
          environment.hemisphere.sky,
          environment.hemisphere.ground,
          environment.hemisphere.intensity,
        ]}
      />
      <directionalLight
        position={environment.sun.position}
        intensity={environment.sun.intensity}
        color={environment.sun.color}
      />
    </>
  )
}
