import { useProgress } from '@react-three/drei'

export default function LoaderScreen() {
  const { active, progress, loaded, total, errors } = useProgress()
  const hasError = errors.length > 0

  if (!active && progress === 100 && !hasError) return null

  return (
    <div className={`loader-screen ${hasError ? 'is-error' : ''}`} role="status">
      <div className="loader-reticle" aria-hidden="true">
        <span />
      </div>
      <p className="loader-kicker">
        {hasError ? 'MODEL LINK ERROR' : 'INITIALIZING AIRFRAME'}
      </p>
      <div className="loader-progress">
        <span style={{ transform: `scaleX(${Math.max(progress, 0) / 100})` }} />
      </div>
      <div className="loader-readout">
        <strong>{hasError ? 'OFFLINE' : `${Math.round(progress)}%`}</strong>
        <span>
          {hasError
            ? 'ตรวจสอบไฟล์ public/F22_optimize.glb และ public/basis แล้วลองรีเฟรชอีกครั้ง'
            : `${loaded}/${total || '—'} ASSETS`}
          </span>
      </div>
      {hasError && (
        <button
          type="button"
          className="loader-retry"
          onClick={() => window.location.reload()}
        >
          RETRY VIEWER
        </button>
      )}
    </div>
  )
}
