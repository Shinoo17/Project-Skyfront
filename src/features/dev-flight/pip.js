/*
Where the picture-in-picture sits, computed once and used by both halves of it.

The WebGL pass and the HUD overlay have to agree to the pixel or the projected symbology
stops registering with the terrain underneath it, so neither one is allowed its own idea of
the box. This returns CSS pixels measured from the top-left, the way the DOM counts;
the renderer flips the y itself, because WebGL counts from the bottom.
*/

const PIP_MARGIN = 22
const PIP_WIDTH_RATIO = 0.32
const PIP_MIN_WIDTH = 260
const PIP_MAX_WIDTH = 560
const PIP_ASPECT = 16 / 9

export function computePipRect(width, height) {
  const available = Math.max(0, width - (PIP_MARGIN * 2))
  const boxWidth = Math.round(Math.min(
    Math.max(Math.min(width * PIP_WIDTH_RATIO, PIP_MAX_WIDTH), PIP_MIN_WIDTH),
    available,
  ))
  const boxHeight = Math.round(boxWidth / PIP_ASPECT)

  return {
    x: Math.max(0, Math.round(width - boxWidth - PIP_MARGIN)),
    y: Math.max(0, Math.round(height - boxHeight - PIP_MARGIN)),
    width: Math.max(1, boxWidth),
    height: Math.max(1, boxHeight),
  }
}
