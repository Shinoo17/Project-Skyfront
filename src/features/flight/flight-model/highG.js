import { MathUtils } from 'three'

import { approach, smooth01 } from './math'
import { isControlledPsmPhase } from './psm'

/*
The High-G trigger, resolved to one continuous blend before any force is computed.

It is a request, an energy gate, and a first-order chase — nothing else. What the blend
then buys lives entirely inside the conventional envelope: a faster pitch rate, a higher G
ceiling, an alpha fence that stays below the stall, a quicker roll, and a much larger
induced-drag bill. It is deliberately never mixed into `envelopeOpen`, which is the only
door to post-stall authority. The W+S Extreme chord publishes `psmArm` separately when the
player intends to cross that door; a dedicated High-G action cannot do it by accident.

An armed PSM owns the pitch axis outright, so High-G stands down there rather than having
two assists bidding for the same axis. Releasing the chord/assist hands the blend straight
back on the same smooth chase everything else here uses.
*/
export function stepHighG(state, command, tuning, dt) {
  const highG = tuning.highGTurn
  if (!highG?.capable) {
    state.highGBlend = approach(state.highGBlend, 0, 5, dt)
    return
  }

  // Low energy is exactly where a turn stops being available, and exactly where an
  // ungated rate ceiling would start looking like a jet pivoting on the spot.
  const energy = MathUtils.lerp(
    highG.lowEnergyAuthority,
    1,
    smooth01(
      (state.speedKmh - highG.lowEnergyKmh)
        / Math.max(highG.fullEnergyKmh - highG.lowEnergyKmh, 1),
    ),
  )
  const psmOwnsPitch = isControlledPsmPhase(state.psmPhase) || state.psmPhase === 'recovery'
  const target = command.highG && !psmOwnsPitch ? energy : 0
  const response = target > state.highGBlend ? highG.engageResponse : highG.releaseResponse
  state.highGBlend = approach(state.highGBlend, target, response, dt)
}
