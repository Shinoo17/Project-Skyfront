/*
THESIS: The sortie has no chrome — the menu is the chrome, and it only exists while the aircraft is stopped.
OWN-WORLD: The HUD's own green on a darkened canopy, one column of commands, nothing decorative.
STORY: Esc stops the world, the pilot picks resume, settings, credits or the hangar, and Esc puts them back.
FIRST VIEWPORT: A dimmed frozen frame with a single stack of commands centred on it; resume already focused.
FORM: One component owning its own panes, so the route only has to say whether flight is paused.
*/

import {
  Camera,
  Gauge,
  Info,
  LogOut,
  Maximize,
  MonitorCog,
  MousePointer2,
  Play,
  Settings,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { FLIGHT_QUALITY_OPTIONS } from '../../three/graphics'
import { MOUSE_SENSITIVITY_RANGE } from '../flight/useFlightControls'
import {
  FLIGHT_CAMERA_DISTANCE_OPTIONS,
  FLIGHT_CAMERA_STYLE_OPTIONS,
} from '../flight/chaseCamera'

// Credit only what the repository can actually prove: the assets it ships and the libraries
// it builds on. No names or licences are invented here — an attribution nobody supplied is
// worse than a short panel.
const CREDITS = [
  { role: 'Engine', detail: 'React · Three.js · @react-three/fiber · @react-three/drei' },
  { role: 'Interface', detail: 'Vite · lucide-react · hand-drawn canvas HUD' },
  { role: 'Flight model', detail: '6-DOF-lite simulation written for this project' },
]

/*
`onExit` is the only thing the menu cannot do for itself — leaving the sortie is the route's
decision. Everything else it holds: which pane is open, and putting focus somewhere useful
each time it appears.

Escape is handled here rather than in the flight session because its meaning depends on the
pane: inside settings or credits it steps back, and only at the top does it fly again.
*/
export default function PauseMenu({
  open,
  onResume,
  onExit,
  onFullscreen,
  debug,
  onToggleDebug,
  quality,
  onChooseQuality,
  cameraStyle,
  onChooseCameraStyle,
  cameraDistance,
  onChooseCameraDistance,
  mouseFlightEnabled,
  onChooseMouseFlightEnabled,
  mousePitchInverted,
  onChooseMousePitchInverted,
  mouseSensitivity = 1,
  onChooseMouseSensitivity,
}) {
  const [pane, setPane] = useState('root')
  const firstCommand = useRef(null)

  useEffect(() => {
    if (open) setPane('root')
  }, [open])

  // Focus follows the top pane rather than the opening, because the panel keeps its pane
  // between openings: the first render after Esc can still be settings, and Resume does not
  // exist yet to take focus. Stepping back from a sub-pane lands here too, which is right.
  useEffect(() => {
    if (open && pane === 'root') firstCommand.current?.focus()
  }, [open, pane])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      // P is the fullscreen escape hatch: a fullscreen browser keeps Esc for itself and
      // never delivers the keydown, so the menu would be unreachable with one key only.
      if (event.code !== 'Escape' && event.code !== 'KeyP') return
      event.preventDefault()
      if (pane === 'root') onResume()
      else setPane('root')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, pane, onResume])

  if (!open) return null

  return (
    <div className="pause-menu" role="dialog" aria-modal="true" aria-label="Flight paused">
      <div className="pause-panel">
        <header className="pause-head">
          <span className="pause-kicker">SORTIE PAUSED</span>
          <strong>F-22 <em>RAPTOR</em></strong>
        </header>

        {pane === 'root' && (
          <nav className="pause-commands" aria-label="Pause menu">
            <button type="button" className="pause-key is-primary" onClick={onResume} ref={firstCommand}>
              <Play size={17} strokeWidth={1.8} />
              <span>Resume</span>
            </button>
            <button type="button" className="pause-key" onClick={() => setPane('settings')}>
              <Settings size={17} strokeWidth={1.8} />
              <span>Settings</span>
            </button>
            <button type="button" className="pause-key" onClick={() => setPane('credits')}>
              <Info size={17} strokeWidth={1.8} />
              <span>Game credits</span>
            </button>
            <button type="button" className="pause-key" onClick={onExit}>
              <LogOut size={17} strokeWidth={1.8} />
              <span>Back to main</span>
            </button>
          </nav>
        )}

        {pane === 'settings' && (
          <div className="pause-pane">
            <h2 className="pause-pane-title">Settings</h2>

            <div className="pause-quality" role="group" aria-label="Graphics quality">
              <span className="pause-quality-head"><MonitorCog size={15} strokeWidth={1.8} /> Graphics</span>
              {FLIGHT_QUALITY_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`pause-key is-quality ${option.id === quality ? 'is-on' : ''}`}
                  aria-pressed={option.id === quality}
                  onClick={() => onChooseQuality(option.id)}
                >
                  <span>{option.label}</span>
                  <i aria-hidden="true">{option.detail}</i>
                </button>
              ))}
              <p className="pause-note">
                Changing quality rebuilds the renderer, which restarts the sortie from the spawn.
              </p>
            </div>

            <div className="pause-quality" role="group" aria-label="Chase camera style">
              <span className="pause-quality-head"><Camera size={15} strokeWidth={1.8} /> Camera</span>
              {FLIGHT_CAMERA_STYLE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`pause-key is-quality ${option.id === cameraStyle ? 'is-on' : ''}`}
                  aria-pressed={option.id === cameraStyle}
                  onClick={() => onChooseCameraStyle(option.id)}
                >
                  <span>{option.label}</span>
                  <i aria-hidden="true">{option.detail}</i>
                </button>
              ))}
              <p className="pause-note">
                Action holds the entry shot after PSM, then arcs behind the aircraft when
                you press W.
              </p>
            </div>

            <div className="pause-quality" role="group" aria-label="Chase camera distance">
              <span className="pause-quality-head"><Camera size={15} strokeWidth={1.8} /> Chase distance</span>
              {FLIGHT_CAMERA_DISTANCE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`pause-key is-quality ${option.id === cameraDistance ? 'is-on' : ''}`}
                  aria-pressed={option.id === cameraDistance}
                  onClick={() => onChooseCameraDistance(option.id)}
                >
                  <span>{option.label}</span>
                  <i aria-hidden="true">{option.detail}</i>
                </button>
              ))}
            </div>

            <div className="pause-quality" role="group" aria-label="Flight controls">
              <span className="pause-quality-head">
                <MousePointer2 size={15} strokeWidth={1.8} /> Control
              </span>
              <button
                type="button"
                className={`pause-key is-quality ${mouseFlightEnabled ? 'is-on' : ''}`}
                aria-pressed={mouseFlightEnabled}
                onClick={() => onChooseMouseFlightEnabled(!mouseFlightEnabled)}
              >
                <span>Mouse flies the stick</span>
                <i aria-hidden="true">{mouseFlightEnabled ? 'ON' : 'OFF'}</i>
              </button>
              <button
                type="button"
                className={`pause-key is-quality ${mousePitchInverted ? 'is-on' : ''}`}
                aria-pressed={mousePitchInverted}
                disabled={!mouseFlightEnabled}
                onClick={() => onChooseMousePitchInverted(!mousePitchInverted)}
              >
                <span>Invert pitch direction</span>
                <i aria-hidden="true">{mousePitchInverted ? 'ON' : 'OFF'}</i>
              </button>

              {/* A slider rather than named steps: it sets how much of the screen a full
                  deflection takes, and the right number depends on the pilot's display and
                  how close they sit. The multiplier is shown because it is what they choose;
                  turning it up shrinks the gate, so less pointer travel is full stick. */}
              <label className="pause-slider">
                <span>
                  Mouse sensitivity
                  <i aria-hidden="true">{mouseSensitivity.toFixed(2)}×</i>
                </span>
                <input
                  type="range"
                  min={MOUSE_SENSITIVITY_RANGE.min}
                  max={MOUSE_SENSITIVITY_RANGE.max}
                  step={MOUSE_SENSITIVITY_RANGE.step}
                  value={mouseSensitivity}
                  disabled={!mouseFlightEnabled}
                  aria-label="Mouse sensitivity multiplier"
                  onChange={(event) => onChooseMouseSensitivity(Number(event.currentTarget.value))}
                />
              </label>
              <p className="pause-note">
                {mouseFlightEnabled
                  ? 'Click the sky to take the stick: the mouse then moves inside the canvas only, left and right rolls, up and down pitches, and the middle is neutral. Right-hold looks around. Esc gives the cursor back and opens this menu.'
                  : 'Pitch and roll remain on the arrow keys. The pointer only ever moves the camera.'}
              </p>
            </div>

            <button type="button" className="pause-key" onClick={onFullscreen}>
              <Maximize size={17} strokeWidth={1.8} />
              <span>Toggle fullscreen</span>
            </button>
            <button
              type="button"
              className={`pause-key ${debug ? 'is-on' : ''}`}
              aria-pressed={debug}
              onClick={onToggleDebug}
            >
              <Gauge size={17} strokeWidth={1.8} />
              <span>Flight debug readout</span>
              <i aria-hidden="true">{debug ? 'ON' : 'OFF'}</i>
            </button>
            <p className="pause-note">Debug also toggles from the cockpit with <kbd>I</kbd>.</p>
            <button type="button" className="pause-back" onClick={() => setPane('root')}>Back</button>
          </div>
        )}

        {pane === 'credits' && (
          <div className="pause-pane">
            <h2 className="pause-pane-title">Game credits</h2>
            <dl className="pause-credits">
              {CREDITS.map(({ role, detail }) => (
                <div key={role}>
                  <dt>{role}</dt>
                  <dd>{detail}</dd>
                </div>
              ))}
            </dl>
            <button type="button" className="pause-back" onClick={() => setPane('root')}>Back</button>
          </div>
        )}

        <p className="pause-hint">
          <kbd>ESC</kbd><kbd>P</kbd> {pane === 'root' ? 'resume flight' : 'back'}
        </p>
      </div>
    </div>
  )
}
