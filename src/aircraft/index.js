import f22 from './f22'

// Add an airframe by dropping a module beside f22.js with the same shape and listing it
// here. Surfaces read the manifest, never a model path or a mesh name.
export const AIRCRAFT = {
  [f22.id]: f22,
}

export const DEFAULT_AIRCRAFT_ID = f22.id

export function getAircraft(id = DEFAULT_AIRCRAFT_ID) {
  return AIRCRAFT[id] ?? AIRCRAFT[DEFAULT_AIRCRAFT_ID]
}

export function listAircraft() {
  return Object.values(AIRCRAFT)
}
