import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { ArrowHelper, MathUtils, Vector3 } from 'three'

/*
World-space arrows, driven straight off the telemetry the flight loop publishes. Rendered
only while the debug overlay is up; costs nothing otherwise.

The first five are the physics: where the nose points, where the aircraft is actually going,
and the three accelerations doing the arguing between them. The last two are the camera —
the follow axis it composed this frame and the airframe's up before the roll setting took its
share — and they are here rather than in a panel of numbers because the thing worth checking
about a camera reference is the *angle between it and the others*, which a column of floats
cannot show and two arrows show immediately. The interesting reading is a Cobra: the nose
arrow swings up through the vertical while the velocity arrow carries straight on, and the
camera arrow should stay much closer to the second than the first.
*/
const DEBUG_ARROWS = [
  { key: 'forward', color: 0x37d5ff, scale: 24, fixed: true },
  { key: 'velocity', color: 0x62ff84, scale: 0.45 },
  { key: 'liftForce', color: 0x5a8dff, scale: 1.4 },
  { key: 'dragForce', color: 0xff5a5a, scale: 1.4 },
  { key: 'thrustForce', color: 0xffb347, scale: 1.4 },
  { key: 'cameraForward', color: 0xff7ae0, scale: 18, fixed: true },
  { key: 'cameraBodyUp', color: 0xc9a4ff, scale: 10, fixed: true },
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
