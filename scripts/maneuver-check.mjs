/*
Replays every demonstration script in `src/features/flight/maneuvers.js` through the real
flight model, headless, and checks two things per script:

  1. The flight model reports the regime the script claims, and holds it — for MATCH_SECONDS
     at least, the same bar the demonstration panel's tick is drawn at. `expect` is an
     assertion about the airframe, not an instruction — nothing forces the label, so this is
     the only thing that can tell you a Cobra script still produces a Cobra after a tuning
     change. A frame or two of the right label is a script clipping the regime on its way
     past, not flying it.
  2. A script claiming a post-stall regime leaves the flight path alone: the trajectory may
     not swing more than MAX_PATH_TURN from where it entered. This is the check that would
     have caught a Cobra script quietly turning into a loop — the attitudes and the AoA of a
     hard enough pull look identical, and only the flight path tells them apart.
  3. A script marked `exitsLevel` finishes with the nose within MAX_EXIT_PITCH of the
     horizon. Every one of them starts from level flight, so every one of them has to end
     there; nothing in the flight model levels the nose on its own, and a script that stops
     with forty degrees still on the clock leaves the aircraft climbing away from a
     manoeuvre it never finished.
  4. Nothing descends more than MAX_DIP below the spawn. The range resets a sortie below 9
     units of ground clearance and the spawn clears the highest ground by 58, so a script
     that stays inside this margin is safe over any terrain the map registry can load.

It imports the same modules the browser does, at the same fixed step, with the same command
shape the flight loop builds — the physics here is not a model of the game, it is the game's.

  npm run maneuver-check              every script, one line each
  npm run maneuver-check -- cobra     one script, sampled trace
  npm run maneuver-check -- all 400   every script from a 400-unit spawn

Exits non-zero on any failure, so it can gate a change to the envelope.
*/

import { Vector3 } from 'three'

import f22 from '../src/aircraft/f22.js'
import {
  FLIGHT_FIXED_STEP,
  createFlightState,
  resetFlightState,
  stepFlight,
} from '../src/features/flight/flightModel.js'
import MANEUVERS, { readManeuverSeconds } from '../src/features/flight/maneuvers.js'
import {
  createAfterburnerState,
  readTargetAirspeedKmh,
  stepAfterburner,
} from '../src/features/flight/performance.js'
import {
  readAfterburnerCommand,
  readAirBrake,
  readAxes,
  readHighAoA,
  readThrottleDirection,
} from '../src/features/flight/useFlightControls.js'

const FRAME = 1 / 60
const MAX_DIP = 40
// Kept in step with ManeuverBot's own constant: the panel and this gate should not be able
// to disagree about whether a run counted.
const MATCH_SECONDS = 0.6
// How far the flight path may swing for a manoeuvre that is supposed to leave it alone.
// A loop entered on the same stick reaches 150 degrees and more.
const MAX_PATH_TURN = 55
const PATH_HELD = new Set(['cobra', 'j-turn'])
// A script marked `exitsLevel` has to put the nose back where it found it. Nothing in the
// FCC levels the nose on its own — the wings-leveller is roll only — so returning to level
// is something the script flies, and if it stops short the jet climbs or dives away for
// the rest of the demonstration.
const MAX_EXIT_PITCH = 8

const envelope = f22.flight.envelope
const [only = 'all', spawnArg] = process.argv.slice(2)

/*
The altitude the range actually spawns a sortie at. `useRangeMetrics` takes the greater of
the map's `minAltitude` and its *measured* terrain height plus `clearance` — and the
measurement comes from the loaded GLB's bounding box, which this script cannot do without a
GL context. So this is an observed number, read off the dev observer page on the mountain
valley, not a derived one: if the terrain, the map's `span`, or the GLB changes, it moves,
and so does everything calibrated against it.

It matters far more than an altitude usually would. `highAltitude.worldUnits` is 800, so a
spawn above it sits in the high-altitude performance band where the dry limit is 2230 km/h
rather than 1100 — the same throttle holds a couple of hundred km/h more than it does low
down, which is the difference between a Cobra and a loop. The scripts are calibrated for
this band. Pass a spawn to check another one:

  npm run maneuver-check -- all 250     the low band; the post-stall scripts do not hold

If a new map spawns materially below 800, its scripts need their own entry throttles.
*/
const OBSERVED_SPAWN_Y = 815
const SPAWN_Y = Number(spawnArg ?? OBSERVED_SPAWN_Y)

