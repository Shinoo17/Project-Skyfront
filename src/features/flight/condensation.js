/*
When the wing is allowed to show vapour, and how much of it.

The sheet over the upper surface is condensation, not smoke: a hard pull drops the static
pressure — and with it the temperature — over the wing until the air there passes its dew
point, and the cloud stands still relative to the airframe for exactly as long as the
suction lasts. So the strength published here is a stand-in for that suction peak, and it
is read off the same two numbers the wing itself is working with.

  gLoad    the load factor the wing is pulling, which is lift over weight and therefore
           the honest measure of how hard the upper surface is being unloaded
  aoaDeg   angle of attack, which keeps the sheet alive through a slow nose-high pull
           where the load factor alone has already fallen away
  speedKmh the gate: suction is dynamic pressure times lift coefficient, so a jet mushing
           along at pattern speed makes no cloud however far the nose is cocked up

Only positive G counts. A push moves the suction peak to the *underside* of the wing, and
a sheet drawn on top of it during a bunt would be the model showing something the airframe
is not doing — so on negative G this reports nothing at all.

None of it is real thermodynamics: there is no humidity or temperature in this simulation,
and the onsets are tuned by eye against the airshow photographs. What it does guarantee is
that the cloud can only ever appear where the flight model is genuinely loading the wing.
*/

function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

function ramp(value, from, to) {
  const t = clamp01((value - from) / Math.max(to - from, 1e-3))
  return t * t * (3 - (2 * t))
}

export function createCondensationState() {
  return resetCondensationState({})
}

export function resetCondensationState(state) {
  state.level = 0
  state.suction = 0
  return state
}

// The instantaneous demand, before any spool. Split out so a panel or a test can ask what
// the airframe is asking for without having to run a frame.
export function readCondensationSuction({ gLoad = 1, aoaDeg = 0, speedKmh = 0 }, tuning) {
  const speed = ramp(speedKmh, tuning.minKmh, tuning.fullKmh)
  if (speed <= 0) return 0

  const load = ramp(Math.max(gLoad, 0), tuning.onsetG, tuning.fullG)
  const alpha = ramp(Math.max(aoaDeg, 0), tuning.aoaOnsetDeg, tuning.aoaFullDeg)

  return clamp01(Math.max(load, alpha * tuning.aoaWeight) * speed)
}

/*
One frame of the cloud.

Condensation forms the moment the pressure drops and lingers a beat after it recovers —
the air has to be re-warmed and mixed away, which takes longer than making it. So the
level chases its demand with the same asymmetric exponential the burner spools with,
onset faster than decay, and never snaps.
*/
export function stepCondensation(state, { gLoad, aoaDeg, speedKmh, step }, tuning) {
  state.suction = readCondensationSuction({ gLoad, aoaDeg, speedKmh }, tuning)

  const rate = state.suction > state.level
    ? tuning.onsetPerSecond
    : tuning.decayPerSecond
  state.level += (state.suction - state.level) * (1 - Math.exp(-rate * step))
  if (state.level < 0.002) state.level = 0

  return state
}
