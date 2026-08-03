import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'

// Demand rendering stays synchronized to the display instead of relying on a timer,
// which avoids uneven frame spacing while retaining a deliberate upper bound.
export default function SyncedFrameLoop({ targetFps }) {
  const invalidate = useThree((state) => state.invalidate)

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
      invalidate()
    }

    requestId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(requestId)
  }, [invalidate, targetFps])

  return null
}
