/*
Scripted demonstrations, written in the same controls a pilot holds.

A script is a throttle to enter on and a list of steps, each one a duration and the set of
held controls — the exact strings in `FLIGHT_BINDINGS`. Nothing here talks to the flight
model: the bot that runs these writes into the same `pressed` set the keyboard writes into,
so a demonstration is subject to every limiter, every authority curve and every energy cost
the pilot is. If a script stops working after a tuning change, that is the point of it.

`expect` names the regime `detectManeuver` in the flight model should report while the
script runs. It is an assertion the panel shows a tick or a cross for, not an instruction —
nothing anywhere forces the label, so a cross means the airframe did not actually do it.

`exitsLevel` says the script has to give the jet back the way it found it: it starts from
level flight, and it has to finish there. Nothing in the FCC will do it for you — the
wings-leveller is roll only, and there is no attitude hold anywhere — so every script ends
with a LEVEL OFF step that flies the nose the last few degrees onto the horizon and then a
release to let it settle. Without one the demonstration simply stops partway through and
leaves the aircraft climbing or diving away for good, which is what a viewer reads as the
manoeuvre being wrong even when the interesting part of it was right.

`requires` gates a script on an aircraft manifest flag. The post-stall set is written for an
airframe with the nozzles: past the stall the surfaces have lost most of their authority and
vectoring is what is left holding the nose. It is no longer the whole story — with
`thrustVectorEffectiveness` forced to zero the Cobra still comes out, about eleven degrees
shallower — but it is the difference between a demonstration and a scrape.

Every number below was found by replaying these scripts through the flight model itself
rather than guessed, and three constraints shaped them:

  The Cobra is a race between two rates, and the pull has to win it quickly. Nose rate comes
  from surface authority (which scales with speed) plus vector authority (which scales with
  thrust). Path rate comes from lift, which scales with speed squared and collapses once the
  wing is properly past the stall. So the pull is short and hard: long enough to throw the
  nose through the stall and out the far side, and no longer, because every extra tenth with
  the wing still flying is a tenth of a loop being drawn. Enter fast instead and lift never
  lets go — that is the post-stall script, the same pull with the energy to carry the flight
  path round with it.

  Reheat goes in on the way out, never into the pull. Holding it drives the core through the
  MIL detent before the burner lights, so the slow entry trim remains intact until the script
  deliberately asks for combat power. It is worth the thrust once the nose is coming back
  down and the manoeuvre wants its energy back.

  Nothing may descend more than about 40 units below the spawn. The spawn clears the highest
  ground by `map.spawn.clearance` (58) and the range resets a sortie below 9 units of ground
  clearance, so 40 is the margin that holds over any terrain the registry can load. Loops and
  the Split-S are entered slow, or from a climb, for exactly that reason.

These are calibrated for one altitude band, and it is the band the only shipped map spawns
in — the mountain valley measures out at about 815, above the 800 where the performance
table switches to its high-altitude limits. A map that spawns materially below that holds a
couple of hundred km/h less on the same throttle, and the post-stall scripts stop working:
`npm run maneuver-check -- all 250` shows exactly how. A new map that spawns low needs its
own entry throttles, not these.
*/

/*
Throttle settings, named by the airspeed they hold at demonstration altitude:

  power = (throttle - minThrottle) / (1 - minThrottle)

The performance model turns that setting into dry thrust and balances it against drag; the
speeds below are the resulting trims rather than a direct throttle-to-speed interpolation.

`dryLimit` is the part that bites. It runs from 1100 km/h at sea level to 2230 above
`highAltitude.worldUnits` (800), and the range spawns a sortie at whatever clears the
terrain — about 815 on the mountain valley, which is over that line. So these are computed
against the high-altitude limit, not the sea-level one. Read at 250 units the same numbers
come out roughly 200 km/h slower, which is the sort of error that turns a Cobra into a loop.
*/
const THROTTLE_SLOW = 0.18 // ~475 km/h
const THROTTLE_LOW = 0.215 // ~550 km/h
const THROTTLE_MIL = 0.26 // ~645 km/h
const THROTTLE_FAST = 0.328 // ~790 km/h

