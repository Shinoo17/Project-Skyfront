import {
  ALTITUDE_UNIT_OPTIONS,
  SPEED_UNIT_OPTIONS,
} from '../../units'
import { Row, Segmented } from '../PanelControls'

export default function GameplayTab({ settings, onChange, onFullscreen, metresPerUnit }) {
  return (
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
  )
}
