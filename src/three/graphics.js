/*
Every renderer setting a graphics-settings screen owns, in one place.

The three flight profiles are what the pause menu's quality control picks between, and the
knobs that actually cost anything on this scene are the ones they differ in: how many pixels
are drawn (`dpr`), whether those pixels are multisampled (`antialias`), and how many frames
per second are asked for. The flight maps light themselves with a hemisphere and a sun that
casts nothing, so `shadows` and `shadowMapSize` are close to free there and matter to the
studio viewer instead.

targetFps drives the render tick. 0 means the surface renders only when something changes,
which is the hangar. A non-zero target means the surface drives its own frames — see
SyncedFrameLoop, which has to render through `advance` rather than `invalidate` for the
target to be reachable at all.
*/
export const GRAPHICS_PROFILES = {
  // Studio viewer: one aircraft, no terrain, quality is the point.
  studio: {
    dpr: [1, 1.25],
    antialias: true,
    shadows: true,
    shadowMapSize: [1024, 1024],
    environment: true,
    powerPreference: 'default',
    targetFps: 0,
  },

  // Flight range: keep pixel and lighting costs low, but ask the browser for the
  // performant GPU path and follow the display for more responsive controls.
  low: {
    dpr: 1,
    antialias: false,
    shadows: false,
    shadowMapSize: null,
    environment: false,
    powerPreference: 'high-performance',
    targetFps: 30,
  },
  medium: {
    dpr: [1, 1.5],
    antialias: true,
    shadows: true,
    shadowMapSize: [512, 512],
    environment: true,
    powerPreference: 'high-performance',
    targetFps: 60,
  },
  // Deliberately medium's image at twice the frame rate, and nothing else: the only way to
  // read a frame-rate number is to change one thing. Raising dpr here buys sharper pixels
  // and costs frames, so it is a change to make once 120 is known to hold at 1.5x.
  high: {
    dpr: [1, 1.5],
    antialias: true,
    shadows: true,
    shadowMapSize: [512, 512],
    environment: true,
    powerPreference: 'high-performance',
    targetFps: 120,
  },
}

export const DEFAULT_GRAPHICS_PROFILE = 'studio'

// The order the quality control offers them in, with the copy it shows. Cheapest first.
export const FLIGHT_QUALITY_OPTIONS = [
  {
    id: 'low',
    label: 'Low',
    detail: '1x pixels · no AA · 30 fps',
    hoverDetail: 'Native resolution, no anti-aliasing, capped at 30 frames a second. The '
      + 'cheapest profile — pick it if the range is dropping frames on this machine.',
  },
  {
    id: 'medium',
    label: 'Medium',
    detail: '1.5x pixels · AA · 60 fps',
    hoverDetail: '1.5x pixel density with anti-aliasing, capped at 60 frames a second. '
      + 'Matches most displays’ refresh rate at a moderate GPU cost.',
  },
  {
    id: 'high',
    label: 'High',
    detail: '1.5x pixels · AA · up to 120 fps',
    hoverDetail: 'Medium’s image at up to double the frame rate. Only pays off on a 120 Hz+ '
      + 'display with the GPU headroom to hold it.',
  },
]

export const DEFAULT_FLIGHT_QUALITY = 'medium'

const QUALITY_STORAGE_KEY = 'f22-viewer:flight-quality'
const CUSTOM_STORAGE_KEY = 'f22-viewer:flight-graphics-custom'

