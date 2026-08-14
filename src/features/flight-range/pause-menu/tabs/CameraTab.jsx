import {
  FLIGHT_CAMERA_DISTANCE_OPTIONS,
  FLIGHT_CAMERA_STYLE_OPTIONS,
  FLIGHT_FOV_RANGE,
} from '../../../flight/chaseCamera'
import { Row, Segmented, Slider } from '../PanelControls'

export default function CameraTab({ settings, onChange }) {
  return (
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
  )
}
