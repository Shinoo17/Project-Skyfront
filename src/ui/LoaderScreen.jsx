import { useProgress } from '@react-three/drei'

/*
`map` is optional and only means anything on a flight surface: it supplies the range's own
loading line and names its own asset in the failure copy, so a second map never sends the
pilot looking for the first one's file.
*/
export default function LoaderScreen({ mode = 'viewer', map = null }) {
  const { active, progress, loaded, total, errors } = useProgress()
  const hasError = errors.length > 0
  const isFlight = mode === 'flight'

  if (!active && progress === 100 && !hasError) return null

  const assets = ['F22_model.glb', ...(map?.assets ?? [])].join(', ')

  return (
    <div className={`loader-screen ${hasError ? 'is-error' : ''}`} role="status">
      <div className="loader-reticle" aria-hidden="true">
        <span />
      </div>
      <p className="loader-kicker">
        {hasError
          ? 'MODEL LINK ERROR'
          : isFlight ? (map?.loading ?? 'LOADING RANGE') : 'INITIALIZING AIRFRAME'}
      </p>
      <div className="loader-progress">
        <span style={{ transform: `scaleX(${Math.max(progress, 0) / 100})` }} />
      </div>
      <div className="loader-readout">
        <strong>{hasError ? 'OFFLINE' : `${Math.round(progress)}%`}</strong>
        <span>
          {hasError
            ? isFlight
              ? `ตรวจสอบไฟล์ ${assets} และ public/basis แล้วลองใหม่`
              : 'ตรวจสอบไฟล์ public/F22_model.glb และ public/basis แล้วลองรีเฟรชอีกครั้ง'
            : `${loaded}/${total || '—'} ASSETS`}
          </span>
      </div>
      {hasError && (
        <button
          type="button"
          className="loader-retry"
          onClick={() => window.location.reload()}
        >
          {isFlight ? 'RETRY TEST FLIGHT' : 'RETRY VIEWER'}
        </button>
      )}
    </div>
  )
}
