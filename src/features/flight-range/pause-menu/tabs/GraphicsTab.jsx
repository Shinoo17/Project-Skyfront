import { useMemo, useState } from 'react'

import {
  FLIGHT_GRAPHICS_FIELDS,
  FLIGHT_QUALITY_OPTIONS,
  describeFlightGraphics,
} from '../../../../three/graphics'
import { Row, Segmented } from '../PanelControls'

const CUSTOM_PRESET = {
  id: 'custom',
  label: 'Custom',
  detail: 'Every field below, set by hand',
  hoverDetail: 'Nothing is authored for you here — every field below is set by hand, '
    + 'starting from whatever the screen is already showing.',
}

// The panel's resting state: what it shows before the pointer has landed on anything.
const IDLE_DETAIL = {
  title: 'Hover a setting',
  body: 'Rest the pointer — or tab to — a preset or a field to see what it changes and '
    + 'what it costs.',
}

export default function GraphicsTab({ settings, onChange }) {
  const [hovered, setHovered] = useState(null)

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

  const detail = hovered ?? IDLE_DETAIL

  return (
    <div className="pause-graphics">
      <div className="pause-rows">
        <div className="pause-presets">
          {[...FLIGHT_QUALITY_OPTIONS, CUSTOM_PRESET].map((option) => (
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
              onMouseEnter={() => setHovered({ title: option.label, body: option.hoverDetail })}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered({ title: option.label, body: option.hoverDetail })}
              onBlur={() => setHovered(null)}
            >
              <strong>{option.label}</strong>
              <i>{option.detail}</i>
            </button>
          ))}
        </div>

        {FLIGHT_GRAPHICS_FIELDS.map((field) => {
          const fieldDetail = { title: field.label, body: field.detail }
          return (
            <Row
              key={field.id}
              label={field.label}
              note={field.restart ? `${field.note} · restarts the sortie` : field.note}
              onMouseEnter={() => setHovered(fieldDetail)}
              onMouseLeave={() => setHovered(null)}
            >
              <Segmented
                label={field.label}
                options={field.options}
                value={graphics[field.id]}
                onChange={(value) => setCustomField(field.id, value)}
                // Leaving one option for the gap between buttons still leaves the pointer
                // inside the row, so it falls back to the row's own detail rather than
                // blanking to the idle prompt until the row itself is left.
                onHover={(option) => setHovered(option
                  ? { title: `${field.label} · ${option.label}`, body: option.detail }
                  : fieldDetail)}
              />
            </Row>
          )
        })}

        <p className="pause-note">
          Moving any field here switches the profile to Custom. Changing {restartNote} rebuilds
          the renderer, which restarts the sortie from the spawn; the frame target
          takes effect on the next frame.
        </p>
      </div>

      <aside className="pause-detail" aria-live="polite">
        <p className="pause-detail-kicker">DETAIL</p>
        <h3>{detail.title}</h3>
        <p>{detail.body}</p>
      </aside>
    </div>
  )
}
