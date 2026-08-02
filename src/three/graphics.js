/*
Every renderer setting a graphics-settings screen would eventually own, in one place.
Today each surface asks for a fixed profile and gets a constant back, so the values are
exactly what the two Canvases were hardcoding. When the settings milestone lands, this
is the only file that has to learn about the user's choice.

shadowMapSize is null where shadows are off. targetFps drives the demand-render tick;
0 means render on demand only.
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

  // Flight range: a full terrain mesh on whatever GPU the phone has. Deliberately
  // starved — DPR 1, 30 FPS, no AA, no shadows, no environment map, no post.
  eco: {
    dpr: 1,
    antialias: false,
    shadows: false,
    shadowMapSize: null,
    environment: false,
    powerPreference: 'low-power',
    targetFps: 30,
  },
}

export const DEFAULT_GRAPHICS_PROFILE = 'studio'

export function useGraphicsProfile(name = DEFAULT_GRAPHICS_PROFILE) {
  return GRAPHICS_PROFILES[name] ?? GRAPHICS_PROFILES[DEFAULT_GRAPHICS_PROFILE]
}