// One scripted run. Mirrors FlightAircraft's useFrame body: cap the frame, read the held
// controls, step the burner, then integrate the model at its own fixed step.
function fly(timeline, { throttle: entryThrottle, onSample }) {
  const state = createFlightState()
  const reheat = createAfterburnerState()
  let throttle = entryThrottle

  resetFlightState(
    state,
    new Vector3(-260, SPAWN_Y, 0),
    readTargetAirspeedKmh(throttle, SPAWN_Y, 0, envelope),
    envelope,
    throttle,
  )

  const seen = new Set()
  const stats = {
    peakAoA: 0,
    peakBeta: 0,
    peakNoseUp: -90,
    minSpeed: Infinity,
    maxSpeed: 0,
    minY: Infinity,
    maxG: 0,
    maxYawRate: 0,
    rotation: 0,
    pathTurn: 0,
  }
  let accumulator = 0
  let previousUp = null
  let entryPath = null
  let clock = 0

  for (const step of timeline) {
    const pressed = new Set(step.hold)
    for (let frame = 0; frame < Math.round(step.seconds / FRAME); frame += 1) {
      const input = readAxes(pressed)
      throttle = Math.min(1, Math.max(
        envelope.minThrottle,
        throttle + (readThrottleDirection(pressed) * FRAME * envelope.throttleRate),
      ))
      const burnerRequested = readAfterburnerCommand(pressed)
      const burner = stepAfterburner(
        reheat,
        {
          commanded: burnerRequested
            && state.engineCoreLevel >= envelope.afterburner.ignitionCorePower,
          step: FRAME,
        },
        envelope,
      )

      accumulator += FRAME
      while (accumulator >= FLIGHT_FIXED_STEP) {
        stepFlight(state, {
          pitch: input.pitch,
          roll: input.roll,
          yaw: input.yaw,
          flaps: input.flaps,
          throttle,
          airBrake: readAirBrake(pressed),
          highAoA: readHighAoA(pressed),
          afterburnerCommanded: burnerRequested,
          burnerLevel: burner.level,
        }, envelope, FLIGHT_FIXED_STEP)
        accumulator -= FLIGHT_FIXED_STEP
      }
      clock += FRAME

      const forward = new Vector3(1, 0, 0).applyQuaternion(state.orientation)
      const up = new Vector3(0, 1, 0).applyQuaternion(state.orientation)
      // asin folds back once the nose passes vertical, which is exactly what a Cobra does;
      // total rotation below is the unambiguous measure of how far the airframe went round.
      const noseUp = (Math.asin(Math.max(-1, Math.min(1, forward.y))) * 180) / Math.PI

      seen.add(state.maneuver)
      // Where it ends up, not just how far it went. A manoeuvre that starts level and
      // leaves the jet climbing away at forty degrees has not been flown, it has been
      // abandoned partway through.
      stats.exitNose = noseUp
      stats.exitDy = state.position.y - SPAWN_Y
      stats.exitKmh = state.speedKmh
      stats.peakAoA = Math.max(stats.peakAoA, Math.abs(state.aoaDeg))
      stats.peakBeta = Math.max(stats.peakBeta, Math.abs(state.sideslipDeg))
      stats.peakNoseUp = Math.max(stats.peakNoseUp, noseUp)
      stats.minSpeed = Math.min(stats.minSpeed, state.speedKmh)
      stats.maxSpeed = Math.max(stats.maxSpeed, state.speedKmh)
      stats.minY = Math.min(stats.minY, state.position.y)
      stats.maxG = Math.max(stats.maxG, Math.abs(state.gLoad))
      stats.maxYawRate = Math.max(
        stats.maxYawRate,
        Math.abs((state.angularVelocity.y * 180) / Math.PI),
      )
      if (previousUp) stats.rotation += previousUp.angleTo(up) * (180 / Math.PI)
      previousUp = up

      // Where the aircraft was going when the script stopped settling and started flying,
      // and how far it has been taken from it since. Total rotation above measures the
      // airframe; this measures the trajectory, and a Cobra is the difference.
      const path = state.velocity.clone().normalize()
      if (!entryPath && step.label !== 'SETTLE') entryPath = path.clone()
      if (entryPath) {
        stats.pathTurn = Math.max(stats.pathTurn, entryPath.angleTo(path) * (180 / Math.PI))
      }

      onSample?.(clock, step, state, noseUp)
    }
  }

  stats.dip = SPAWN_Y - stats.minY
  return { seen, stats }
}

