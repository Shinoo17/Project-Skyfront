import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Box3, Euler, MathUtils, Mesh, Vector3 } from 'three'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { useEffect, useMemo, useRef } from 'react'

import { getKTX2Loader, withKTX2 } from '../../three/ktx2'

/*
The weapons display. Everything the airframe carries, laid out for inspection rather than
hung on the jet — that comes with the hardpoints milestone.

Two rules hold the display together. Every weapon is normalised to the same canonical pose
(body along +X, nose at +X, centred on the origin) using its own module's correction, so
the arrangement below never has to know how a particular .glb was exported. And every
weapon is scaled through one shared metres-to-world-units factor, so an AMRAAM reads as
longer than a Sidewinder because it is, not because of how the two files were authored.
*/

// World units the longest weapon on show is drawn at. Everything else follows from it.
const DISPLAY_SPAN = 7.4

// Half the angle between the outermost weapons when the whole loadout is shown. Two at ±24
// degrees cross as an X; three or more fan evenly across the same spread.
const SPREAD_DEG = 24

// Weapons cross at their midpoints, so they are separated along the view axis instead —
// enough to clear the fattest body and its fins.
const SPREAD_DEPTH = 0.6

const POSE_RESPONSE = 9

/*
Where a weapon sits. With nothing selected the loadout fans about the vertical; select one and
it swings level and centred — nose to starboard, full silhouette to the camera — while the
rest shrink away.
*/
function weaponPose(index, count, isSelected, hasSelection) {
  if (hasSelection) {
    return { angle: 0, depth: 0, scale: isSelected ? 1 : 0 }
  }

  const step = count > 1 ? index / (count - 1) : 0.5
  return {
    angle: MathUtils.degToRad(MathUtils.lerp(SPREAD_DEG, -SPREAD_DEG, step)),
    depth: MathUtils.lerp(SPREAD_DEPTH, -SPREAD_DEPTH, step),
    scale: 1,
  }
}

function WeaponModel({ weapon, unitsPerMetre, pose }) {
  const group = useRef()
  const current = useRef({ ...pose })
  const renderer = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const ktx2Loader = useMemo(() => getKTX2Loader(renderer), [renderer])
  const { scene } = useGLTF(weapon.url, false, true, withKTX2(ktx2Loader))

  const model = useMemo(() => {
    const clone = cloneSkeleton(scene)

    // Correct first, measure second: the bounds have to be read in the pose the weapon is
    // actually drawn in, or the length used for scaling is some diagonal of the export.
    clone.quaternion.setFromEuler(new Euler(...weapon.modelRotation, 'XYZ'))
    clone.updateMatrixWorld(true)

    const box = new Box3().setFromObject(clone)
    const center = box.getCenter(new Vector3())
    const bodyLength = box.getSize(new Vector3()).x
    const modelScale = (weapon.lengthMetres * unitsPerMetre) / bodyLength

    clone.scale.setScalar(modelScale)
    clone.position.copy(center).multiplyScalar(-modelScale)

    clone.traverse((child) => {
      if (!(child instanceof Mesh)) return
      child.castShadow = true
      child.receiveShadow = true
    })

    return clone
  }, [scene, unitsPerMetre, weapon])

  // The pose is damped rather than snapped, so switching between the loadout and a single
  // weapon reads as the weapon swinging round instead of teleporting.
  useEffect(() => {
    invalidate()
  }, [invalidate, pose.angle, pose.depth, pose.scale])

  useFrame((state, delta) => {
    if (!group.current) return

    const blend = 1 - Math.exp(-POSE_RESPONSE * Math.min(delta, 0.05))
    const settling = current.current
    settling.angle += (pose.angle - settling.angle) * blend
    settling.depth += (pose.depth - settling.depth) * blend
    settling.scale += (pose.scale - settling.scale) * blend

    group.current.rotation.z = settling.angle
    group.current.position.z = settling.depth
    group.current.scale.setScalar(Math.max(settling.scale, 0.0001))
    group.current.visible = settling.scale > 0.01

    const settled = Math.abs(pose.angle - settling.angle) < 0.0004
      && Math.abs(pose.depth - settling.depth) < 0.0004
      && Math.abs(pose.scale - settling.scale) < 0.0004

    if (settled) {
      settling.angle = pose.angle
      settling.depth = pose.depth
      settling.scale = pose.scale
    } else {
      invalidate()
    }
  })

  return (
    <group ref={group}>
      <primitive object={model} />
    </group>
  )
}

export default function WeaponDisplay({ loadout, selectedId, onBoundsReady }) {
  const unitsPerMetre = useMemo(() => {
    const longest = loadout.reduce((max, weapon) => Math.max(max, weapon.lengthMetres), 0)
    return longest ? DISPLAY_SPAN / longest : 1
  }, [loadout])

  // One framing for the whole loadout, selected or not, so picking a weapon out of the X does
  // not also shove the camera.
  useEffect(() => {
    onBoundsReady((DISPLAY_SPAN / 2) * 1.06)
  }, [onBoundsReady])

  const hasSelection = Boolean(selectedId)

  return (
    <group>
      {loadout.map((weapon, index) => (
        <WeaponModel
          key={weapon.id}
          weapon={weapon}
          unitsPerMetre={unitsPerMetre}
          pose={weaponPose(
            index,
            loadout.length,
            weapon.id === selectedId,
            hasSelection,
          )}
        />
      ))}
    </group>
  )
}
