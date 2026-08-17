# Roadmap

Where this is going: combat. Offline against bots, online against people, hosted on
Cloudflare with the models served from R2.

The order below is not a wish list — it is a dependency chain. Milestone 0 is a refactor
with no feature attached to it, and it is first because every milestone after it is
cheaper on the far side and a rewrite on the near side. Everything from Weapons onward
assumes it has landed.

The old version of this file said to lift shared code out only "once a second consumer
exists — do it then, not before". That advice was right for a dogfight route and wrong for
a server: an authoritative host is a second consumer that cannot be added afterwards,
because it is the one consumer that cannot import React. Hence the deviation.

## Where things live today

```
src/
  App.jsx                 route table + shell class, nothing else
  routes/                 one file per URL. paths.js is the single source of route paths
  features/viewer/        the studio surface: Scene, Interface, control panel
  features/flight-range/  the sortie: HUD, pause menu, units, audio setting
  features/flight/        input, flight model, chase camera, bot, VFX
  features/world/         terrain, range metrics, map environment
  features/dev-flight/    the observer page and the manoeuvre bench
  aircraft/ maps/ weapons/  one manifest per thing + the registry beside it
  three/                  renderer-level helpers: ktx2, hinge, pose, graphics
  ui/                     chrome shared across routes: Topbar, LoaderScreen, fullscreen
scripts/                  headless checks — they import the flight model straight into Node
```

Adding a surface means a file in `routes/`, a path in `routes/paths.js`, and a folder in
`features/`. Adding an airframe, a range, or a weapon means a file in `aircraft/`, `maps/`,
or `weapons/` listed in the `index.js` beside it — no surface should ever name a `.glb` or
a mesh again.

## What already carries its weight

Three things were built for one aircraft and turn out to be built for many. They are the
reason this roadmap is additive rather than a rewrite.

- **The flight model is already headless.** `stepFlight(state, command, envelope, dt)` in
  [src/features/flight/flight-model/step.js](src/features/flight/flight-model/step.js) is
  a pure function over a plain state object, and seven of the ten headless checks in
  `scripts/` import it straight into Node to prove it. The same function can run on a
  server without a single edit.
- **The bot already flies through the pilot's input layer.**
  [ManeuverBot](src/features/flight/ManeuverBot.jsx) writes
  `setAnalogFlightInput(controls, 'maneuver-bot', axes)` and holds the same named controls
  a keyboard does. It has no privileged path into the model. A combat AI is therefore a
  new brain writing into the same ref, not a second physics implementation.
- **Input and telemetry are refs, not state.** `useFlightControls` says so out loud: "a
  dogfight will read two of these per frame". A 60 Hz range renders React zero times a
  second, and that property survives ten aircraft unchanged.

## 0. The split everything else needs

*~1–1.5 weeks. No new feature ships at the end of it.*

Five seams, in order of what they unlock per hour spent.