const pad = (value, width, digits = 0) => value.toFixed(digits).padStart(width)
let failures = 0

for (const maneuver of MANEUVERS) {
  if (only !== 'all' && maneuver.id !== only) continue

  const timeline = [
    { seconds: maneuver.entry.settleSeconds, hold: [], label: 'SETTLE' },
    ...maneuver.steps,
  ]
  const trace = only !== 'all'
  let matchedSeconds = 0

  const { seen, stats } = fly(timeline, {
    throttle: maneuver.entry.throttle,
    onSample: (clock, step, state, noseUp) => {
      if (state.maneuver === maneuver.expect) matchedSeconds += FRAME
      if (!trace || Math.round(clock * 60) % 12) return
      console.log(
        `  ${pad(clock, 5, 1)}s ${String(step.label).padEnd(14)}`
        + ` aoa=${pad(state.aoaDeg, 4)} beta=${pad(state.sideslipDeg, 4)}`
        + ` nose=${pad(noseUp, 4)} kmh=${pad(state.speedKmh, 4)}`
        + ` y=${pad(state.position.y, 5)} ${state.maneuver}`,
      )
    },
  })

  const labelOk = !maneuver.expect || (
    seen.has(maneuver.expect) && matchedSeconds + (FRAME / 2) >= MATCH_SECONDS
  )
  const floorOk = stats.dip <= MAX_DIP
  const pathOk = !PATH_HELD.has(maneuver.expect) || stats.pathTurn <= MAX_PATH_TURN
  const levelOk = !maneuver.exitsLevel || Math.abs(stats.exitNose) <= MAX_EXIT_PITCH
  if (!labelOk || !floorOk || !pathOk || !levelOk) failures += 1

  console.log(
    `${labelOk && floorOk && pathOk && levelOk ? 'PASS' : 'FAIL'} ${maneuver.id.padEnd(13)}`
    + ` want=${String(maneuver.expect ?? '—').padEnd(11)}`
    + ` held=${pad(matchedSeconds, 4, 1)}s${labelOk ? ' ' : '!'}`
    + ` aoa=${pad(stats.peakAoA, 3)} beta=${pad(stats.peakBeta, 3)}`
    + ` nose=${pad(stats.peakNoseUp, 3)} yaw=${pad(stats.maxYawRate, 3)}`
    + ` kmh=${pad(stats.minSpeed, 4)}..${pad(stats.maxSpeed, 4)}`
    + ` dip=${pad(stats.dip, 3)}${floorOk ? ' ' : '!'}`
    + ` g=${pad(stats.maxG, 4, 1)} rot=${pad(stats.rotation, 4)}`
    + ` path=${pad(stats.pathTurn, 4)}${pathOk ? ' ' : '!'}`
    + ` exit=${pad(stats.exitNose, 4)}°${levelOk ? ' ' : '!'}`
    + `${pad(stats.exitDy, 4)}y ${pad(stats.exitKmh, 4)}kmh`
    + ` ${pad(readManeuverSeconds(maneuver), 5, 1)}s`,
  )
}

console.log(`\nspawn y=${SPAWN_Y}, floor margin ${MAX_DIP} — ${failures} failing`)
process.exit(failures ? 1 : 0)
