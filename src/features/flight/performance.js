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

export function readThrottlePower(throttle, envelope) {
  return clamp01(
    (throttle - envelope.minThrottle) / (1 - envelope.minThrottle),
  )
}

/*
How much of the high-altitude performance table applies here, 0..1.

Two numbers do the work, because the published figures belong to an altitude this arena is
not built to hand out for free.

  worldUnits        where the table's high-altitude column would be fully earned — the real
                    altitude those figures describe, converted to this range's scale
  maxPerformanceMix how much of that column the range is willing to award at all, ever

The cap is the arcade decision, and it is deliberately a cap on the *mix* rather than on the
table. Scaling the mix moves the speed landmarks and their Mach landmarks together, so
`readMach` keeps reading coherent pairs; editing `dryKmh` down instead would have left the
Mach numbers describing a speed the aircraft no longer reaches.

`performanceFloorUnits` is an optional third: altitude below it is worth nothing at all. No
shipped aircraft sets one — the cap alone already flattens the ramp enough that climbing the
whole of the mountain valley is worth about three per cent — but a per-mode envelope wanting
a strictly single-table fighting volume has somewhere to say so.
*/
export function readAltitudePerformance(altitude, envelope) {
  const { highAltitude } = envelope.performance
  const floor = highAltitude.performanceFloorUnits ?? 0
  const ceiling = Math.max(highAltitude.worldUnits - floor, 1)
  const cap = highAltitude.maxPerformanceMix ?? 1
  return Math.min(cap, smoothstep((altitude - floor) / ceiling))
}

function readAfterburnerLimitKmh(altitudeMix, envelope) {
  const { performance } = envelope
  return lerp(
    performance.seaLevel.afterburnerKmh,
    performance.highAltitude.afterburnerKmh,
    altitudeMix,
  )
}

function readDryLimitKmh(altitudeMix, envelope) {
  const { performance } = envelope
  return lerp(
    performance.seaLevel.dryKmh,
    performance.highAltitude.dryKmh,
    altitudeMix,
  )
}

/*
This is the steady, wings-level equilibrium used only to seed a reset. Live flight does
not chase this speed: thrust and drag are evaluated independently below, and merely meet
at the same authored landmarks. Keeping the reset trim here means every manoeuvre still
enters at the speed named by its throttle while the pilot gets a real power lever in flight.
*/
export function readTargetAirspeedKmh(throttle, altitude, reheat, envelope) {
  const { performance } = envelope
  const altitudeMix = readAltitudePerformance(altitude, envelope)
  const power = readThrottlePower(throttle, envelope)
  const dryLimit = readDryLimitKmh(altitudeMix, envelope)
  const dryTarget = lerp(performance.minKmh, dryLimit, power)
  const level = clamp01(reheat)
  if (!level) return dryTarget

  return lerp(dryTarget, readAfterburnerLimitKmh(altitudeMix, envelope), level)
}

// The dry ceiling the aircraft can actually hold at this altitude, which is what a speed
// selector has to top out at. Reheat goes past it, but reheat is a burst the pilot spends
// rather than a setting they park on, so it does not belong on the same control.
export function readDryCeilingKmh(altitude, envelope) {
  return readDryLimitKmh(readAltitudePerformance(altitude, envelope), envelope)
}

// The same ceiling at the best altitude there is, which after `maxPerformanceMix` is no
// longer the table's high-altitude figure. This is the outer bound of the commandable band:
// a speed above it is a number the aircraft cannot reach anywhere, at any height.
export function readMaxDryCeilingKmh(envelope) {
  const { highAltitude } = envelope.performance
  return readDryLimitKmh(Math.min(1, highAltitude.maxPerformanceMix ?? 1), envelope)
}

