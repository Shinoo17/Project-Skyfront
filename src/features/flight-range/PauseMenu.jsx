/*
THESIS: The sortie has no chrome at all until it stops, and then it has all of it — one full screen that owns the frozen frame rather than a dialog floating over it.
OWN-WORLD: The HUD's own phosphor on a darkened canopy: bracketed corners, one command column, and a settings panel built out of hairlines instead of cards.
STORY: Esc stops the world; the pilot picks a command, tunes the sortie across five tabs, and Esc puts them back in the seat.
FIRST VIEWPORT: A dimmed frozen frame under a lit frame — identity and frozen telemetry along the top, four commands down the left, the panel filling the rest, key legend along the floor.
FORM: One component owning its own views and panes, so the route only says whether flight is paused and what the settings currently are.

Every number this screen shows comes from somewhere real: the frozen telemetry is the last
frame the sortie drew, the airframe identity is the aircraft module's, and the credits list
only what the repository can actually prove it ships. Nothing here invents a mission, a
squadron, a build number or a name.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  FLIGHT_GRAPHICS_FIELDS,
  FLIGHT_QUALITY_OPTIONS,
  describeFlightGraphics,
} from '../../three/graphics'
import { MOUSE_SENSITIVITY_RANGE } from '../flight/useFlightControls'
import {
  FLIGHT_CAMERA_DISTANCE_OPTIONS,
  FLIGHT_CAMERA_STYLE_OPTIONS,
  FLIGHT_FOV_RANGE,
} from '../flight/chaseCamera'
import {
  FIXED_MOUSE_ROWS,
  FLIGHT_CONTROL_GROUPS,
  RESERVED_CODES,
  describeKey,
} from '../flight/keybindings'
import { MASTER_VOLUME_RANGE } from './audio'
import KeyCap from './KeyCap'
import {
  ALTITUDE_UNIT_OPTIONS,
  SPEED_UNIT_OPTIONS,
  getAltitudeUnit,
  getSpeedUnit,
  metresPerWorldUnit,
} from './units'

// Credit only what the repository can actually prove: the assets it ships and the libraries
// it builds on. No names or licences are invented here — an attribution nobody supplied is
// worse than a short panel.
const CREDITS = [
  { role: 'Engine', detail: 'React · Three.js · @react-three/fiber · @react-three/drei' },
  { role: 'Interface', detail: 'Vite · lucide-react · hand-drawn canvas HUD' },
  { role: 'Flight model', detail: '6-DOF-lite simulation written for this project' },
  { role: 'Input prompts', detail: 'Keyboard and mouse prompt set shipped in this repository' },
]

const COMMANDS = [
  { id: 'resume', label: 'Resume', sub: 'Back to the seat · ESC' },
  { id: 'settings', label: 'Settings', sub: 'Gameplay · control · graphics · camera · audio' },
  { id: 'credits', label: 'Game credits', sub: 'What this is built out of' },
  { id: 'exit', label: 'Back to main', sub: 'Leave the range for the hangar' },
]

const TABS = [
  { id: 'gameplay', label: 'GAMEPLAY' },
  { id: 'controls', label: 'CONTROLS' },
  { id: 'graphics', label: 'GRAPHICS' },
  { id: 'camera', label: 'CAMERA' },
  { id: 'audio', label: 'AUDIO' },
]

const VIEW_TITLES = {
  root: ['SORTIE PAUSED', 'Standing by'],
  settings: ['SETTINGS', 'Tune the sortie'],
  credits: ['GAME CREDITS', 'Built out of'],
}

// One row of the settings panel: what it is on the left, the control on the right. Every
// tab is made of these, which is what stops five different screens from becoming five
// different layouts.
function Row({ label, note, children }) {
  return (
    <div className="pause-row">
      <div className="pause-row-name">
        <span>{label}</span>
        {note && <i>{note}</i>}
      </div>
      <div className="pause-row-control">{children}</div>
    </div>
  )
}

/*
The segmented control the whole screen is built on. The latched option is filled rather than
merely outlined: which one is in force has to be readable without comparison.

An option that switches something *off* is filled in fog white rather than phosphor. Green
is the live signal on this interface — it means the system is running — so a latched OFF
glowing the same green as a latched ON would say the opposite of what it means.
*/
function Segmented({ options, value, onChange, label, disabled = false }) {
  return (
    <div className="pause-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`pause-seg ${option.id === value ? 'is-on' : ''} ${option.id === 'off' ? 'is-negative' : ''}`}
          aria-pressed={option.id === value}
          disabled={disabled}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Slider({ label, value, min, max, step, text, onChange, disabled = false }) {
  return (
    <div className="pause-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <output>{text}</output>
    </div>
  )
}

export default function PauseMenu({
  open,
  aircraft,
  map,
  telemetry,
  settings,
  onChange,
  onBindKey,
  onUnbindKey,
  onResetKeyBindings,
  onResume,
  onExit,
  onFullscreen,
}) {
  const [view, setView] = useState('root')
  const [tab, setTab] = useState('gameplay')
  const [selected, setSelected] = useState(0)
  // Which slot is listening for a key, as `action:slot`. Null the rest of the time, and the
  // keyboard handler branches on it before it does anything else.
  const [binding, setBinding] = useState(null)
  // The last frame the sortie drew, taken once when the world stops. Read live it would be
  // a readout of a simulation that is not running; taken at the pause it is what the pilot
  // was looking at when they hit Esc, which is the only honest thing to show.
  const [frozen, setFrozen] = useState(null)
  const firstCommand = useRef(null)

  const speedScale = getSpeedUnit(settings.speedUnit)
  const altitudeScale = getAltitudeUnit(settings.altitudeUnit)
  const metresPerUnit = metresPerWorldUnit(aircraft?.flight?.envelope)

  useEffect(() => {
    if (!open) return
    setView('root')
    setSelected(0)
    setBinding(null)
    const value = telemetry?.current
    setFrozen(value?.live
      ? { speed: value.speed, altitude: value.altitude, mach: value.mach, fps: value.fps }
      : null)
  }, [open, telemetry])

  // Focus follows the top view rather than the opening: stepping back from settings lands
  // here too, and that is where the keyboard should be.
  useEffect(() => {
    if (open && view === 'root') firstCommand.current?.focus()
  }, [open, view])

  const activate = useCallback((id) => {
    if (id === 'resume') return onResume()
    if (id === 'exit') return onExit()
    return setView(id)
  }, [onExit, onResume])

  /*
  One keyboard, and the order of its questions is the whole behaviour.

  A slot that is listening asks first and answers everything: any key it is handed becomes
  the binding, Escape cancels the listen rather than leaving the menu, and a reserved code
  is refused without ending the listen so the pilot can simply press something else. It runs
  in the capture phase because a focused button would otherwise take Space and Enter as a
  click before this is ever asked.

  With nothing listening, Escape steps back one level and resumes at the top, and the arrows
  walk the command column — but only at the top, or they would fight the sliders inside a
  settings tab for the same keys.

  Anything this handler acts on is consumed outright, propagation included. The sortie's own
  Escape handler is bound to the same window and would otherwise run straight after the one
  that resumed — reading a flag this handler has already cleared, and pausing the sortie back
  into the menu on the very keystroke that left it.
  */
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      const consume = () => {
        event.preventDefault()
        event.stopImmediatePropagation()
      }

      if (binding) {
        consume()
        if (event.code === 'Escape') return setBinding(null)
        if (RESERVED_CODES.has(event.code)) return undefined
        const [action, slot] = binding.split(':')
        onBindKey(action, Number(slot), event.code)
        return setBinding(null)
      }

      // P is the fullscreen escape hatch: a fullscreen browser keeps Esc for itself and
      // never delivers the keydown, so the menu would be unreachable with one key only.
      if (event.code === 'Escape' || event.code === 'KeyP') {
        consume()
        if (view === 'root') onResume()
        else setView('root')
        return undefined
      }

      if (view !== 'root') return undefined
      if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
        consume()
        const step = event.code === 'ArrowDown' ? 1 : -1
        setSelected((index) => (index + step + COMMANDS.length) % COMMANDS.length)
        return undefined
      }
      if (event.code === 'Enter') {
        consume()
        activate(COMMANDS[selected].id)
      }
      return undefined
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activate, binding, onBindKey, onResume, open, selected, view])

  const graphicsRestartNote = useMemo(() => FLIGHT_GRAPHICS_FIELDS
    .filter((field) => field.restart)
    .map((field) => field.label.toLowerCase())
    .join(', '), [])

  if (!open) return null

  // What the graphics fields are showing: the stored custom set when Custom is in force,
  // and otherwise the preset's own values read back off its profile — so the fields always
  // describe the sortie the pilot is looking at rather than a set they have not chosen.
  const graphics = describeFlightGraphics(settings.quality, settings.customGraphics)
  const [kicker, title] = VIEW_TITLES[view]

  const setCustomField = (id, value) => {
    onChange('customGraphics', { ...graphics, [id]: value })
    // Moving a knob is what makes a profile custom. Doing it the other way round — making
    // the pilot pick Custom before the knobs come alive — is a click that says nothing.
    if (settings.quality !== 'custom') onChange('quality', 'custom')
  }

  const frozenReadouts = [
    ['FPS', frozen?.fps ? String(frozen.fps) : '–'],
    ['SPD', frozen ? `${Math.round(speedScale.fromKmh(frozen.speed))} ${speedScale.label}` : '–'],
    ['ALT', frozen
      ? `${Math.round(metresPerUnit
        ? altitudeScale.fromMetres(frozen.altitude * metresPerUnit)
        : frozen.altitude)} ${metresPerUnit ? altitudeScale.label : 'u'}`
      : '–'],
    ['MACH', frozen ? frozen.mach.toFixed(2) : '–'],
  ]

  return (
    <div className="pause-menu" role="dialog" aria-modal="true" aria-label="Flight paused">
      <div className="pause-brackets" aria-hidden="true">
        <i /><i /><i /><i />
      </div>

      <header className="pause-topbar">
        <div className="pause-identity">
          <span className="pause-diamond" aria-hidden="true" />
          <strong>{aircraft?.displayName ?? 'F-22 Raptor'}</strong>
          <span className="pause-rule" aria-hidden="true" />
          <span className="pause-state"><i aria-hidden="true" />PAUSED</span>
        </div>
        <p className="pause-place">{map ? `${map.name} · ${map.region}` : 'Flight range'}</p>
        <dl className="pause-frozen" aria-label="Telemetry at the moment of pausing">
          {frozenReadouts.map(([key, value]) => (
            <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      </header>

      <div className="pause-body">
        <nav className="pause-commands" aria-label="Pause menu">
          <p className="pause-column-head">MAIN MENU</p>
          {COMMANDS.map((command, index) => (
            <button
              key={command.id}
              type="button"
              ref={index === 0 ? firstCommand : null}
              className={`pause-command ${index === selected ? 'is-selected' : ''}`}
              onMouseEnter={() => setSelected(index)}
              onFocus={() => setSelected(index)}
              onClick={() => activate(command.id)}
            >
              <span className="pause-diamond" aria-hidden="true" />
              <span className="pause-command-name">
                <strong>{command.label}</strong>
                <i>{command.sub}</i>
              </span>
              <span className="pause-command-index" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
            </button>
          ))}
        </nav>

        <section className="pause-panel" aria-label={title}>
          <header className="pause-panel-head">
            <div>
              <p className="pause-kicker">{kicker}</p>
              <h2>{title}</h2>
            </div>
            {view === 'settings' && tab === 'controls' && (
              <button type="button" className="pause-ghost" onClick={onResetKeyBindings}>
                Reset to defaults
              </button>
            )}
          </header>

          {view === 'settings' && (
            <div className="pause-tabs" role="tablist" aria-label="Settings sections">
              {TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={entry.id === tab}
                  className={`pause-tab ${entry.id === tab ? 'is-on' : ''}`}
                  onClick={() => { setTab(entry.id); setBinding(null) }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          )}

          <div className="pause-panel-body">
            {view === 'root' && (
              <div className="pause-standby">
                <p className="pause-lede">
                  The world is stopped where you left it — the physics, the camera and the
                  frame on the glass behind this. Resume puts the pointer back in the sky and
                  starts the clock from the same frame.
                </p>
                <dl className="pause-facts">
                  <div><dt>Airframe</dt><dd>{aircraft?.displayName ?? '–'}</dd></div>
                  <div><dt>Range</dt><dd>{map ? `${map.name} · ${map.region}` : '–'}</dd></div>
                  <div>
                    <dt>Reading in</dt>
                    <dd>{speedScale.label} · {metresPerUnit ? altitudeScale.label : 'world units'}</dd>
                  </div>
                </dl>
              </div>
            )}

            {view === 'credits' && (
              <dl className="pause-credits">
                {CREDITS.map(({ role, detail }) => (
                  <div key={role}>
                    <dt>{role}</dt>
                    <dd>{detail}</dd>
                  </div>
                ))}
              </dl>
            )}

            {view === 'settings' && tab === 'gameplay' && (
              <div className="pause-rows">
                <Row label="Speed" note="The left tape and its ladder">
                  <Segmented
                    label="Speed unit"
                    options={SPEED_UNIT_OPTIONS}
                    value={settings.speedUnit}
                    onChange={(value) => onChange('speedUnit', value)}
                  />
                </Row>
                <Row
                  label="Altitude"
                  note={metresPerUnit
                    ? `The right tape · one world unit is ${metresPerUnit.toFixed(1)} m`
                    : 'This airframe declares no scale — the tape stays in world units'}
                >
                  <Segmented
                    label="Altitude unit"
                    options={ALTITUDE_UNIT_OPTIONS}
                    value={settings.altitudeUnit}
                    disabled={!metresPerUnit}
                    onChange={(value) => onChange('altitudeUnit', value)}
                  />
                </Row>
                <Row label="Flight debug readout" note="Also on I from the cockpit">
                  <Segmented
                    label="Flight debug readout"
                    options={[{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]}
                    value={settings.debug ? 'on' : 'off'}
                    onChange={(value) => onChange('debug', value === 'on')}
                  />
                </Row>
                <Row label="Fullscreen" note="The range fills the display">
                  <button type="button" className="pause-ghost" onClick={onFullscreen}>
                    Toggle fullscreen
                  </button>
                </Row>
                <p className="pause-note">
                  Flight level is hundreds of feet, three digits — FL120 is twelve thousand feet.
                </p>
              </div>
            )}

            {view === 'settings' && tab === 'controls' && (
              <div className="pause-controls">
                <div className="pause-binds">
                  <p className="pause-group-head"><span>MOUSE</span></p>
                  {FIXED_MOUSE_ROWS.map((row) => (
                    <div className="pause-bind" key={row.label}>
                      <div className="pause-row-name">
                        <span>{row.label}</span>
                        <i>{row.note}</i>
                      </div>
                      <div className="pause-bind-keys">
                        <span className="pause-cap is-fixed">
                          <KeyCap icon={row.icon} label={row.label} title={row.label} />
                        </span>
                      </div>
                    </div>
                  ))}
                  <p className="pause-note">
                    The mouse buttons are not rebindable: the left click is what hands the
                    pointer to the sky and the right drag is free look, and both belong to the
                    canvas rather than to this map.
                  </p>
                </div>

                {FLIGHT_CONTROL_GROUPS.map((group) => (
                  <div className="pause-binds" key={group.id}>
                    <p className="pause-group-head"><span>{group.title}</span></p>
                    {group.rows.map((row) => (
                      <div className="pause-bind" key={row.action}>
                        <div className="pause-row-name">
                          <span>{row.label}</span>
                          <i>{row.note}</i>
                        </div>
                        <div className="pause-bind-keys">
                          {[0, 1].map((slot) => {
                            const code = settings.keyBindings[row.action]?.[slot] ?? null
                            const listening = binding === `${row.action}:${slot}`
                            const described = code ? describeKey(code) : null
                            return (
                              <button
                                key={slot}
                                type="button"
                                className={`pause-cap ${listening ? 'is-listening' : ''} ${code ? '' : 'is-empty'}`}
                                aria-label={`${row.label}, ${slot === 0 ? 'primary' : 'alternate'} key: ${described?.label ?? 'unbound'}`}
                                onClick={() => setBinding(listening ? null : `${row.action}:${slot}`)}
                                onContextMenu={(event) => {
                                  event.preventDefault()
                                  onUnbindKey(row.action, slot)
                                }}
                              >
                                {listening
                                  ? <em>PRESS…</em>
                                  : code
                                    ? <><KeyCap code={code} /><em>{described.label}</em></>
                                    : <em>—</em>}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}

                <div className="pause-rows">
                  <p className="pause-group-head"><span>MOUSE STICK</span></p>
                  <Row label="Mouse flies the stick" note="Click the sky to take it">
                    <Segmented
                      label="Mouse flies the stick"
                      options={[{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]}
                      value={settings.mouseFlightEnabled ? 'on' : 'off'}
                      onChange={(value) => onChange('mouseFlightEnabled', value === 'on')}
                    />
                  </Row>
                  <Row label="Invert pitch" note="Pull back to climb">
                    <Segmented
                      label="Invert pitch"
                      options={[{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]}
                      value={settings.mousePitchInverted ? 'on' : 'off'}
                      disabled={!settings.mouseFlightEnabled}
                      onChange={(value) => onChange('mousePitchInverted', value === 'on')}
                    />
                  </Row>
                  {/* A slider rather than named steps: it sets how much of the screen a full
                      deflection takes, and the right number depends on the pilot's display and
                      how close they sit. Turning it up shrinks the gate, so less pointer
                      travel is full stick. */}
                  <Row label="Mouse sensitivity" note="How much screen a full deflection takes">
                    <Slider
                      label="Mouse sensitivity multiplier"
                      value={settings.mouseSensitivity}
                      min={MOUSE_SENSITIVITY_RANGE.min}
                      max={MOUSE_SENSITIVITY_RANGE.max}
                      step={MOUSE_SENSITIVITY_RANGE.step}
                      text={`${settings.mouseSensitivity.toFixed(2)}×`}
                      disabled={!settings.mouseFlightEnabled}
                      onChange={(value) => onChange('mouseSensitivity', value)}
                    />
                  </Row>
                </div>

                <p className="pause-note">
                  Click a key to listen, then press the one you want — it is taken off
                  whatever else was holding it. Right-click a key to clear it. Escape,
                  <kbd>P</kbd>, <kbd>R</kbd>, <kbd>I</kbd> and <kbd>C</kbd> belong to the
                  menu, the reset, the debug readout and the camera, and cannot be bound.
                </p>
              </div>
            )}

            {view === 'settings' && tab === 'graphics' && (
              <div className="pause-rows">
                <div className="pause-presets">
                  {[...FLIGHT_QUALITY_OPTIONS, {
                    id: 'custom',
                    label: 'Custom',
                    detail: 'Every field below, set by hand',
                  }].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`pause-preset ${option.id === settings.quality ? 'is-on' : ''}`}
                      aria-pressed={option.id === settings.quality}
                      onClick={() => {
                        // Custom starts from whatever is on screen. Landing the pilot on a
                        // set they saved three sessions ago would move fields they never
                        // touched, with nothing on the card to say why.
                        if (option.id === 'custom') onChange('customGraphics', graphics)
                        onChange('quality', option.id)
                      }}
                    >
                      <strong>{option.label}</strong>
                      <i>{option.detail}</i>
                    </button>
                  ))}
                </div>

                {FLIGHT_GRAPHICS_FIELDS.map((field) => (
                  <Row
                    key={field.id}
                    label={field.label}
                    note={field.restart ? `${field.note} · restarts the sortie` : field.note}
                  >
                    <Segmented
                      label={field.label}
                      options={field.options}
                      value={graphics[field.id]}
                      onChange={(value) => setCustomField(field.id, value)}
                    />
                  </Row>
                ))}

                <p className="pause-note">
                  Moving any field here switches the profile to Custom. Changing {graphicsRestartNote} rebuilds
                  the renderer, which restarts the sortie from the spawn; the frame target
                  takes effect on the next frame.
                </p>
              </div>
            )}

            {view === 'settings' && tab === 'camera' && (
              <div className="pause-rows">
                <Row label="Camera mode" note="What the chase rig follows">
                  <Segmented
                    label="Camera mode"
                    options={FLIGHT_CAMERA_STYLE_OPTIONS}
                    value={settings.cameraStyle}
                    onChange={(value) => onChange('cameraStyle', value)}
                  />
                </Row>
                <Row label="Chase distance" note="How far back the boom sits">
                  <Segmented
                    label="Chase distance"
                    options={FLIGHT_CAMERA_DISTANCE_OPTIONS}
                    value={settings.cameraDistance}
                    onChange={(value) => onChange('cameraDistance', value)}
                  />
                </Row>
                <Row label="Field of view" note="Trims the lens; speed and load still move it">
                  <Slider
                    label="Field of view"
                    value={settings.cameraFov}
                    min={FLIGHT_FOV_RANGE.min}
                    max={FLIGHT_FOV_RANGE.max}
                    step={FLIGHT_FOV_RANGE.step}
                    text={`${settings.cameraFov}°`}
                    onChange={(value) => onChange('cameraFov', value)}
                  />
                </Row>
                <p className="pause-note">
                  {FLIGHT_CAMERA_STYLE_OPTIONS.find((o) => o.id === settings.cameraStyle)?.detail}
                  {' · '}
                  The nose view keeps its own lens: it is the view out of the cockpit, and a
                  chase preference has nothing to say about it. <kbd>C</kbd> switches between them.
                </p>
              </div>
            )}

            {view === 'settings' && tab === 'audio' && (
              <div className="pause-rows">
                <Row label="Master volume" note="Stored now, for when there is something to hear">
                  <Slider
                    label="Master volume"
                    value={settings.masterVolume}
                    min={MASTER_VOLUME_RANGE.min}
                    max={MASTER_VOLUME_RANGE.max}
                    step={MASTER_VOLUME_RANGE.step}
                    text={`${settings.masterVolume}%`}
                    onChange={(value) => onChange('masterVolume', value)}
                  />
                </Row>
                <p className="pause-note">
                  The sortie has no audio yet — no engine, no reheat, no warning tones. This
                  control is here because the setting is worth keeping across sessions, not
                  because it is turning anything down. It will when there is.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className="pause-legend">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>ENTER</kbd> select</span>
        <span><kbd>ESC</kbd><kbd>P</kbd> {view === 'root' ? 'resume flight' : 'back'}</span>
        <em>{binding ? 'Listening for a key — Escape cancels' : 'Settings are remembered on this machine'}</em>
      </footer>
    </div>
  )
}
