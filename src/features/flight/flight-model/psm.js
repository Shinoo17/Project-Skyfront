/*
Arcade post-stall intent as an explicit pilot-intent state machine, kept apart from the
aerodynamics that integrate around it. Nothing here writes orientation or velocity: the
phases decide which assists and which rate authority are available, and `stepFlight` still
integrates the nose and the flight path independently.
*/

import { MathUtils } from 'three'

import { approach, smooth01 } from './math'

function enterPsmPhase(state, phase) {
  if (state.psmPhase === phase) return
  state.psmPhase = phase
  state.psmElapsed = 0
}

const CONTROLLED_PSM_PHASES = new Set([
  'post-stall',
  'cobra-hold',
  'post-stall-flip',
  'post-stall-reversal',
])

export function isControlledPsmPhase(phase) {
  return CONTROLLED_PSM_PHASES.has(phase)
}

function selectPsmHoldPhase(state, psm) {
  const pitchTravel = MathUtils.euclideanModulo(Math.abs(state.psmPitchTravelDeg), 360)
  if (state.noseOffPathDeg >= psm.reversalMinNoseOffDeg
    && Math.abs(pitchTravel - 180) <= psm.reversalTravelWindowDeg
    && psm.supportsPSMReversal) return 'post-stall-reversal'
  if (pitchTravel >= psm.cobraHoldMinTravelDeg
    && pitchTravel <= psm.cobraHoldMaxTravelDeg) return 'cobra-hold'
  return 'post-stall'
}

