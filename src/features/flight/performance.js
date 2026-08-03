function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

function lerp(from, to, amount) {
  return from + ((to - from) * amount)
}

function smoothstep(value) {
  const clamped = clamp01(value)
  return clamped * clamped * (3 - (2 * clamped))
}

export function readAltitudePerformance(altitude, envelope) {
  const { performance } = envelope
  return smoothstep(altitude / performance.highAltitude.worldUnits)
}

function readAfterburnerLimitKmh(altitudeMix, envelope) {
  const { performance } = envelope
  return lerp(
    performance.seaLevel.afterburnerKmh,
    performance.highAltitude.afterburnerKmh,
    altitudeMix,
  )
}

/*
`reheat` is how much of the burner is actually alight, 0..1 — not a switch. A burner
spooling up walks the target between the dry limit and the reheat limit rather than
snapping to it, which is what makes light-off read as a surge instead of a jump.

Reheat does not scale with the throttle. Where dry thrust runs from idle up to the military
limit, the burner dumps fuel into the jet pipe and pulls toward the reheat limit whatever
the core is set to — which is why lighting it at a crawl is a boost rather than a nudge.
*/
export function readTargetAirspeedKmh(throttle, altitude, reheat, envelope) {
  const { performance } = envelope
  const altitudeMix = readAltitudePerformance(altitude, envelope)
  const power = clamp01(
    (throttle - envelope.minThrottle) / (1 - envelope.minThrottle),
  )
  const dryLimit = lerp(
    performance.seaLevel.dryKmh,
    performance.highAltitude.dryKmh,
    altitudeMix,
  )
  const dryTarget = lerp(performance.minKmh, dryLimit, power)
  const level = clamp01(reheat)
  if (!level) return dryTarget

  return lerp(dryTarget, readAfterburnerLimitKmh(altitudeMix, envelope), level)
}

/*
Excess thrust, not a flat number.

Accelerating, the airframe gives up a share of its acceleration as it approaches the
reheat limit, because drag climbs with speed. Decelerating, there is no brake at all: what
slows the jet after the burner cuts is drag alone, so the rate decays with the gap the
aircraft is still carrying above the speed its throttle will hold. The magnitudes are
compressed like the terrain scale; the shape of both curves is the real one.
*/
export function readAccelerationKmhPerSecond(speedKmh, targetKmh, reheat, altitude, envelope) {
  const { performance } = envelope
  if (targetKmh <= speedKmh) {
    return Math.min(
      performance.decelerationKmhPerSecond,
      (speedKmh - targetKmh) * performance.dragDecayPerSecond,
    )
  }

  const limit = readAfterburnerLimitKmh(
    readAltitudePerformance(altitude, envelope),
    envelope,
  )
  const load = limit > 0 ? clamp01(speedKmh / limit) : 0
  const thrust = lerp(
    performance.accelerationKmhPerSecond,
    performance.afterburnerAccelerationKmhPerSecond,
    clamp01(reheat),
  )
  return thrust * (1 - (performance.dragFalloff * load * load))
}

/*
The reheat state machine, as one mutable object the flight loop owns, the exhaust plume
reads `level` off, and the HUD reads whole.

  { reserve, level, lit, lockedOut, cooling, seconds, cooldown }

`reserve` is the fuel the burner is allowed to spend, 0..1. `level` is how much of the
burner is alight. `lit` says the flame is commanded and fed. `lockedOut` latches when the
reserve runs dry and clears only once enough has come back to relight.

`seconds` and `cooldown` are the same two facts in the unit the pilot actually thinks in:
how long the burner will keep burning, and — once it has been run dry — how long until it
will light again. A reserve bar says how much is left; only a clock says how long that is.
*/
export function createAfterburnerState() {
  return resetAfterburnerState({})
}

export function resetAfterburnerState(state) {
  state.reserve = 1
  state.level = 0
  state.lit = false
  state.lockedOut = false
  state.cooling = 0
  state.seconds = 0
  state.cooldown = 0
  return state
}

