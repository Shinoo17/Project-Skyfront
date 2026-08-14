/*
The flight model's public face. The model itself lives in `flight-model/`, split along the
seams it already had:

  step.js            the aerodynamics and the fixed step that drives them
  state.js           what a flight state carries, fresh and reset to a spawn
  psm.js             arcade post-stall intent as a state machine
  highG.js           the conventional high-G envelope beside it
  maneuverDetect.js  what the flight path says the aircraft just did
  math.js            the frame-rate-independent helpers all of the above share

Callers — the sortie, the observer page, and the check scripts under `scripts/` — import
from here and do not need to know which file a symbol came from.
*/

export { createFlightState, resetFlightState } from './flight-model/state'
export { FLIGHT_FIXED_STEP, stepFlight } from './flight-model/step'
