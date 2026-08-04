import aim120 from './aim120'
import aim9 from './aim9'

// Add a weapon by dropping a module beside aim9.js with the same shape and listing it
// here. Surfaces read the manifest, never a model path or a missile's dimensions.
//
// A weapon module describes the weapon and nothing else. How many an airframe carries and
// which bay they ride in belongs to the airframe, so an SU-57 listing the same AMRAAM-
// class weapon with a different count changes one line in its own module.
export const WEAPONS = {
  [aim9.id]: aim9,
  [aim120.id]: aim120,
}

export function getWeapon(id) {
  return WEAPONS[id] ?? null
}

/*
Turns an airframe's `weapons` list into what a surface can draw: the weapon manifest with
that airframe's count and station folded in. Unknown ids are dropped rather than thrown,
so an airframe listing a weapon that has not shipped yet still loads.
*/
export function resolveLoadout(entries = []) {
  return entries
    .map(({ id, count, station }) => {
      const weapon = getWeapon(id)
      return weapon ? { ...weapon, count, station } : null
    })
    .filter(Boolean)
}
