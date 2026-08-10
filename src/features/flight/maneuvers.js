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
level flight, and it has to finish there. The bot must fly the nose back into the five-degree
capture window itself; only there does the FCC ease the final error onto the horizon. A
script that releases outside that window leaves the aircraft climbing or diving exactly
where it was put, which is what a viewer reads as a manoeuvre abandoned halfway through.

`requires` gates a script on an aircraft manifest flag. The post-stall set is written for an
airframe with the nozzles: past the stall the surfaces have lost most of their authority and
vectoring is what is left holding the nose. It is no longer the whole story — with
`thrustVectorEffectiveness` forced to zero the Cobra still comes out, about eleven degrees
shallower — but it is the difference between a demonstration and a scrape.

Every number below was found by replaying these scripts through the flight model itself
rather than guessed, and three constraints shaped them:

  The Cobra is a race between two rates, and the pull has to win it quickly. Nose rate comes
  from surface authority (which follows dynamic pressure) plus vector authority (which
  follows thrust and does not care about airspeed at all). Path rate comes from lift, which
  scales with speed squared and collapses once the wing is properly past the stall. So the
  pull is short and hard: long enough to throw the nose through the stall and out the far
  side, and no longer, because every extra tenth with the wing still flying is a tenth of a
  loop being drawn. Enter fast instead and lift never lets go — that is the post-stall
  script, the same pull with the energy to carry the flight path round with it.

  Maneuver Assist is the arcade PSM consent control. Pulling while it is held opens the
  aircraft-configured high-AoA envelope without also changing the power setting. A normal
  pull remains behind the protected conventional fence, which keeps the Split-S and
  Immelmann conventional even when they pass through the same airspeeds as the Cobra.

  The other flight action, `high-g`, is available to these scripts on exactly the same
  terms — it is a semantic action, so a step holds it the way it holds a stick axis — and it
  is deliberately absent from every script below. It buys a tighter conventional turn at a
  steep energy price and reaches nothing post-stall, so it is the wrong control for the
  manoeuvres here and the right one for a scripted hard turn if one is ever added.

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
      'Slow, then a short, violent pull held against the stops, with no reheat anywhere in '
      + 'it. The nose goes past the vertical while the flight path carries straight on, the '
      + 'wing stops flying, drag does the braking — and it comes back to the attitude, the '
      + 'height and the speed it started at.',
    exitsLevel: true,
    entry: { throttle: THROTTLE_SLOW, settleSeconds: 1.5 },
    steps: [
      { seconds: 0.25, hold: ['maneuver-assist'], label: 'PSM READY' },
      { seconds: 0.7, hold: ['maneuver-assist', 'pitch-up'], label: 'PULL' },
      { seconds: 0.65, hold: ['throttle-up'], label: 'HANG / POWER' },
      // The player PSM rate is now slower and stops closer to the beam, so recovery needs a
      // shorter forward-stick sweep to avoid carrying the nose below the horizon.
      { seconds: 0.75, hold: ['throttle-up', 'pitch-down'], label: 'NOSE DOWN' },
      { seconds: 1.4, hold: ['throttle-up'], label: 'RECOVER' },
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
      { seconds: 0.25, hold: ['maneuver-assist'], label: 'PSM READY' },
      { seconds: 0.8, hold: ['pitch-up', 'yaw-right', 'maneuver-assist'], label: 'PULL' },
      // The stick comes forward of the pull. The nose is already across the flight path, and
      // holding aft stick on top of the pedal drives the alpha past 120 degrees and departs
      // the jet rather than swinging it.
      { seconds: 1.0, hold: ['yaw-right', 'throttle-up'], label: 'PEDAL IN' },
      // Recovery is deliberately rate-limited, so keep the stick forward through the smooth
      // sweep instead of relying on a short pulse to snap the nose back onto the flight path.
      { seconds: 0.95, hold: ['pitch-down', 'throttle-up'], label: 'UNLOAD' },
      { seconds: 1.15, hold: [], label: 'RECOVER' },
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
      { seconds: 2.2, hold: [], axes: { pitch: 0.72 }, label: 'ZOOM' },
      { seconds: 1.8, hold: ['yaw-right', 'afterburner'], label: 'PEDAL' },
      { seconds: 0.7, hold: [], axes: { pitch: -0.25 }, label: 'LEVEL OFF' },
      // The jet comes out of the pedal turn at about 340 km/h, and at that energy the nose
      // keeps falling on its own — the FCC damps rate, it does not hold an attitude. A
      // little back stick on the way out is what a pilot would be doing anyway.
      { seconds: 1.0, hold: [], axes: { pitch: 0.62 }, label: 'SETTLE' },
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
    // Between THROTTLE_LOW and THROTTLE_MIL, and it has to be: the band this script is
    // demonstrating is the one where the wing is still strong enough to drag the flight
    // path round after a stalled nose. Enter it at 550 and the pull stops being a pull
    // through and becomes a Cobra that runs out of airspeed at the top; enter it at 645
    // and the lift never lets the alpha past the stall at all.
    entry: { throttle: 0.235, settleSeconds: 2.5 },
    steps: [
      { seconds: 0.25, hold: ['maneuver-assist'], label: 'PSM READY' },
      { seconds: 1.0, hold: ['maneuver-assist'], axes: { pitch: 0.82 }, label: 'PULL' },
      { seconds: 0.3, hold: ['throttle-up'], label: 'HOLD ALPHA' },
      { seconds: 0.85, hold: ['pitch-down', 'throttle-up'], label: 'RECOVER AOA' },
      { seconds: 1.0, hold: ['throttle-up'], label: 'REATTACH' },
      { seconds: 0.35, hold: ['pitch-down', 'throttle-up'], label: 'LEVEL FLIGHT' },
      { seconds: 0.85, hold: ['throttle-up'], label: 'SETTLE' },
    ],
  },

  {
    id: 'tumble',
    name: 'Tumble (Kulbit)',
    expect: 'tumble',
    requires: 'thrustVectoring',
    brief:
      'The Cobra that does not stop. The stick stays against the stops and the nose keeps '
      + 'going over the top, all the way round past the tail, while the flight path runs on '
      + 'underneath — then roll the airframe to pick an exit, and pull out of it pointing '
      + 'somewhere new.',
    // Deliberately not `exitsLevel`. The pull-out is flown against whatever attitude the
    // rotation happened to stop at, and holding it to the same five-degree capture window
    // as a Cobra would mean tuning the recovery to a pose that is the point of the
    // manoeuvre being unpredictable.
    entry: { throttle: THROTTLE_LOW, settleSeconds: 2.0 },
    steps: [
      { seconds: 0.25, hold: ['maneuver-assist'], label: 'PSM READY' },
      // Long enough to carry the nose past the beam and round; the airstream's restoring
      // moment is at a quarter strength for as long as this stick is held, and full again
      // the instant it is not.
      { seconds: 1.45, hold: ['pitch-up', 'afterburner', 'maneuver-assist'], label: 'FLIP' },
      // Roll while the wing is still stalled — the part the airframe could not do at all
      // before the engines were given a say in it, and the part that turns the tumble from
      // a trick into a way of leaving in a chosen direction.
      { seconds: 0.6, hold: ['roll-right', 'afterburner'], label: 'ROLL' },
      { seconds: 0.5, hold: ['pitch-up', 'afterburner'], label: 'PULL OUT' },
      { seconds: 1.6, hold: ['throttle-up'], label: 'RECOVER' },
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
      { seconds: 3.05, hold: ['pitch-up'], label: 'PULL THROUGH' },
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
      { seconds: 3.0, hold: ['roll-right'], label: 'ROLL' },
      { seconds: 1.0, hold: [], axes: { pitch: 0.14 }, label: 'LEVEL' },
      { seconds: 0.6, hold: [], label: 'SETTLE' },
    ],
  },

  {
    id: 'barrel-roll',
    name: 'Barrel roll',
    brief: 'Roll and back stick together: a helix around the flight path, loaded the whole way.',
    exitsLevel: true,
    entry: { throttle: THROTTLE_FAST, settleSeconds: 2.0 },
    steps: [
      { seconds: 3.75, hold: ['roll-right', 'pitch-up'], label: 'ROLL THROUGH' },
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
      { seconds: 1.8, hold: ['afterburner'], axes: { pitch: 0.72 }, label: 'CLIMB' },
      { seconds: 0.5, hold: ['afterburner'], label: 'EASE' },
      { seconds: 1.5, hold: ['roll-right', 'afterburner'], label: 'ROLL INVERTED' },
      { seconds: 1.45, hold: ['afterburner'], axes: { pitch: 0.82 }, label: 'PULL THROUGH' },
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
      // A little shorter than it was: 645 km/h is inside the top of the thin-air window, so
      // even this three-quarter pull now buys a slightly higher nose rate and the half loop
      // closes sooner.
      { seconds: 3.65, hold: ['afterburner'], axes: { pitch: 0.82 }, label: 'PULL UP' },
      { seconds: 1.5, hold: ['roll-right'], label: 'ROLL UPRIGHT' },
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
