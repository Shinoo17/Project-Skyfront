import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'

import { computePipRect } from './pip'

/*
Two views of one scene, drawn in one frame.

A `useFrame` subscription with a priority above zero takes rendering away from R3F, so
this component owns both passes: the observer camera over the full canvas, then the pilot's
chase camera scissored into the corner. Because there is exactly one scene and one physics
step ahead of it — the flight loop runs at priority 0, this runs at 1 — the two pictures are
the same instant by construction. Nothing has to be synchronized because nothing is copied.

`autoClear` is left alone on purpose: `render` clears through the scissor rect, so the
second pass wipes only its own box and leaves the observer view intact.
*/
export default function DualViewRenderer({ pipCamera, enabled = true, onRect }) {
  const size = useThree((state) => state.size)

  const rect = useMemo(
    () => computePipRect(size.width, size.height),
    [size.height, size.width],
  )

  useEffect(() => {
    pipCamera.aspect = rect.width / rect.height
    pipCamera.updateProjectionMatrix()
  }, [pipCamera, rect])

  useEffect(() => {
    onRect?.(enabled ? rect : null)
  }, [enabled, onRect, rect])

  useFrame(({ gl, scene, camera, size: viewport }) => {
    gl.setScissorTest(false)
    gl.setViewport(0, 0, viewport.width, viewport.height)
    gl.render(scene, camera)

    if (!enabled) return

    // The rect is measured from the top like the DOM; WebGL's origin is bottom-left.
    const bottom = viewport.height - rect.y - rect.height
    gl.setScissorTest(true)
    gl.setViewport(rect.x, bottom, rect.width, rect.height)
    gl.setScissor(rect.x, bottom, rect.width, rect.height)
    gl.render(scene, pipCamera)

    gl.setScissorTest(false)
    gl.setViewport(0, 0, viewport.width, viewport.height)
  }, 1)

  return null
}
