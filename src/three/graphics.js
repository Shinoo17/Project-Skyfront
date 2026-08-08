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
  { id: 'low', label: 'Low', detail: '1x pixels · no AA · 30 fps' },
  { id: 'medium', label: 'Medium', detail: '1.5x pixels · AA · 60 fps' },
  { id: 'high', label: 'High', detail: '1.5x pixels · AA · up to 120 fps' },
]

export const DEFAULT_FLIGHT_QUALITY = 'medium'

const QUALITY_STORAGE_KEY = 'f22-viewer:flight-quality'

export function readFlightQuality() {
  try {
    const stored = window.localStorage.getItem(QUALITY_STORAGE_KEY)
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

export function useGraphicsProfile(name = DEFAULT_GRAPHICS_PROFILE) {
  return GRAPHICS_PROFILES[name] ?? GRAPHICS_PROFILES[DEFAULT_GRAPHICS_PROFILE]
}
