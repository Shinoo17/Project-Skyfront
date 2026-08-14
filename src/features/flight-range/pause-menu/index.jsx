/*
THESIS: The sortie has no chrome at all until it stops, and then it has all of it — one full screen that owns the frozen frame rather than a dialog floating over it.
OWN-WORLD: The HUD's own phosphor on a darkened canopy: bracketed corners, one command column, and a settings panel built out of hairlines instead of cards.
STORY: Esc stops the world; the pilot picks a command, tunes the sortie across five tabs, and Esc puts them back in the seat.
FIRST VIEWPORT: A dimmed frozen frame under a lit frame — identity and frozen telemetry along the top, four commands down the left, the panel filling the rest, key legend along the floor.
FORM: This file owns the frame — the views, the keyboard, and which pane is showing. Each settings tab is its own file in `tabs/`, built out of the shared rows in `PanelControls`, so a tab can be read without reading the screen around it.

Every number this screen shows comes from somewhere real: the frozen telemetry is the last
frame the sortie drew, the airframe identity is the aircraft module's, and the credits list
only what the repository can actually prove it ships. Nothing here invents a mission, a
squadron, a build number or a name.
*/

import { useCallback, useEffect, useRef, useState } from 'react'

import { RESERVED_CODES } from '../../flight/keybindings'
import {
  getAltitudeUnit,
  getSpeedUnit,
  metresPerWorldUnit,
} from '../units'
import { COMMANDS, CREDITS, TABS, VIEW_TITLES } from './menuData'
import AudioTab from './tabs/AudioTab'
import CameraTab from './tabs/CameraTab'
import ControlsTab from './tabs/ControlsTab'
import GameplayTab from './tabs/GameplayTab'
import GraphicsTab from './tabs/GraphicsTab'

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

  if (!open) return null

  const [kicker, title] = VIEW_TITLES[view]

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
              <GameplayTab
                settings={settings}
                onChange={onChange}
                onFullscreen={onFullscreen}
                metresPerUnit={metresPerUnit}
              />
            )}

            {view === 'settings' && tab === 'controls' && (
              <ControlsTab
                settings={settings}
                onChange={onChange}
                onUnbindKey={onUnbindKey}
                binding={binding}
                setBinding={setBinding}
              />
            )}

            {view === 'settings' && tab === 'graphics' && (
              <GraphicsTab settings={settings} onChange={onChange} />
            )}

            {view === 'settings' && tab === 'camera' && (
              <CameraTab settings={settings} onChange={onChange} />
            )}

            {view === 'settings' && tab === 'audio' && (
              <AudioTab settings={settings} onChange={onChange} />
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