/*
Arcade post-stall intent, kept separate from the aerodynamics below. The state machine only
decides which assists are available; orientation is still integrated from commanded body
rates and velocity is still integrated from forces. That preserves the useful Cobra split:
the nose may rotate while the green velocity vector keeps carrying the aircraft forward.
*/
export function stepPsmAssist(state, command, tuning, dt) {
  const psm = tuning.postStallAssist
  if (!psm?.capable) {
    state.psmPhase = 'normal'
    state.psmElapsed = 0
    state.psmBlend = approach(state.psmBlend, 0, 5, dt)
    state.psmEnvelopeBlend = approach(state.psmEnvelopeBlend, 0, 5, dt)
    state.psmCooldownRemaining = 0
    state.psmLevelWindow = 0
    state.psmLevelBlend = approach(state.psmLevelBlend, 0, 5, dt)
    return
  }

  const inEntryWindow = state.speedKmh >= psm.entryMinKmh
    && state.speedKmh <= psm.entryMaxKmh
  state.psmElapsed += dt
  state.psmCooldownRemaining = Math.max(0, state.psmCooldownRemaining - dt)

  const pitchUp = state.input.pitch >= psm.continuePitchThreshold
  const pitchDown = state.input.pitch <= psm.recoveryPitchThreshold
  const pitchReleased = Math.abs(state.input.pitch) <= psm.holdPitchThreshold
  const recovered = Math.abs(state.aoaDeg) <= psm.recoveryCompleteAoADeg
    && state.noseOffPathDeg <= psm.recoveryCompleteNoseOffDeg
  const poweredExit = (command.accelerate || command.afterburnerCommanded)
    && state.psmActiveElapsed >= psm.poweredExitMinActiveSeconds
    && Math.abs(state.psmPitchTravelDeg) >= psm.poweredExitMinTravelDeg
    && Math.abs(state.aoaDeg) <= psm.poweredExitAoADeg
    && state.noseOffPathDeg <= psm.poweredExitNoseOffDeg

  /*
  The rotation budget for one arm, and the whole of the anti-spam rule.

  `psmPitchTravelDeg` was previously zeroed only on entry from `high-aoa`, so a single arm
  bought unlimited flips: once travel had passed `flipEnterTravelDeg` the pitch-up branch
  below was satisfied forever, and the `recovery` fall-through re-entered the flip for free.
  The budget closes that. Spending it does not take the stick away — it hands the manoeuvre
  to the same assisted recovery a deliberate Pitch Down asks for, which is where the level
  magnet further down picks the nose up and puts it on the horizon.

  It is a latch, and it has to be. `psmPitchTravelDeg` keeps integrating through recovery, so
  the nose coming back round unwinds it below the threshold within a fraction of a second —
  a plain comparison would spend the budget and then hand it straight back.
  */
  if (Math.abs(state.psmPitchTravelDeg) >= psm.flipMaxTravelDeg) state.psmFlipSpent = true
  const flipBudgetSpent = state.psmFlipSpent

  // How far the nose has actually been brought round since recovery began, measured off the
  // same integrated travel the rotation budget reads. This is what separates a pitch-down the
  // player thought better of after a tenth of a second from one that has nearly finished.
  const wasRecovering = state.psmPhase === 'recovery'
  const recoveryProgressDeg = wasRecovering
    ? Math.abs(state.psmPitchTravelDeg - state.psmRecoveryEntryTravelDeg)
    : 0

  if (state.psmPhase === 'normal') {
    if (!command.psmArm) state.psmCanArm = true
    if (state.psmCanArm && command.psmArm && inEntryWindow
      && state.psmCooldownRemaining <= 0) {
      enterPsmPhase(state, 'high-aoa')
    }
  } else if (state.psmPhase === 'high-aoa') {
    if (!command.psmArm || !inEntryWindow) enterPsmPhase(state, 'normal')
    else if (state.input.pitch >= psm.triggerPitch) {
      state.psmCanArm = false
      state.psmActiveElapsed = 0
      state.psmPitchTravelDeg = 0
      enterPsmPhase(state, 'post-stall')
    }
  } else if (isControlledPsmPhase(state.psmPhase)) {
    state.psmActiveElapsed += dt

    // Pitch Down is the only control that requests assisted recovery. There is deliberately
    // no hold timer: releasing the stick asks the rate loop to stop, not the game to finish
    // the manoeuvre on the player's behalf. A spent rotation budget is the one other thing
    // that asks for it, and it asks for exactly the same thing rather than a special case.
    if (pitchDown || flipBudgetSpent) {
      enterPsmPhase(state, 'recovery')
    } else if (pitchUp && psm.supportsPSMFlip
      && (state.psmPhase === 'post-stall-flip'
        || state.psmPitchTravelDeg >= psm.flipEnterTravelDeg)) {
      enterPsmPhase(state, 'post-stall-flip')
    } else if (poweredExit) {
      enterPsmPhase(state, 'normal')
    } else if (pitchReleased) {
      enterPsmPhase(state, selectPsmHoldPhase(state, psm))
    }
  } else if (state.psmPhase === 'recovery') {
    if (recovered) {
      enterPsmPhase(state, 'normal')
    } else if (!pitchDown && !flipBudgetSpent
      && (pitchUp || recoveryProgressDeg < psm.holdInterruptTravelDeg)) {
      /*
      Letting go *early* holds the new attitude — that is the interrupt, and it stays. But it
      may only be offered while the recovery has not yet done its work.

      Without the travel term, any release at all handed the aircraft back to `cobra-hold`,
      where `psmHolding` suppresses the centred-stick alpha recovery and `holdWeathervaneFactor`
      removes the restoring moment. Alpha therefore stayed high, which kept the horizon magnet
      gated off, which left nothing at all working: a deliberate pitch-down flown for most of a
      second and then centred parked the jet at fifty degrees nose-high with no way down. That
      is the manoeuvre-does-not-finish complaint, in its worst form.

      A pull is still allowed to interrupt at any point, because pulling is an active request
      for the nose rather than the absence of one.
      */
      enterPsmPhase(state, pitchUp && psm.supportsPSMFlip
        ? 'post-stall-flip'
        : selectPsmHoldPhase(state, psm))
    }
  } else {
    enterPsmPhase(state, 'normal')
  }

  if (state.psmPhase === 'recovery' && !wasRecovering) {
    state.psmRecoveryEntryTravelDeg = state.psmPitchTravelDeg
  }

  const psmActive = isControlledPsmPhase(state.psmPhase) || state.psmPhase === 'recovery'
  if (!psmActive && state.psmWasActive) {
    // One arm has finished. The cooldown is deliberately not a refused input — `envelopeOpen`
    // simply stops being handed `psmBlend`, so a re-pull inside the window is a hard
    // conventional turn with its own fence and its own G ceiling, not a second free tumble.
    state.psmCooldownRemaining = psm.cooldownSeconds
    state.psmFlipSpent = false
  }
  state.psmWasActive = psmActive

  /*
  The speed re-gate the latch never had. Every limit PSM opens is justified by an airstream
  that has stopped being able to enforce anything, and that premise expires with speed —
  but `inEntryWindow` was only ever read on the way in. Fading the blend rather than dropping
  the phase keeps the hand-back smooth; `recovery` is included because recovery is precisely
  the nose-down, accelerating part of the manoeuvre.
  */
  const overspeedGate = 1 - smooth01(
    (state.speedKmh - psm.entryMaxKmh) / Math.max(psm.sustainFadeKmh, 1),
  )
  const target = psmActive ? overspeedGate : 0
  const response = target > state.psmBlend ? psm.engageResponse : psm.releaseResponse
  state.psmBlend = approach(state.psmBlend, target, response, dt)

  /*
  Two blends, because the assist and the licence are not the same thing.

  `psmBlend` is how much post-stall *help* is running — the recovery rate demand, the float,
  the damping, the authority the airframe keeps so it stays controllable while the nose comes
  back round. That has to survive the whole manoeuvre including its end.

  `psmEnvelopeBlend` is the pilot's licence to command post-stall rates, and it is the only
  one `envelopeOpen` reads. Separating them is what makes the rotation budget mean anything:
  handing a spent arm over to `recovery` moved the label but left the licence intact, so a
  held stick simply kept rotating under a different phase name. Withdrawing the licence
  instead returns the pitch ceiling to the conventional 58 deg/s against a recovery assist and
  a weathervane that are both still working, on the same first-order chase everything else
  here uses — the rotation runs down rather than stopping.
  */
  const envelopeTarget = psmActive && !state.psmFlipSpent ? overspeedGate : 0
  const envelopeResponse = envelopeTarget > state.psmEnvelopeBlend
    ? psm.engageResponse
    : psm.releaseResponse
  state.psmEnvelopeBlend = approach(
    state.psmEnvelopeBlend, envelopeTarget, envelopeResponse, dt)

  // How long the horizon magnet stays available after the manoeuvre. It is a window rather
  // than a phase so that it survives the hand-back to `normal` — the whole point is to be
  // there for the seconds *after* PSM lets go, when the nose is left somewhere untidy.
  state.psmLevelWindow = psmActive
    ? psm.levelWindowSeconds
    : Math.max(0, state.psmLevelWindow - dt)
  state.psmLevelBlend = approach(
    state.psmLevelBlend, state.psmLevelWindow > 0 ? 1 : 0, psm.levelResponse, dt)
}
