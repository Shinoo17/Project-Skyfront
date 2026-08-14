import { useMemo } from 'react'

import {
  FLIGHT_GRAPHICS_FIELDS,
  FLIGHT_QUALITY_OPTIONS,
  describeFlightGraphics,
} from '../../../../three/graphics'
import { Row, Segmented } from '../PanelControls'

export default function GraphicsTab({ settings, onChange }) {
  const restartNote = useMemo(() => FLIGHT_GRAPHICS_FIELDS
    .filter((field) => field.restart)
    .map((field) => field.label.toLowerCase())
    .join(', '), [])

  // What the graphics fields are showing: the stored custom set when Custom is in force,
  // and otherwise the preset's own values read back off its profile — so the fields always
  // describe the sortie the pilot is looking at rather than a set they have not chosen.
  const graphics = describeFlightGraphics(settings.quality, settings.customGraphics)

  const setCustomField = (id, value) => {
    onChange('customGraphics', { ...graphics, [id]: value })
    // Moving a knob is what makes a profile custom. Doing it the other way round — making
    // the pilot pick Custom before the knobs come alive — is a click that says nothing.
    if (settings.quality !== 'custom') onChange('quality', 'custom')
  }

  return (
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
        Moving any field here switches the profile to Custom. Changing {restartNote} rebuilds
        the renderer, which restarts the sortie from the spawn; the frame target
        takes effect on the next frame.
      </p>
    </div>
  )
}