/*
The inverse of the dry branch above, and the whole of the arcade speed control: the pilot
names an airspeed, this turns it back into the power setting that holds it, and the flight
model never learns that anything changed. Both directions are linear in `power`, so the
round trip is exact — seeding a command from `idleThrottle` gives `idleThrottle` back.

It is feedforward, not a speed hold, and that is deliberate. A hard turn bills induced and
brake drag the power lever never hears about, so the aircraft bleeds below the commanded
number and has to be flown back up to it. That bleed is the energy game; closing a loop
around it would hand the player their speed back for free.
*/
export function readThrottleForAirspeedKmh(speedKmh, altitude, envelope) {
  const { performance } = envelope
  const ceiling = readDryCeilingKmh(altitude, envelope)
  const power = clamp01(
    (speedKmh - performance.minKmh) / Math.max(ceiling - performance.minKmh, 1),
  )
  return envelope.minThrottle + (power * (1 - envelope.minThrottle))
}

/*
Propulsion and drag are deliberately separate. Core power owns dry thrust, reheat adds
augmented thrust, and neither vanishes because the aircraft crossed a target speed. The
drag curve uses the same exponent as the throttle curve, so below the dry limit their
equilibrium still lands on `readTargetAirspeedKmh`; a smooth transonic rise then makes full
reheat meet drag at the authored afterburner limit.
*/
export function readPropulsionKmhPerSecond(engineCoreLevel, reheat, envelope) {
  const { performance } = envelope
  const core = clamp01(engineCoreLevel)
  const dryThrust = performance.accelerationKmhPerSecond * (
    performance.idleThrustFraction
    + ((1 - performance.idleThrustFraction)
      * (core ** performance.throttlePowerExponent))
  )
  const augmentedThrust = (
    performance.afterburnerAccelerationKmhPerSecond
    - performance.accelerationKmhPerSecond
  ) * clamp01(reheat)
  return dryThrust + augmentedThrust
}

export function readDragKmhPerSecond(speedKmh, altitude, envelope) {
  const { performance } = envelope
  const altitudeMix = readAltitudePerformance(altitude, envelope)
  const dryLimit = readDryLimitKmh(altitudeMix, envelope)
  const afterburnerLimit = readAfterburnerLimitKmh(altitudeMix, envelope)
  const dryRange = Math.max(dryLimit - performance.minKmh, 1)
  const dryLoad = Math.max(0, (speedKmh - performance.minKmh) / dryRange)
  const lowSpeedFlow = smoothstep(speedKmh / performance.minKmh)
  const dryDrag = performance.accelerationKmhPerSecond * (
    (performance.idleThrustFraction * lowSpeedFlow)
    + ((1 - performance.idleThrustFraction)
      * (dryLoad ** performance.throttlePowerExponent))
  )
  const transonic = smoothstep(
    (speedKmh - dryLimit) / Math.max(afterburnerLimit - dryLimit, 1),
  )
  const waveDrag = (
    performance.afterburnerAccelerationKmhPerSecond
    - performance.accelerationKmhPerSecond
  ) * transonic
  return dryDrag + waveDrag
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
  const flameout = state.level / afterburner.spoolDownPerSecond
  const dwell = Math.max(0, afterburner.recoveryDelaySeconds - state.cooling)
  const refill = Math.max(0, afterburner.relightReserve - state.reserve)
  state.cooldown = flameout + dwell + (refill * afterburner.recoverySeconds)
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
    state.level = Math.min(1, state.level + (step * afterburner.spoolUpPerSecond))
  } else {
    state.level = Math.max(0, state.level - (step * afterburner.spoolDownPerSecond))
  }

  // Reserve follows thrust actually being produced, not the key state. The light-off and
  // shutdown transients therefore cost exactly the reheat they deliver, so feathering the
  // key cannot harvest an unbilled spool-down pulse.
  if (state.level > 0) {
    state.cooling = 0
    state.reserve = Math.max(
      0,
      state.reserve - ((step * state.level) / afterburner.burnSeconds),
    )
    if (state.reserve <= 0) {
      state.lit = false
      state.lockedOut = true
    }
  } else {
    // Cooling starts only after augmented thrust has genuinely reached zero. A hot nozzle
    // cannot spend the same half-second both pushing the aircraft and earning fuel back.
    state.cooling += step
    if (state.cooling >= afterburner.recoveryDelaySeconds) {
      state.reserve = Math.min(1, state.reserve + (step / afterburner.recoverySeconds))
    }
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