const MANEUVERS = [
  {
    id: 'cobra',
    name: 'Pugachev’s Cobra',
    expect: 'cobra',
    requires: 'thrustVectoring',
    brief:
      'Slow, then a short, violent pull with the limiter relaxed, and no reheat anywhere in '
      + 'it. The nose goes past the vertical while the flight path carries straight on, the '
      + 'wing stops flying, drag does the braking — and it comes back to the attitude, the '
      + 'height and the speed it started at.',
    exitsLevel: true,
    entry: { throttle: THROTTLE_SLOW, settleSeconds: 1.5 },
    steps: [
      // Short. The pull only has to beat the flight path to deep AoA; held any longer it
      // stops being a pull and starts being the first quarter of a loop.
      { seconds: 0.85, hold: ['high-aoa', 'pitch-up'], label: 'PULL' },
      { seconds: 1.0, hold: ['high-aoa'], label: 'HANG' },
      // Long enough to fly the nose all the way back down through level, because nothing
      // else will: the FCC levels the wings but never the nose, so a push that stops at
      // forty degrees leaves the jet climbing away from the manoeuvre for good.
      { seconds: 2.8, hold: ['pitch-down'], label: 'NOSE DOWN' },
      { seconds: 0.5, hold: ['pitch-up'], label: 'LEVEL OFF' },
      // No reheat on the way out either. The dive off the top pays the airspeed back while
      // the low dry-power setting keeps the recovery from running away past entry energy.
      { seconds: 3.2, hold: [], label: 'RECOVER' },
    ],
  },

  {
    id: 'j-turn',
    name: 'J-turn (Herbst)',
    expect: 'j-turn',
    requires: 'thrustVectoring',
    brief:
      'A Cobra with the pedal in: the nose swings across the flight path in yaw as well as '
      + 'pitch, and the jet comes out pointing somewhere it never flew.',
    exitsLevel: true,
    entry: { throttle: THROTTLE_SLOW, settleSeconds: 2.5 },
    steps: [
      { seconds: 0.6, hold: ['pitch-up', 'throttle-up'], label: 'ZOOM' },
      { seconds: 0.85, hold: ['high-aoa', 'pitch-up', 'yaw-right', 'throttle-up'], label: 'PULL' },
      // The stick comes forward of the pull but the High-AoA switch stays in: the nose is
      // already across the flight path, and holding aft stick on top of the pedal drives
      // the alpha past 120 degrees and departs the jet rather than swinging it.
      { seconds: 3.3, hold: ['high-aoa', 'yaw-right', 'throttle-up'], label: 'PEDAL IN' },
      { seconds: 1.0, hold: ['pitch-down', 'throttle-up'], label: 'UNLOAD' },
      { seconds: 0.8, hold: ['pitch-up'], label: 'LEVEL OFF' },
      { seconds: 1.0, hold: [], label: 'RECOVER' },
    ],
  },

  {
    id: 'pedal-turn',
    name: 'Pedal turn',
    expect: 'pedal-turn',
    requires: 'thrustVectoring',
    brief:
      'Zoom until the nose is near vertical and the speed has gone, then pedal. The rudders '
      + 'have nothing left to bite; the nozzles pivot the jet about its own vertical.',
    exitsLevel: true,
    entry: { throttle: THROTTLE_LOW, settleSeconds: 2.2 },
    steps: [
      { seconds: 2.2, hold: ['pitch-up'], label: 'ZOOM' },
      { seconds: 4.0, hold: ['high-aoa', 'yaw-right', 'afterburner'], label: 'PEDAL' },
      { seconds: 0.4, hold: ['pitch-down'], label: 'NOSE DOWN' },
      { seconds: 0.6, hold: [], label: 'SETTLE' },
      { seconds: 0.5, hold: ['pitch-up'], label: 'LEVEL OFF' },
    ],
  },

  {
    id: 'post-stall',
    name: 'Post-stall pass',
    expect: 'post-stall',
    requires: 'thrustVectoring',
    brief:
      'The Cobra pull entered with the energy to loop instead. The nose still goes past the '
      + 'stall, but at this speed the wing has enough left to drag the flight path round '
      + 'after it — a stalled, seven-G pull through, and not a Cobra.',
    exitsLevel: true,
    entry: { throttle: THROTTLE_MIL, settleSeconds: 2.5 },
    steps: [
      { seconds: 1.2, hold: ['high-aoa', 'pitch-up', 'afterburner'], label: 'PULL' },
      { seconds: 1.4, hold: ['high-aoa', 'afterburner'], label: 'HOLD ALPHA' },
      { seconds: 3.2, hold: ['pitch-down', 'throttle-up'], label: 'UNLOAD' },
      { seconds: 0.4, hold: ['pitch-down'], label: 'LEVEL OFF' },
      { seconds: 2.4, hold: [], label: 'RECOVER' },
      { seconds: 0.5, hold: ['pitch-up'], label: 'CAPTURE' },
    ],
  },

  {
    id: 'loop',
    name: 'Inside loop',
    brief:
      'The plain one, and the reference the others are read against. A short powered pull '
      + 'carries it over the top; the burner comes out before the downhill half.',
    exitsLevel: true,
    entry: { throttle: THROTTLE_FAST, settleSeconds: 2.0 },
    steps: [
      { seconds: 3.0, hold: ['pitch-up', 'afterburner'], label: 'POWER UP' },
      { seconds: 4.2, hold: ['pitch-up'], label: 'PULL THROUGH' },
      { seconds: 0.18, hold: ['pitch-up'], label: 'LEVEL OFF' },
      { seconds: 1.6, hold: [], label: 'RECOVER' },
    ],
  },

  {
    id: 'aileron-roll',
    name: 'Aileron roll',
    brief: 'Pure roll rate, stick centred in pitch — the jet corkscrews along its flight path.',
    exitsLevel: true,
    entry: { throttle: THROTTLE_FAST, settleSeconds: 2.0 },
    steps: [
      { seconds: 3.2, hold: ['roll-right'], label: 'ROLL' },
      { seconds: 1.6, hold: [], label: 'LEVEL' },
    ],
  },

  {
    id: 'barrel-roll',
    name: 'Barrel roll',
    brief: 'Roll and back stick together: a helix around the flight path, loaded the whole way.',
    exitsLevel: true,
    entry: { throttle: THROTTLE_FAST, settleSeconds: 2.0 },
    steps: [
      { seconds: 4.0, hold: ['roll-right', 'pitch-up'], label: 'ROLL THROUGH' },
      { seconds: 0.4, hold: ['pitch-down'], label: 'LEVEL OFF' },
      { seconds: 2.4, hold: [], label: 'RECOVER' },
    ],
  },

  {
    id: 'split-s',
    name: 'Split-S',
    brief:
      'Climb for the room it will need, half roll onto the back, then pull through the '
      + 'bottom half of a loop and come out reversed.',
    exitsLevel: true,
    entry: { throttle: THROTTLE_LOW, settleSeconds: 2.0 },
    steps: [
      { seconds: 1.8, hold: ['pitch-up', 'afterburner'], label: 'CLIMB' },
      { seconds: 2.0, hold: ['afterburner'], label: 'EASE' },
      { seconds: 1.4, hold: ['roll-right', 'afterburner'], label: 'ROLL INVERTED' },
      { seconds: 1.5, hold: ['pitch-up', 'afterburner'], label: 'POWER THROUGH' },
      { seconds: 4.2, hold: ['pitch-up'], label: 'PULL THROUGH' },
      { seconds: 0.4, hold: ['pitch-down'], label: 'LEVEL OFF' },
      { seconds: 1.6, hold: [], label: 'RECOVER' },
    ],
  },

  {
    id: 'immelmann',
    name: 'Immelmann',
    brief: 'Half a loop up, then half a roll upright — height traded for a reversal.',
    exitsLevel: true,
    entry: { throttle: THROTTLE_MIL, settleSeconds: 2.0 },
    steps: [
      { seconds: 3.0, hold: ['pitch-up', 'afterburner'], label: 'PULL UP' },
      { seconds: 1.5, hold: ['roll-right'], label: 'ROLL UPRIGHT' },
      { seconds: 0.8, hold: ['pitch-down'], label: 'LEVEL OFF' },
      { seconds: 2.4, hold: [], label: 'RECOVER' },
    ],
  },
]

export default MANEUVERS

export function listManeuvers(aircraft) {
  return MANEUVERS.filter((maneuver) => !maneuver.requires || aircraft?.[maneuver.requires])
}

export function getManeuver(id) {
  return MANEUVERS.find((maneuver) => maneuver.id === id) ?? null
}

// Total scripted time, entry settle included — what the panel draws its progress bar over.
export function readManeuverSeconds(maneuver) {
  return maneuver.entry.settleSeconds
    + maneuver.steps.reduce((total, step) => total + step.seconds, 0)
}