**0.1 — A reset is a death, so make it an event.**
[FlightAircraft.jsx:352-364](src/features/flight/FlightAircraft.jsx#L352-L364) works out
`resetCause` and calls `resetFlight` on the next line. In every mode below, hitting the
terrain is a *scoring event*: someone gets credited, a respawn timer starts, a team spawn
is chosen. The aircraft must report that it died and let something above it decide what
that means. This is the cheapest change in the chain and the one that makes modes
attachable at all.

**0.2 — Separate the simulation from the view.**
[FlightAircraft.jsx](src/features/flight/FlightAircraft.jsx) is 527 lines holding the
flight model, the chase camera, the terrain probe, the reset ladder, the VFX, and about a
hundred lines of telemetry publishing. Split it: a headless `sim/entities/aircraft.js` that
owns state and stepping, and a component that reads the entity and draws it. That one split
is what lets the server run the sim, lets a bot exist without a mesh, and lets there be
more than one aircraft.

Be honest about the risk here. The `scripts/` checks cover `stepFlight` and the input
layer thoroughly. They do **not** cover the telemetry publish block, the eased ground
sample, the reset ladder, the afterburner/condensation step order, or surface animation —
which is precisely the code this split moves. Extend the checks as part of the milestone,
not after it.

**0.3 — One world tick that steps entities in a declared order.**
Every component runs its own `useFrame`, and priority is already load-bearing: the bot sits
at `-2` so its inputs land before the flight loop at `0`. Put N aircraft at priority `0`
and their step order becomes their mount order, which is React reconciliation order. That
is not reproducible and a server cannot replay it. One tick, one list, one order.

**0.4 — Lift the settings out of the route.**
[FlightRangeRoute.jsx](src/routes/FlightRangeRoute.jsx) is 610 lines carrying thirteen
settings, the pointer lock lifecycle, and the pause flow. A combat route would copy three
hundred of them. `features/settings/` owns the state and the persistence; every flight
route mounts it.

**0.5 — `useRangeMetrics` stops being a hook.**
[useRangeMetrics](src/features/world/useRangeMetrics.js) is a `useMemo` around arithmetic
on a bounding box. The server needs the same bounds and the same spawn altitude. Plain
function underneath, thin hook on top.

**0.6 — Bake a heightmap per map.**
This is the item that decides whether online is possible, so it belongs in the first
milestone even though nothing consumes it yet. Ground clearance today is a `Raycaster`
against the loaded GLTF scene
([FlightAircraft.jsx:336-344](src/features/flight/FlightAircraft.jsx#L336-L344)), and that
raycast is what kills the pilot. A server cannot hold a GLTF scene graph cheaply, and a
client and server disagreeing about where the ground is means the client watches itself
die in mid-air. Bake each terrain to a heightfield at build time, ship it beside the
`.glb`, and have both ends sample the same grid. The client keeps the raycast only for the
camera boom, where a disagreement costs nothing.

### What this milestone deletes

The point is a smaller codebase, not a wider one. Track it: `FlightAircraft.jsx` and
`FlightRangeRoute.jsx` should both come out of this under 250 lines, and the telemetry
object should shrink to what the HUD actually reads — it publishes eighty-one fields, and
the debug overlay is the only reader of a good many of them.

The sortie and the observer page already share their world:
[FlightRange](src/features/world/FlightRange.jsx) is mounted by both, and `chaseCamera`
being an opt-in prop is what lets the observer hand the aircraft a detached camera without
forking the physics. Keep that property through the split — the remaining work there is
that [DualViewRenderer](src/features/dev-flight/DualViewRenderer.jsx) frames one aircraft
and will need to be told which entity it is watching.

## 1. Weapons and damage

*~1 week.*

- `hardpoints: []` on [f22.js](src/aircraft/f22.js) is declared and empty. Fill it with the
  node names stores hang from; the bay clips that expose them already exist in the model.
- The weapon manifests are already registered — [weapons/aim9.js](src/weapons/aim9.js) and
  [aim120.js](src/weapons/aim120.js) — and `resolveLoadout` already folds an airframe's
  count and station into them. What is missing from those manifests is the flight part:
  burn time, boost and sustain speed, turn rate, seeker cone, arming delay, fuse radius.
- A missile is an entity in `sim/`, stepped by the same world tick as the aircraft and in
  the same declared order. It is not a special case and it does not get its own loop.
- Launch is an event, not a held axis, so it binds through `keyActions`, not the bindings
  map. The right mouse button is already swallowed for the enemy zoom and the left button
  is already reserved as the trigger once the sky holds the pointer — see the comment at
  [FlightRangeRoute.jsx:297-324](src/routes/FlightRangeRoute.jsx#L297-L324). Neither needs
  the pointer's shape to change.
- Damage is a number on an entity and a `hit` event. Whether a hit is lethal, whether there
  are components, whether there is a repair — mode rules, not sim rules.

## 2. Bots

*~1–2 weeks, and the ceiling is however good you want them.*

- `ai/pilot.js` is a brain: it reads the world's view of its own entity and its target, and
  it writes into a control ref exactly as [ManeuverBot](src/features/flight/ManeuverBot.jsx)
  already does. It gets no privileged inputs. If the airframe cannot do the thing, the bot
  cannot fake it — the existing bot's own comment, and it stays true.
- Behaviours split into files under `ai/behaviors/`: pursuit with lead, defensive break,
  energy fight, extend and re-engage, ground avoidance. Ground avoidance first, or every
  test flight ends in a hillside.
- Difficulty is reaction delay, aim error, and how much of the envelope the bot is willing
  to use. It is never a physics multiplier.
- **Balance lives on the manifest.** The `flight.envelope` block on each airframe — speed
  band, pitch/roll/yaw rates, thrust, drag — is the only place two aircraft are made
  different from each other. Tune there, never in a mode, a scene, or a bot.
- v1 flies F-22 against F-22, because [AIRCRAFT](src/aircraft/index.js) has one entry and
  a symmetric fight is the honest way to tell a good bot from a favourable airframe. A
  second manifest is a milestone 3 item at the earliest — modes need an opponent, they do
  not need a *different* opponent.
- The manoeuvre bench in [features/dev-flight/](src/features/dev-flight/) already replays
  scripted timelines and asserts the regime the model reports. Point it at combat
  behaviours and it becomes the bot test harness for free.

## 3. Modes

*~2–3 weeks for the registry and the four modes.*

A mode is rules and nothing else: it never renders, never touches the flight model, and
never reaches into an entity. It subscribes to sim events (`spawn`, `hit`, `kill`,
`death`, `zone-enter`, `zone-leave`), keeps score, and answers questions the world asks it
— where does this player spawn, is the round over, who is on whose side.

`modes/index.js` is a registry with the same shape as `aircraft/` and `maps/`.

- **Free flight** — the range as it exists today, expressed as a mode with no rules. Prove
  the abstraction against the thing that already works before writing a second one.
- **Deathmatch / team deathmatch** — first to 20 kills, or a time limit. The simplest
  possible consumer of the event stream.
- **Capture point** — one or more zone volumes declared on the map manifest. Contested
  while both teams have someone inside; captured on a tick counter; ticks score.
- **Capture the flag** — a carriable entity. Carrying, dropping on death, returning, and
  scoring on delivery. The most work of the four because the flag is a real entity that
  attaches to an aircraft, not a counter.

Shared across all of them and worth its own budget: a scoreboard, a round lifecycle
(warmup, live, end, restart), a spawn selector that does not put people in front of each
other's guns, and a mode-aware HUD — target box, radar, kill feed, objective state.

## 4. Maps

*Manifest work ~1 day. Everything else is asset time.*

[mountainValley.js](src/maps/mountainValley.js) declares one spawn point, which is exactly
right for one aircraft. Combat needs the manifest to grow, and only the manifest:

- team spawn sets rather than a single `spawn`, each with a heading
- named zone volumes for capture points and flag stands
- which modes the range supports, so a mode select cannot offer CTF on a map with no flags
- the baked heightmap from 0.6, beside the `.glb`

A new range remains what it is today: a `.glb`, a manifest file, and one line in
[maps/index.js](src/maps/index.js). No scene file learns about it.

## 5. Audio

*~1 week for the engine, then per-sound asset time.*

[features/flight-range/audio.js](src/features/flight-range/audio.js) currently holds a
master volume and says so honestly: the slider stores a number and moves nothing. That is
the right thing to have shipped, and it is the hook the real system hangs on.

- `audio/` with one `AudioContext` for the app, a bus per category (engine, weapons,
  world, UI), and the existing master volume feeding the output gain. Categories get their
  own sliders in the pause menu once they exist, not before.
- The engine is the hard one and the one that sells it: a continuous loop whose rate and
  filter follow `engineThrottle`, `burnerLevel`, and `speedKmh` off the telemetry the
  flight model already publishes. Do not drive it from the keyboard — drive it from the
  same numbers the exhaust plume reads, so the sound can never claim thrust the aircraft is
  not making. The same discipline as
  [ExhaustPlumes](src/features/flight/ExhaustPlumes.jsx) and
  [VaporSheets](src/features/flight/VaporSheets.jsx).
- Positional audio for other aircraft and for missiles, through the same camera the scene
  renders with — the telemetry already publishes it as a live object.
- Warning tones read state that already exists: `stallBlend`, `afterburnerState`,
  `groundClearance`. A lock tone and a missile warning arrive with milestone 1.
- Browsers will not start an `AudioContext` without a gesture. The click that takes the
  pointer for the stick is that gesture; resume the context there.
- A pause has to suspend it again. `SyncedFrameLoop` withholds the render tick and the
  simulation stops with the last frame on screen, but an `AudioContext` does not care about
  frames — left alone, the engine screams through the pause menu at whatever power the
  pilot was holding. Suspend on pause, resume on the same click that takes the pointer
  back.

## 6. Online

*~4–7 weeks. This is the one to descope if the budget runs out — everything above ships
standalone without it.*

Authoritative server, client prediction. Not lockstep, not peer-to-peer: one host owns the
world, clients send input and render what they are told, and the local aircraft is
predicted forward and reconciled when the server disagrees.

- The server runs the same `sim/` the client does. That is what milestone 0 bought, and
  the reason 0.6 is not optional — the host needs the terrain height field, not a scene
  graph.
- `net/transport.js`, `net/snapshot.js`, `net/predict.js`, and — importantly —
  `net/local.js`. Offline-with-bots runs through the *same interface* as online, with the
  host in the same tab. Write it any other way and every mode gets implemented twice.
- Send input, not state. Snapshot the world at a fixed rate, interpolate other aircraft
  between snapshots, predict the local one and reconcile against the authoritative
  position. Budget the reconciliation work honestly: it is most of this milestone.
- Cheating stops being a design problem the moment the server owns the sim, which is
  another argument for doing it this way rather than trusting clients.
- Rooms, a lobby, and a mode/map vote are their own week and are not netcode.

## 7. Cloudflare

*~2–4 days for the deploy and the R2 move; the Durable Object work belongs to milestone 6.*

**Pages for the app.** The build is a static Vite bundle and the router is a `HashRouter`
([main.jsx](src/main.jsx)), so client routing needs no server rewrite rules at all — a
`_redirects` catch-all to `/index.html` is belt and braces for the bare-path case. Add the
`Cross-Origin-Embedder-Policy`/`Opener-Policy` headers only if a future feature needs
`SharedArrayBuffer`; nothing does today.

**R2 for the models.** `public/` is 17 MB of `.glb` and the repository is 43 MB because
those files are tracked in git — every clone pays for a terrain mesh, and every texture
re-export adds another copy forever. They belong in a bucket.

- Move the six `.glb` files to R2 behind a custom domain, and stop tracking them in git.
  Keep `public/assets/input_prompts/` and `public/basis/` on Pages: the transcoder must be
  same-origin to the app, and the input glyphs are small, numerous, and part of the UI.
- No source file learns about this. The manifests already own every URL — `url:
  '/F22_model.glb'` in [f22.js:171](src/aircraft/f22.js#L171),
  [mountainValley.js:20](src/maps/mountainValley.js#L20), and the two weapon modules. Make
  the base a build-time constant those manifests prefix, so a local checkout can still
  serve from `public/` and a deploy points at the bucket.
- The bucket needs CORS for the app's origin, and immutable cache headers with the content
  hash in the filename — a re-exported model is a new URL, never a purge.
- The `assets:` array already on the map manifest is what the loader screen names when a
  fetch fails. Once the fetch crosses an origin, that failure gets more likely and more
  confusing, so it is worth making the message say which origin it was talking to.

**Workers and Durable Objects for the match server.** One Durable Object per room is the
natural shape: it holds the authoritative world, accepts WebSocket connections, and ticks.
Use WebSocket hibernation so an idle lobby costs nothing. The room needs the baked
heightfield from 0.6, which by then lives in R2 beside the `.glb`: give the Worker an R2
binding and load the field once when the room opens, not per tick. One thing to check early — the
sim must import Three's math classes only (`Vector3`, `Quaternion`), never the renderer, or
the Worker bundle drags in WebGL code that cannot run there. Milestone 0.2 is what makes
that import boundary real; verify it with a bundle check in CI rather than by hoping.

## Order, and what can be cut

```
0  split            ── everything depends on this
1  weapons ──┐
2  bots ─────┤
3  modes ────┴──── offline combat ships here
4  maps
5  audio            (independent — can run in parallel with 1–3)
7  cloudflare       (independent — do the Pages + R2 half early, it is cheap)
6  online           (needs 0.6 and net/local.js from the start)
```

Offline combat against bots, on more than one range, with sound, deployed: six to nine
weeks run end to end, or roughly five to eight if audio and the Cloudflare deploy are done
alongside milestones 1–3 rather than after them. Neither figure includes the asset time for
new terrain, which is milestone 4's real cost and is not engineering.

Online roughly doubles the total. Milestone 6 is the one that can be dropped without
stranding anything else — provided `net/local.js` was written as the interface from the
beginning rather than retrofitted at the end.
