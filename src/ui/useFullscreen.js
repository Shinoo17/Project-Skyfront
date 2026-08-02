import { useCallback } from 'react'

export default function useFullscreen() {
  return useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch {
      // Fullscreen may be blocked by an embedded browser; the viewer remains usable.
    }
  }, [])
}
