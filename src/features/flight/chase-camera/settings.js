/*
What the pilot chose, and where it is kept between sessions.

Storage is separated from the rig on purpose: the pause menu needs the option lists and the
read/write pair without pulling in a camera it is not going to move, and the rig needs the
numbers without knowing they came out of `localStorage`. Every reader falls back to a
working default, because storage can be unavailable in privacy modes and a camera that
refuses to exist is worse than a camera on its authored setting.
*/

import { BASE_FOV, CAMERA_DISTANCE_SCALE, CAMERA_STYLES } from './profiles'

const CAMERA_STYLE_KEY = 'f22-flight-camera-style'
const CAMERA_DISTANCE_KEY = 'f22-flight-camera-distance'

export const FLIGHT_CAMERA_STYLE_OPTIONS = [
  {
    id: 'combat',
    label: 'Combat Chase',
    detail: '70° lens · sprung nose + velocity follow',
  },
  {
    id: 'action',
    label: 'Action',
    detail: 'Close 69° lens · inertial PSM framing',
  },
]

export const FLIGHT_CAMERA_DISTANCE_OPTIONS = [
  { id: 'near', label: 'Near', detail: '75% chase distance' },
  { id: 'normal', label: 'Normal', detail: 'Current chase distance' },
  { id: 'far', label: 'Far', detail: '140% chase distance' },
]

/*
The pilot's lens, as a trim on the authored one rather than as a replacement for it.

Each style carries its own base — 70° for Combat Chase, 69° for Action — and both are then
stretched by speed, pinched by braking, and pushed out under load and reheat. Handing the
setting the absolute number would throw all of that away and leave two styles that look
identical. So the setting is read as a difference from `BASE_FOV` and added to whichever
base is in force: Action stays the tighter of the two at every position of the control, and
every dynamic modifier still lands on top.

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

export function readFlightCameraStyle() {
  try {
    const saved = window.localStorage.getItem(CAMERA_STYLE_KEY)
    // `normal` was the pre-Combat-Chase id. Preserve the user's stable-camera choice
    // across the rename instead of silently moving them to Action.
    if (saved === 'normal') return 'combat'
    return CAMERA_STYLES[saved] ? saved : 'combat'
  } catch {
    return 'combat'
  }
}

export function writeFlightCameraStyle(value) {
  if (!CAMERA_STYLES[value]) return
  try {
    window.localStorage.setItem(CAMERA_STYLE_KEY, value)
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
