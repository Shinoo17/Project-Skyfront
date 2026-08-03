import mountainValley from './mountainValley'

// Add a range by dropping a module beside mountainValley.js with the same shape and
// listing it here. Scenes read the manifest, never a terrain path or a range dimension.
export const MAPS = {
  [mountainValley.id]: mountainValley,
}

export const DEFAULT_MAP_ID = mountainValley.id

export function getMap(id = DEFAULT_MAP_ID) {
  return MAPS[id] ?? MAPS[DEFAULT_MAP_ID]
}

export function listMaps() {
  return Object.values(MAPS)
}
