import { MASTER_VOLUME_RANGE } from '../../audio'
import { Row, Slider } from '../PanelControls'

export default function AudioTab({ settings, onChange }) {
  return (
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
  )
}
