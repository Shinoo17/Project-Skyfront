import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'

/*
The render tick for a surface that draws itself rather than waiting to be asked.

It renders from its own animation frame, which is what keeps frame spacing tied to the
display instead of to a timer, with `targetFps` as a deliberate upper bound.

How it renders matters, and the two modes are not interchangeable:

  frameloop="never"  — this loop calls `advance()`, which runs useFrame and renders inside
                       our own rAF callback. The frame the pilot sees is the frame we asked
                       for, in the same vsync tick.
  frameloop="demand" — this loop calls `invalidate()`, which only raises a flag; R3F's own
                       rAF does the rendering. R3F cancels that loop the moment it has
                       nothing left to draw, so each invalidate has to restart it, and a
                       restart requested from inside a frame callback does not run until the
                       next frame. Steady state alternates request-frame / render-frame, so
                       demand mode cannot exceed half the display's refresh rate — a 120 Hz
                       target on a 120 Hz panel measures 60.

The sortie asks for "never" for that reason. The hangar renders only when something changes
and stays on demand, which is what demand is for. The dev observer is still on demand with a
60 target: on a 120 Hz panel the halving lands it on 60 anyway, and its dual-view renderer
decides who calls gl.render, so it is not a blind swap.
*/
export default function SyncedFrameLoop({ targetFps }) {
  const advance = useThree((state) => state.advance)
  const invalidate = useThree((state) => state.invalidate)
  const manual = useThree((state) => state.frameloop) === 'never'
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)

  useEffect(() => {
    invalidate()
    if (!targetFps) return undefined

    let requestId = 0
    let previousFrame = performance.now()
    const frameInterval = 1000 / targetFps

    const tick = (now) => {
      requestId = window.requestAnimationFrame(tick)
      if (document.hidden) {
        previousFrame = now
        return
      }

      const elapsed = now - previousFrame
      if (elapsed < frameInterval - 1) return
      previousFrame = now
      // Seconds, not milliseconds: in manual mode R3F takes the timestamp as the clock
      // itself, and useFrame's delta is the difference between two of them.
      if (manual) advance(now / 1000)
      else invalidate()
    }

    requestId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(requestId)
  }, [advance, invalidate, manual, targetFps])

  /*
  A stopped manual loop has no other way to put anything on the canvas: in "never" mode
  `invalidate` does nothing, so a paused surface that resizes, remounts its renderer for a
  quality change, or comes back from a backgrounded tab has no guarantee its last frame is
  still there. This redraws the scene a few times a second while stopped — `gl.render`
  rather than `advance`, so no useFrame runs and nothing simulates. A static scene at 8 Hz
  costs nothing, and it covers every one of those cases with one mechanism.
  */
  useEffect(() => {
    if (targetFps || !manual) return undefined

    let requestId = 0
    let previousFrame = 0
    const tick = (now) => {
      requestId = window.requestAnimationFrame(tick)
      if (document.hidden || now - previousFrame < 120) return
      previousFrame = now
      gl.render(scene, camera)
    }

    requestId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(requestId)
  }, [camera, gl, manual, scene, size, targetFps])

  return null
}
