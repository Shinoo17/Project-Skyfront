import { MOUSE_SENSITIVITY_RANGE } from '../../../flight/useFlightControls'
import {
  FIXED_MOUSE_ROWS,
  FLIGHT_CONTROL_GROUPS,
  describeKey,
} from '../../../flight/keybindings'
import KeyCap from '../KeyCap'
import { Row, Segmented, Slider } from '../PanelControls'

export default function ControlsTab({
  settings,
  onChange,
  onUnbindKey,
  binding,
  setBinding,
}) {
  return (
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
  )
}
