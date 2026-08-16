/*
What the pilot chose, and where it is kept between sessions.

Storage is separated from the rig on purpose: the pause menu needs the option lists and the
read/write pair without pulling in a camera it is not going to move, and the rig needs the
numbers without knowing they came out of `localStorage`. Every reader falls back to a
working default, because storage can be unavailable in privacy modes and a camera that
refuses to exist is worse than a camera on its authored setting.
*/

import { BASE_FOV, CAMERA_DISTANCE_SCALE } from './profiles'
import { CAMERA_ROLL_MODES, DEFAULT_CAMERA_ROLL_MODE } from './roll'

const CAMERA_DISTANCE_KEY = 'f22-flight-camera-distance'
const CAMERA_ROLL_KEY = 'f22-flight-camera-roll'

/*
The bank share, as three positions rather than a slider.

A slider would be the honest representation of what `roll.js` actually reads, and it is the
wrong control anyway: the interesting part of this setting is not the number but which of
three quite different cameras the pilot ends up flying, and a continuum invites hunting for a
value instead of picking one. Hybrid is the authored default because it is the position that
suits the device most people arrive on — a mouse and a keyboard, where a full-bank camera is
the single most common reason somebody puts an arcade flight game down.

None of these labels promise the whole envelope. Post-stall flight gives most of the bank
back whichever position is chosen; see the regime table in `roll.js`.
*/
export const FLIGHT_CAMERA_ROLL_OPTIONS = [
  { id: 'off', label: 'Off', detail: 'Horizon holds; the airframe rolls in frame' },
  { id: 'hybrid', label: 'Hybrid', detail: '25% of bank, clamped to 15°' },
  { id: 'on', label: 'On', detail: 'Camera rides the full bank' },
]

export const FLIGHT_CAMERA_DISTANCE_OPTIONS = [
  { id: 'near', label: 'Near', detail: '75% chase distance' },
  { id: 'normal', label: 'Normal', detail: 'Current chase distance' },
  { id: 'far', label: 'Far', detail: '140% chase distance' },
]

/*
The pilot's lens, as a trim on the authored one rather than as a replacement for it.

The authored lens is stretched by speed, pinched by braking, and pushed out under load and
reheat. Handing the setting the absolute number would throw all of that away and leave a
camera that no longer reacts to anything. So the setting is read as a difference from
`BASE_FOV` and added to the authored base, and every dynamic modifier still lands on top of
whatever the pilot chose.

Nose view is left alone. Its 58° is the view out of the cockpit at the frame the aircraft
really presents, and a chase-camera preference has nothing to say about it.
*/
export const FLIGHT_FOV_RANGE = { min: 60, max: 100, step: 1, default: BASE_FOV }
const CAMERA_FOV_KEY = 'f22-flight-camera-fov'

export function clampFlightFov(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return FLIGHT_FOV_RANGE.default
  return Math.min(FLIGHT_FOV_RANGE.max, Math.max(FLIGHT_FOV_RANGE.min, Math.round(number)))
}

export function readFlightFov() {
  try {
    const stored = window.localStorage.getItem(CAMERA_FOV_KEY)
    return stored === null ? FLIGHT_FOV_RANGE.default : clampFlightFov(stored)
  } catch {
    return FLIGHT_FOV_RANGE.default
  }
}

export function writeFlightFov(value) {
  try {
    window.localStorage.setItem(CAMERA_FOV_KEY, String(clampFlightFov(value)))
  } catch {
    // Storage can be unavailable in privacy modes; the in-session choice still works.
  }
}

export function readFlightCameraRoll() {
  try {
    const saved = window.localStorage.getItem(CAMERA_ROLL_KEY)
    return CAMERA_ROLL_MODES[saved] ? saved : DEFAULT_CAMERA_ROLL_MODE
  } catch {
    return DEFAULT_CAMERA_ROLL_MODE
  }
}

export function writeFlightCameraRoll(value) {
  if (!CAMERA_ROLL_MODES[value]) return
  try {
    window.localStorage.setItem(CAMERA_ROLL_KEY, value)
  } catch {
    // Storage can be unavailable in privacy modes; the in-session choice still works.
  }
}

export function readFlightCameraDistance() {
  try {
    const saved = window.localStorage.getItem(CAMERA_DISTANCE_KEY)
    return CAMERA_DISTANCE_SCALE[saved] ? saved : 'normal'
  } catch {
    return 'normal'
  }
}

export function writeFlightCameraDistance(value) {
  if (!CAMERA_DISTANCE_SCALE[value]) return
  try {
    window.localStorage.setItem(CAMERA_DISTANCE_KEY, value)
  } catch {
    // Storage can be unavailable in privacy modes; the in-session choice still works.
  }
}
