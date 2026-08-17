/* Keyboard layout regression checks.

The pilot's keyboard is described twice — once as rows in `keybindings.js`, which is what the
rebind screen shows, and once as the flat `code → control` map in `flightInput.js`, which is
what the input layer actually reads. Nothing forces the two to agree, and a disagreement is
exactly the failure this project keeps guarding against everywhere else: a legend that says
one key while the aircraft flies another.

So the checks below are all about the map, not about the physics. Whether High-G is worth
holding is `high-g-check`'s question; whether the key the menu prints is the key that reaches
`readHighG` is this one's.
*/

import assert from 'node:assert/strict'

import { FLIGHT_BINDINGS } from '../src/features/flight/flightInput.js'
import {
  DEFAULT_KEY_BINDINGS,
  FLIGHT_CONTROL_ROWS,
  RESERVED_CODES,
  assignBinding,
  clearBinding,
  toBindingMap,
} from '../src/features/flight/keybindings.js'

// A: every control the screen shows has a key, no key is claimed twice, and none of them
// sits on a code the sortie has reserved for itself.
{
  const owner = new Map()
  for (const row of FLIGHT_CONTROL_ROWS) {
    const slots = DEFAULT_KEY_BINDINGS[row.action]
    assert.ok(slots, `A: ${row.action} is a row with no authored default`)
    for (const code of slots) {
      if (!code) continue
      assert.equal(owner.has(code), false,
        `A: ${code} is claimed by both ${owner.get(code)} and ${row.action}`)
      assert.equal(RESERVED_CODES.has(code), false,
        `A: ${row.action} defaults onto the reserved ${code}`)
      owner.set(code, row.action)
    }
  }
  console.log(`PASS A layout        ${FLIGHT_CONTROL_ROWS.length} controls`
    + ` on ${owner.size} keys, none reserved, none shared`)
}

// B: the rows and the flat map are the same keyboard. This is the check that would have
// caught `high-g` reaching `readHighG` from a map that never carried it.
{
  assert.deepEqual(toBindingMap(DEFAULT_KEY_BINDINGS), FLIGHT_BINDINGS,
    'B: FLIGHT_BINDINGS and the authored default rows describe different keyboards')
  console.log('PASS B agreement     the rebind screen and the input layer read the same map')
}

// C: High-G and the PSM arm are separate controls. In the 220-660 km/h band where PSM arms,
// a hard turn and a Cobra entry are the same stick held for the same time, so one key would
// make every hard turn in the fighting band a post-stall tumble.
{
  const highG = DEFAULT_KEY_BINDINGS['high-g'].filter(Boolean)
  const psm = DEFAULT_KEY_BINDINGS['maneuver-assist'].filter(Boolean)
  assert.ok(highG.length > 0, 'C: High-G must have a key of its own')
  assert.ok(psm.length > 0, 'C: the PSM arm must have a key of its own')
  for (const code of highG) {
    assert.equal(psm.includes(code), false, `C: ${code} may not be both High-G and the PSM arm`)
  }
  console.log(`PASS C separation    high-G ${highG.join('/')} · psm arm ${psm.join('/')}`)
}

// D: a rebind steals rather than duplicates, a reserved code is refused outright, and a
// cleared slot really is empty.
{
  const stolen = assignBinding(DEFAULT_KEY_BINDINGS, 'high-g', 1, 'KeyZ')
  const thief = assignBinding(stolen, 'rear-view', 1, 'KeyZ')
  assert.equal(thief['high-g'][1], null, 'D: a stolen code must leave the control it came from')
  assert.equal(thief['rear-view'][1], 'KeyZ', 'D: the thief must end up holding it')

  const codes = Object.values(thief).flat().filter(Boolean)
  assert.equal(new Set(codes).size, codes.length, 'D: a rebind must never leave a code on two rows')

  for (const code of RESERVED_CODES) {
    const refused = assignBinding(DEFAULT_KEY_BINDINGS, 'high-g', 0, code)
    assert.deepEqual(refused['high-g'], DEFAULT_KEY_BINDINGS['high-g'],
      `D: the reserved ${code} must be refused, not taken`)
  }

  const cleared = clearBinding(DEFAULT_KEY_BINDINGS, 'air-brake', 0)
  assert.equal(cleared['air-brake'][0], null, 'D: a cleared slot must be empty')
  assert.equal(toBindingMap(cleared).KeyX, undefined,
    'D: a cleared slot must stop reaching the input layer')
  console.log(`PASS D rebind        steal, refuse ${RESERVED_CODES.size} reserved codes, clear`)
}

console.log('PASS bindings: complete and unique defaults, screen/input agreement,'
  + ' separate High-G and PSM keys, steal-and-refuse rebinding')
