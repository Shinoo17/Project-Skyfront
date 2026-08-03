import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { ArrowHelper, MathUtils, Vector3 } from 'three'

// World-space force and state arrows, driven straight off the telemetry the flight loop
// publishes. Rendered only while the debug overlay is up; costs nothing otherwise.
const DEBUG_ARROWS = [
  { key: 'forward', color: 0x37d5ff, scale: 24, fixed: true },
  { key: 'velocity', color: 0x62ff84, scale: 0.45 },
  { key: 'liftForce', color: 0x5a8dff, scale: 1.4 },
  { key: 'dragForce', color: 0xff5a5a, scale: 1.4 },
  { key: 'thrustForce', color: 0xffb347, scale: 1.4 },
]

const FORWARD = new Vector3(1, 0, 0)
const debugDirection = new Vector3()

export default function DebugVectors({ telemetry }) {
  const arrows = useMemo(
    () => DEBUG_ARROWS.map((spec) => ({
      spec,
      helper: new ArrowHelper(FORWARD, new Vector3(), 1, spec.color, 2.2, 1.4),
    })),
    [],
  )

  useFrame(() => {
    const state = telemetry.current
    arrows.forEach(({ spec, helper }) => {
      const vector = state[spec.key]
      const usable = state.live && state.position && vector && vector.lengthSq() > 1e-4
      helper.visible = Boolean(usable)
      if (!usable) return
      helper.position.copy(state.position)
      helper.setDirection(debugDirection.copy(vector).normalize())
      helper.setLength(
        spec.fixed ? spec.scale : MathUtils.clamp(vector.length() * spec.scale, 3, 46),
        2.2,
        1.4,
      )
    })
  })

  return (
    <group>
      {arrows.map(({ spec, helper }) => <primitive key={spec.key} object={helper} />)}
    </group>
  )
}