// Seconds of reheat the reserve still holds, and seconds until a burnt-out burner will
// relight — the recovery dwell the nozzle still owes, plus the refill after it.
function readAfterburnerClocks(state, afterburner) {
  state.seconds = state.reserve * afterburner.burnSeconds
  if (!state.lockedOut) {
    state.cooldown = 0
    return
  }
  const dwell = Math.max(0, afterburner.recoveryDelaySeconds - state.cooling)
  const refill = Math.max(0, afterburner.relightReserve - state.reserve)
  state.cooldown = dwell + (refill * afterburner.recoverySeconds)
}

export function stepAfterburner(state, { commanded, step }, envelope) {
  const { afterburner } = envelope
  // A burner that is not locked out will burn whatever is left, down to the last drop —
  // running the reserve to nothing is exactly what latches the lockout, so cutting the
  // flame early on a low reserve would mean the cooldown never engaged at all.
  const needs = state.lockedOut ? afterburner.relightReserve : 0
  state.lit = commanded && state.reserve > needs

  if (state.lit) {
    state.lockedOut = false
    state.cooling = 0
    state.level = Math.min(1, state.level + (step * afterburner.spoolUpPerSecond))
    // Billed against the flame that is actually burning, so the light-off transient is not
    // charged at full reheat.
    state.reserve = Math.max(
      0,
      state.reserve - ((step * state.level) / afterburner.burnSeconds),
    )
    if (state.reserve <= 0) {
      state.lit = false
      state.lockedOut = true
    }
    readAfterburnerClocks(state, afterburner)
    return state
  }

  state.level = Math.max(0, state.level - (step * afterburner.spoolDownPerSecond))
  state.cooling += step
  if (state.cooling >= afterburner.recoveryDelaySeconds) {
    state.reserve = Math.min(1, state.reserve + (step / afterburner.recoverySeconds))
  }
  if (state.lockedOut && state.reserve >= afterburner.relightReserve) state.lockedOut = false
  readAfterburnerClocks(state, afterburner)
  return state
}

// The supplied performance table contains approximate Mach/km/h pairs rather than one
// atmospheric speed-of-sound curve. Interpolating through those authored landmarks keeps
// the instrument faithful at every named condition, including Mach 1.5 at 1,850 km/h and
// Mach 2.25 at 2,414 km/h at altitude.
export function readMach(speedKmh, altitude, envelope) {
  const { performance } = envelope
  const altitudeMix = readAltitudePerformance(altitude, envelope)
  const cruiseSpeed = lerp(
    performance.seaLevel.dryKmh,
    performance.highAltitude.supercruiseMinKmh,
    altitudeMix,
  )
  const cruiseMach = lerp(
    performance.seaLevel.dryMach,
    performance.highAltitude.supercruiseMinMach,
    altitudeMix,
  )
  const drySpeed = lerp(
    performance.seaLevel.dryKmh,
    performance.highAltitude.dryKmh,
    altitudeMix,
  )
  const dryMach = lerp(
    performance.seaLevel.dryMach,
    performance.highAltitude.dryMach,
    altitudeMix,
  )
  const afterburnerSpeed = lerp(
    performance.seaLevel.afterburnerKmh,
    performance.highAltitude.afterburnerKmh,
    altitudeMix,
  )
  const afterburnerMach = lerp(
    performance.seaLevel.afterburnerMach,
    performance.highAltitude.afterburnerMach,
    altitudeMix,
  )
  const speed = Math.max(0, speedKmh)

  if (speed <= cruiseSpeed) {
    return cruiseSpeed > 0 ? (speed / cruiseSpeed) * cruiseMach : 0
  }
  if (speed <= drySpeed && drySpeed > cruiseSpeed) {
    return lerp(cruiseMach, dryMach, (speed - cruiseSpeed) / (drySpeed - cruiseSpeed))
  }
  if (speed <= afterburnerSpeed && afterburnerSpeed > drySpeed) {
    return lerp(dryMach, afterburnerMach, (speed - drySpeed) / (afterburnerSpeed - drySpeed))
  }
  return afterburnerMach
}

export function readWorldSpeed(speedKmh, envelope) {
  return speedKmh / envelope.performance.kmhPerWorldUnitPerSecond
}