/*
Custom, as its own preset rather than as a fourth profile.

The three named profiles say what they buy in one line, which is what most pilots want. A
custom one is for the pilot who has already read a frame-rate number and wants to move one
knob against it, so every field here is a setting the flight surface genuinely consumes —
nothing is offered that the range would ignore.

`restart` is the honest part. Antialiasing, the pixel ratio and the GPU preference are fixed
when the WebGL context is created, so changing them is a new context, which is a new sortie
from the spawn. Shadows and the frame target ride the existing renderer and take effect on
the next frame. The menu groups them by that answer so the cost is visible before the click.
*/
export const FLIGHT_GRAPHICS_FIELDS = [
  {
    id: 'dpr',
    label: 'Resolution scale',
    note: 'Device pixel ratio',
    restart: true,
    detail: 'How many pixels the renderer draws for each pixel your display shows. Fixed '
      + 'when the WebGL context is created, so moving it restarts the sortie.',
    options: [
      {
        id: '1',
        label: '×1',
        value: 1,
        detail: 'One rendered pixel per screen pixel. Softest image, cheapest on the GPU — '
          + 'the one to pick if frame rate is what is limiting you.',
      },
      {
        id: '1-1.5',
        label: '×1.5',
        value: [1, 1.5],
        detail: 'Renders at up to 1.5x your display’s pixel density. Noticeably sharper '
          + 'edges for a moderate GPU cost — the balance point.',
      },
      {
        id: '1-2',
        label: '×2',
        value: [1, 2],
        detail: 'Renders at up to double pixel density. The sharpest image on offer, and the '
          + 'heaviest — expect fewer frames on an integrated GPU.',
      },
    ],
  },
  {
    id: 'antialias',
    label: 'Anti-aliasing',
    note: 'MSAA on the default framebuffer',
    restart: true,
    detail: 'Multisamples the default framebuffer to soften jagged edges. Fixed when the '
      + 'WebGL context is created, so moving it restarts the sortie.',
    options: [
      {
        id: 'on',
        label: 'On',
        value: true,
        detail: 'Softens jagged edges on canopy struts and terrain silhouettes. Costs a '
          + 'fixed slice of GPU time no matter what is on screen.',
      },
      {
        id: 'off',
        label: 'Off',
        value: false,
        detail: 'No multisampling — edges alias, but nothing is spent smoothing them. Frees '
          + 'up headroom to spend on resolution scale or frame target instead.',
      },
    ],
  },
  {
    id: 'powerPreference',
    label: 'GPU preference',
    note: 'Hint to the browser, not a guarantee',
    restart: true,
    detail: 'A hint passed to the browser about which GPU to hand the context to. Fixed when '
      + 'the WebGL context is created, so moving it restarts the sortie.',
    options: [
      {
        id: 'high-performance',
        label: 'Performance',
        value: 'high-performance',
        detail: 'Asks the browser for the discrete GPU where the machine has one. A hint, '
          + 'not a guarantee — battery-saver modes can still override it.',
      },
      {
        id: 'default',
        label: 'Default',
        value: 'default',
        detail: 'Lets the browser choose — often the integrated GPU on a laptop, which '
          + 'saves battery but renders fewer frames.',
      },
    ],
  },
  {
    id: 'targetFps',
    label: 'Frame target',
    note: 'Frames the surface asks for each second',
    restart: false,
    detail: 'How many frames a second the render loop asks for. Rides the existing renderer, '
      + 'so moving it takes effect on the next frame — no restart.',
    options: [
      {
        id: '30',
        label: '30',
        value: 30,
        detail: 'Caps the render loop at 30 frames a second. Lowest GPU load, least smooth '
          + 'motion.',
      },
      {
        id: '60',
        label: '60',
        value: 60,
        detail: 'Matches most displays’ native refresh rate. Smooth motion at a moderate '
          + 'GPU cost.',
      },
      {
        id: '120',
        label: '120',
        value: 120,
        detail: 'Asks for twice 60’s frame rate. Only visible on a 120 Hz+ display, and '
          + 'only reachable if the GPU has the headroom to hold it.',
      },
    ],
  },
]

/*
Shadows are deliberately absent from that list. The flight maps light themselves with a
hemisphere and a sun that casts nothing, so the switch would cost the pilot a click and
change no pixel on this surface — and a control that does nothing is exactly what the
"don't invent" rule is about. It stays in the profiles because the studio viewer, which
does cast, reads the same table.
*/

// Custom starts from Medium rather than from nothing, so the first knob the pilot moves is
// a change to a profile they have already seen rather than a blank they have to fill in.
export const DEFAULT_FLIGHT_CUSTOM = {
  dpr: '1-1.5',
  antialias: 'on',
  powerPreference: 'high-performance',
  targetFps: '60',
}

