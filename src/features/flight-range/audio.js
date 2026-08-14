/*
Master volume, and nothing else — because there is nothing else yet.

The sortie has no audio engine: no engine loop, no reheat, no warning tones. This module
exists so the setting is already stored, already named, and already reading back the way it
will when there is something to turn down, and so the menu has one honest row to show
instead of a bank of sliders that move nothing.

The screen says so out loud. A volume control that silently does nothing is worse than an
absent one: the pilot drags it, hears no change, and concludes the audio is broken.
*/

const MASTER_VOLUME_KEY = 'f22-flight-master-volume'

export const MASTER_VOLUME_RANGE = { min: 0, max: 100, step: 1, default: 80 }

export function readMasterVolume() {
  try {
    // Tested for absence before conversion: `Number(null)` is 0, not NaN, so a finiteness
    // check alone would read "never set" as "turned all the way down".
    const stored = window.localStorage.getItem(MASTER_VOLUME_KEY)
    if (stored === null) return MASTER_VOLUME_RANGE.default
    const value = Number(stored)
    if (!Number.isFinite(value)) return MASTER_VOLUME_RANGE.default
    return Math.min(MASTER_VOLUME_RANGE.max, Math.max(MASTER_VOLUME_RANGE.min, value))
  } catch {
    return MASTER_VOLUME_RANGE.default
  }
}

export function writeMasterVolume(value) {
  try {
    window.localStorage.setItem(MASTER_VOLUME_KEY, String(value))
  } catch {
    // Storage can be refused; the choice still holds for this session.
  }
}
