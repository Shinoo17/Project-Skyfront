/* Automatic maneuver-surface/FCS regression checks.

These test the contract rather than hinge geometry: no pilot flap axis, smooth scheduling
from flight state, more surface during High-G, and sharply reduced aerodynamic value at
deep AoA even while the visible surfaces are still allowed to move.
*/

import assert from 'node:assert/strict'
import { Vector3 } from 'three'

import f22 from '../src/aircraft/f22.js'
import { FLIGHT_BINDINGS, createFlightInputState } from '../src/features/flight/flightInput.js'
import { stepManeuverSurfaces } from '../src/features/flight/flight-model/maneuverSurfaces.js'
import { createFlightState, resetFlightState } from '../src/features/flight/flightModel.js'

const envelope = f22.flight.envelope
const tuning = envelope.maneuvering
const dt = 1 / 120

function scheduled({ aoa = 0, pitch = 0, speed = 750, g = 1, highG = 0 }, seconds = 1) {
  const state = createFlightState()
  resetFlightState(state, new Vector3(), speed, envelope, 0.7)
  state.aoaDeg = aoa
  state.input.pitch = pitch
  state.highGBlend = highG
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) {
    stepManeuverSurfaces(state, tuning, dt, g)
  }
  return state
}

assert.equal(FLIGHT_BINDINGS.KeyF, undefined, 'manual F binding must stay removed')
assert.equal('flaps' in createFlightInputState().intent, false,
  'pilot intent must not publish flaps to flight physics')

const firstFrame = scheduled({ aoa: 18, pitch: 1, g: 6, highG: 1 }, dt)
const settled = scheduled({ aoa: 18, pitch: 1, g: 6, highG: 1 })
assert.ok(firstFrame.maneuverSurface > 0 && firstFrame.maneuverSurface < settled.maneuverSurface,
  'automatic surface demand must slew instead of snapping')

const trim = scheduled({ aoa: 3, pitch: 0, g: 1 })
const normal = scheduled({ aoa: 14, pitch: 0.65, g: 4 })
const highG = scheduled({ aoa: 14, pitch: 0.65, g: 8, highG: 1 })
assert.ok(trim.maneuverSurface < 0.02, 'trim flight must keep maneuver surfaces nearly clean')
assert.ok(normal.maneuverSurface > 0.25 && normal.maneuverSurface <= 0.7,
  'normal pull must schedule a moderate surface contribution, not landing flaps')
assert.ok(highG.maneuverSurface > normal.maneuverSurface + 0.2,
  'High-G must schedule more maneuver surface than the same normal pull')

const deepAoA = scheduled({ aoa: 62, pitch: 1, speed: 420, g: 2, highG: 0 })
assert.ok(deepAoA.maneuverSurface > 0.25,
  'deep-AoA animation may continue to show the FCS moving its surfaces')
assert.ok(deepAoA.maneuverSurfaceEffectiveness <= 0.13,
  'deep-AoA aerodynamic surface effectiveness must fade to its configured floor')

const manualFlapProbe = f22.mixControlSurfaces({ pitch: 0, roll: 0, yaw: 0, flaps: 1 })
assert.equal(Math.abs(manualFlapProbe.leadingEdgeFlapLeft), 0,
  'legacy flaps input must have no path into surface animation')
const automaticProbe = f22.mixControlSurfaces({
  pitch: 0.7,
  maneuverSurface: highG.maneuverSurface,
  leadingEdgeDeflection: highG.leadingEdgeDeflection,
  trailingEdgeDeflection: highG.trailingEdgeDeflection,
  flaperonDeflection: highG.flaperonDeflection,
})
assert.ok(automaticProbe.leadingEdgeFlapLeft < -5,
  'FCS leading-edge demand must animate the model in a hard pull')
assert.ok(Math.abs(automaticProbe.flaperonLeft) <= 22.6,
  'mixed automatic flaperon animation must remain inside the model hinge limit')

console.log('PASS maneuver surfaces: automatic schedule, smooth response, High-G demand,'
  + ` deep-AoA fade (${Math.round(deepAoA.maneuverSurfaceEffectiveness * 100)}% effective)`)