export function readFlightQuality() {
  try {
    const stored = window.localStorage.getItem(QUALITY_STORAGE_KEY)
    if (stored === 'custom') return 'custom'
    return FLIGHT_QUALITY_OPTIONS.some((option) => option.id === stored)
      ? stored
      : DEFAULT_FLIGHT_QUALITY
  } catch {
    // Private browsing and embedded webviews can refuse storage; the default still flies.
    return DEFAULT_FLIGHT_QUALITY
  }
}

export function writeFlightQuality(quality) {
  try {
    window.localStorage.setItem(QUALITY_STORAGE_KEY, quality)
  } catch {
    // Not being able to remember the choice is not a reason to refuse it this session.
  }
}

function sanitiseCustom(source) {
  const next = {}
  for (const field of FLIGHT_GRAPHICS_FIELDS) {
    const chosen = source?.[field.id]
    next[field.id] = field.options.some((option) => option.id === chosen)
      ? chosen
      : DEFAULT_FLIGHT_CUSTOM[field.id]
  }
  return next
}

export function readFlightCustomGraphics() {
  try {
    const stored = window.localStorage.getItem(CUSTOM_STORAGE_KEY)
    return sanitiseCustom(stored ? JSON.parse(stored) : null)
  } catch {
    return sanitiseCustom(null)
  }
}

export function writeFlightCustomGraphics(custom) {
  try {
    window.localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(custom))
  } catch {
    // Not being able to remember the choice is not a reason to refuse it this session.
  }
}

/*
The profile the surface actually renders from. A named quality is its authored profile
unchanged; `custom` is built field by field from the pilot's choices, on top of medium so
that anything not exposed here — the shadow map size, the environment — still has the value
the flight profiles were tuned with.
*/
export function resolveFlightGraphics(quality, custom) {
  if (quality !== 'custom') {
    return GRAPHICS_PROFILES[quality] ?? GRAPHICS_PROFILES[DEFAULT_FLIGHT_QUALITY]
  }
  const chosen = sanitiseCustom(custom)
  const profile = { ...GRAPHICS_PROFILES.medium }
  for (const field of FLIGHT_GRAPHICS_FIELDS) {
    const option = field.options.find((entry) => entry.id === chosen[field.id])
    if (option) profile[field.id] = option.value
  }
  return profile
}

/*
The fields as the settings screen has to show them: whatever profile is actually in force,
named back in option ids.

A named quality has no stored fields of its own, so they are read off its authored profile
by matching values. That is what lets the screen show Low, Medium and High with their real
knobs rather than with a custom set the pilot has not chosen — and it means the first knob
they move starts from the preset they were on rather than from an unrelated saved one.
*/
export function describeFlightGraphics(quality, custom) {
  if (quality === 'custom') return sanitiseCustom(custom)
  const profile = GRAPHICS_PROFILES[quality] ?? GRAPHICS_PROFILES[DEFAULT_FLIGHT_QUALITY]
  const described = {}
  for (const field of FLIGHT_GRAPHICS_FIELDS) {
    const match = field.options.find(
      (option) => JSON.stringify(option.value) === JSON.stringify(profile[field.id]),
    )
    // A profile whose value is not one the screen offers — a frame target no card names —
    // falls back to the custom default rather than showing a field with nothing latched.
    described[field.id] = match?.id ?? DEFAULT_FLIGHT_CUSTOM[field.id]
  }
  return described
}

/*
What has to change for the context to be thrown away and rebuilt. Only the restart fields
are in it, so moving the frame target on a custom profile keeps the sortie in the air while
moving the pixel ratio honestly restarts it.
*/
export function flightGraphicsKey(quality, custom) {
  if (quality !== 'custom') return quality
  const chosen = sanitiseCustom(custom)
  return FLIGHT_GRAPHICS_FIELDS
    .filter((field) => field.restart)
    .map((field) => `${field.id}:${chosen[field.id]}`)
    .join('|')
}

export function useGraphicsProfile(name = DEFAULT_GRAPHICS_PROFILE) {
  return GRAPHICS_PROFILES[name] ?? GRAPHICS_PROFILES[DEFAULT_GRAPHICS_PROFILE]
}
