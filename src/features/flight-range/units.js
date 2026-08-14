/*
The units the pilot reads the sortie in, and the only place that converts between them.

Airspeed arrives from the flight model already in km/h — it is published from the airframe's
own performance table — so speed is a straight scalar conversion.

Altitude is different, and worth stating plainly. The model integrates position in world
units, and the range's real-world scale is not a decoration: `kmhPerWorldUnitPerSecond` on
the airframe is what ties a world unit per second to a speed in km/h, which fixes one world
unit at a length in metres. That is the factor used here, read off the same envelope the
speed table comes from, rather than a number invented for the menu. Feet and flight levels
are then derived from metres the way they are everywhere else in aviation.

Flight level is hundreds of feet, three digits — FL120 is twelve thousand feet. It is a
label, not a separate measurement, which is why it shares the feet ladder underneath.

Tape geometry travels with the unit. A tape whose ticks are 100 apart in km/h and whose
numbers are simply relabelled as knots is lying about its own scale, so each unit brings the
minor and major tick spacing and the visible span that keep the ladder reading at the same
density it was authored at.
*/

const SPEED_UNIT_KEY = 'f22-flight-speed-unit'
const ALTITUDE_UNIT_KEY = 'f22-flight-altitude-unit'

const KMH_PER_MPH = 1.609344
const KMH_PER_KNOT = 1.852
const FEET_PER_METRE = 3.280839895

export const SPEED_UNIT_OPTIONS = [
  {
    id: 'kmh',
    label: 'km/h',
    tapeLabel: 'SPEED · KM/H',
    detail: 'Kilometres per hour',
    digits: 4,
    fromKmh: (kmh) => kmh,
    tape: { minor: 100, major: 500, span: 1400 },
  },
  {
    id: 'mph',
    label: 'mph',
    tapeLabel: 'SPEED · MPH',
    detail: 'Statute miles per hour',
    digits: 4,
    fromKmh: (kmh) => kmh / KMH_PER_MPH,
    tape: { minor: 50, major: 250, span: 900 },
  },
  {
    id: 'kt',
    label: 'kt',
    tapeLabel: 'SPEED · KNOTS',
    detail: 'Nautical miles per hour',
    digits: 4,
    fromKmh: (kmh) => kmh / KMH_PER_KNOT,
    tape: { minor: 50, major: 250, span: 750 },
  },
]

/*
`fromMetres` and the tape below are in the unit's own scale. Flight level rounds to the
hundred-foot mark by construction — it is feet divided by a hundred — so its ticks are
whole flight levels rather than a rescaled foot ladder.
*/
export const ALTITUDE_UNIT_OPTIONS = [
  {
    id: 'metres',
    label: 'm',
    tapeLabel: 'ALT · M',
    detail: 'Metres above sea level',
    digits: 5,
    fromMetres: (metres) => metres,
    tape: { minor: 100, major: 500, span: 3800 },
  },
  {
    id: 'feet',
    label: 'ft',
    tapeLabel: 'ALT · FT',
    detail: 'Feet above sea level',
    digits: 5,
    fromMetres: (metres) => metres * FEET_PER_METRE,
    tape: { minor: 500, major: 2000, span: 12500 },
  },
  {
    id: 'flightLevel',
    label: 'FL',
    tapeLabel: 'ALT · FL',
    detail: 'Flight level — hundreds of feet',
    digits: 3,
    fromMetres: (metres) => (metres * FEET_PER_METRE) / 100,
    tape: { minor: 5, major: 20, span: 125 },
  },
]

export const DEFAULT_SPEED_UNIT = 'kmh'
export const DEFAULT_ALTITUDE_UNIT = 'metres'

export function getSpeedUnit(id) {
  return SPEED_UNIT_OPTIONS.find((option) => option.id === id) ?? SPEED_UNIT_OPTIONS[0]
}

export function getAltitudeUnit(id) {
  return ALTITUDE_UNIT_OPTIONS.find((option) => option.id === id) ?? ALTITUDE_UNIT_OPTIONS[0]
}

/*
How long one world unit is, in metres, for the airframe currently flying.

A world unit per second is `kmhPerWorldUnitPerSecond` km/h, and a km/h is 1/3.6 m/s, so one
world unit is that figure over 3.6 metres. The F-22's 22 puts it at about 6.11 m. Aircraft
that never declare the figure get no conversion at all rather than a guessed one.
*/
export function metresPerWorldUnit(envelope) {
  const kmh = envelope?.performance?.kmhPerWorldUnitPerSecond
  return Number.isFinite(kmh) && kmh > 0 ? kmh / 3.6 : null
}

export function readSpeedUnit() {
  try {
    const stored = window.localStorage.getItem(SPEED_UNIT_KEY)
    return SPEED_UNIT_OPTIONS.some((option) => option.id === stored) ? stored : DEFAULT_SPEED_UNIT
  } catch {
    return DEFAULT_SPEED_UNIT
  }
}

export function writeSpeedUnit(value) {
  try {
    window.localStorage.setItem(SPEED_UNIT_KEY, value)
  } catch {
    // Storage can be refused; the choice still holds for this session.
  }
}

export function readAltitudeUnit() {
  try {
    const stored = window.localStorage.getItem(ALTITUDE_UNIT_KEY)
    return ALTITUDE_UNIT_OPTIONS.some((option) => option.id === stored)
      ? stored
      : DEFAULT_ALTITUDE_UNIT
  } catch {
    return DEFAULT_ALTITUDE_UNIT
  }
}

export function writeAltitudeUnit(value) {
  try {
    window.localStorage.setItem(ALTITUDE_UNIT_KEY, value)
  } catch {
    // Storage can be refused; the choice still holds for this session.
  }
}
