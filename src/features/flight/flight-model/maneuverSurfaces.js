import { MathUtils } from 'three'

import { approach, smooth01 } from './math'

/*
Automatic maneuver-surface scheduling owned by the flight-control computer.

The pilot never commands a flap angle. The FCS combines pilot pitch intent with measured
AoA, airspeed, load factor and the conventional High-G state, then publishes normalized
surface demands. Animation maps those demands to the geometry's hinge limits separately;
the aerodynamic model consumes only the normalized aggregate and effectiveness values.

Deep AoA is deliberately two different readings:

  deflection     the surfaces may still visibly follow the FCC schedule
  effectiveness  separated flow progressively removes what those surfaces can achieve

That separation is what prevents a moving flap from becoming the source of Cobra/flip
authority. Past the stall, inertia, thrust and thrust vectoring remain the useful actors.
*/
export function stepManeuverSurfaces(state, tuning, dt, loadFactor = state.gLoad) {
  const config = tuning.maneuverSurfaces
  if (!config) {
    state.maneuverSurface = 0
    state.leadingEdgeDeflection = 0
    state.trailingEdgeDeflection = 0
    state.flaperonDeflection = 0
    state.maneuverSurfaceEffectiveness = 1
    return
  }

  const alpha = Math.abs(state.aoaDeg)
  const pull = Math.max(state.input.pitch, 0)
  const aoaDemand = smooth01(
    (alpha - config.aoaOnsetDeg)
      / Math.max(config.aoaFullDeg - config.aoaOnsetDeg, 1e-3),
  )
  const gDemand = smooth01(
    (Math.abs(loadFactor) - config.gOnset)
      / Math.max(config.gFull - config.gOnset, 1e-3),
  )

  // Enough airflow to make a scheduled surface useful, with high-speed relief to avoid
  // presenting a landing-flap silhouette in a fast pass. The floor keeps the visual FCS
  // response readable in a slow high-AoA manoeuvre without granting it aerodynamic power.
  const lowSpeed = MathUtils.lerp(
    config.lowSpeedScheduleFloor,
    1,
    smooth01(
      (state.speedKmh - config.lowSpeedKmh)
        / Math.max(config.fullScheduleKmh - config.lowSpeedKmh, 1),
    ),
  )
  const highSpeedRelief = MathUtils.lerp(
    1,
    config.highSpeedScheduleFloor,
    smooth01(
      (state.speedKmh - config.highSpeedReliefKmh)
        / Math.max(config.highSpeedFullReliefKmh - config.highSpeedReliefKmh, 1),
    ),
  )
  const speedSchedule = lowSpeed * highSpeedRelief

  const demand = (
    (pull * config.pitchWeight)
    + (aoaDemand * config.aoaWeight)
    + (gDemand * config.gWeight)
    + (state.highGBlend * config.highGWeight)
  ) * speedSchedule
  const limit = MathUtils.lerp(config.normalLimit, 1, state.highGBlend)
  const target = MathUtils.clamp(demand, 0, limit)

  const response = target > state.maneuverSurface
    ? config.engageResponse
    : config.releaseResponse
  state.maneuverSurface = approach(state.maneuverSurface, target, response, dt)

  // LE surfaces lead the schedule with AoA; trailing surfaces contribute less in normal
  // manoeuvring, so the aircraft never reads visually as if landing flaps were selected.
  const leadingTarget = MathUtils.clamp(
    target * MathUtils.lerp(config.leadingEdgeShare, 1, aoaDemand), 0, 1,
  )
  const trailingTarget = MathUtils.clamp(target * config.trailingEdgeShare, 0, 1)
  const flaperonTarget = MathUtils.clamp(
    target * MathUtils.lerp(config.flaperonShare, 1, state.highGBlend), 0, 1,
  )
  state.leadingEdgeDeflection = approach(
    state.leadingEdgeDeflection, leadingTarget, response, dt)
  state.trailingEdgeDeflection = approach(
    state.trailingEdgeDeflection, trailingTarget, response, dt)
  state.flaperonDeflection = approach(
    state.flaperonDeflection, flaperonTarget, response, dt)

  state.maneuverSurfaceEffectiveness = MathUtils.lerp(
    1,
    config.highAoAEffectivenessFloor,
    smooth01(
      (alpha - config.effectivenessLossOnsetDeg)
        / Math.max(config.effectivenessLossFullDeg - config.effectivenessLossOnsetDeg, 1e-3),
    ),
  )
}
