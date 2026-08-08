# F-22 Raptor Viewer

Interactive F-22 model viewer built with React, Vite, React Three Fiber, and Three.js.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite.

## Surfaces

| URL | What it is |
| --- | --- |
| `/` | Airframe viewer — orbit the model and drive every embedded animation clip |
| `/#/test-flight` | The sortie: fly a map from the chase camera on a full HUD |
| `/#/dev/test-flight` | Developer observer: free-orbit camera over the map, the pilot's view in a picture-in-picture |

The observer camera has two modes, and neither of them turns to face the aircraft. Static
(default) is a fixed post the jet flies past. Tracking (`T`, or the panel button) carries
the camera and its orbit target by the aircraft's frame-to-frame translation — the same
delta on both, so the viewing angle, the distance and the framing are unchanged and only
x, y and z move. Fly at the camera and it retreats ahead of you; fly away and it follows.

## Manoeuvre demonstrations

The right-hand panel on the developer page flies scripted manoeuvres — Cobra, J-turn, pedal
turn, post-stall pass, tumble, loop, aileron and barrel roll, Split-S, Immelmann — with a bot that
uses the same device-neutral input state as a pilot. It has no access to the physics, so
every limiter, authority curve and energy cost applies to it. Picking one resets the
aircraft first, so each run starts identically.

A script may claim a regime (`expect`), and the panel shows a tick only once
`detectManeuver` in the flight model has actually reported it. Nothing forces the label, so
a cross means the airframe stopped being able to do the thing.

```bash
npm run maneuver-check              # every script, headless, one line each
npm run maneuver-check -- cobra     # one script with a sampled trace
npm run maneuver-check -- all 400   # every script from a 400-unit spawn
npm run input-check                 # digital smoothing, analogue intent, and throttle stops
npm run flight-physics-check        # banked lift, flight-path separation, G/energy trade
npm run stall-check                 # high-AoA, TVC, tailslide, falling leaf, bounded Kulbit
```

The checker imports the real flight model at the real fixed step and exits non-zero if a
script no longer produces its regime, or if any of them dives more than 40 units below the
spawn — the margin the range floor allows over any terrain the map registry can load. Run
it after touching `maneuvering` in an aircraft manifest. Scripts live in
[src/features/flight/maneuvers.js](src/features/flight/maneuvers.js).

The flight model keeps aircraft orientation and velocity as separate state. Each fixed
step runs pilot intent and FCC rate commands first, integrates angular motion, measures
relative airflow/AoA against the new attitude, then applies lift, drag, thrust, and gravity
to velocity before integrating position. Lift follows aircraft-up, so banking naturally
trades vertical lift for lateral turn force; there is no bank-triggered pitch correction or
velocity snap toward the nose.

Very low speed is allowed to cross through zero instead of being clamped along the old
flight path. A vertical zoom can therefore become a genuine tailslide with negative signed
forward speed; gravity and reverse-flow weathercocking then drop the nose into recovery.
Deep separated flow also carries a small deterministic falling-leaf roll/yaw coupling when
all three axes are released. It is bounded by the spin guard and disappears immediately
when the player commands an axis, rebuilds airspeed, or stops sinking.

Routing is `HashRouter`, so every URL survives a reload on any static host without a
rewrite rule. Route paths live in [src/routes/paths.js](src/routes/paths.js).

## Layout

- `routes/` — one file per URL, owning that surface's state
- `maps/` — one manifest per range (terrain path, span, spawn, ceiling, atmosphere, camera
  limits) plus the registry. No scene names a terrain `.glb` or a range dimension.
- `aircraft/` — one manifest per airframe (model path, hinges, mixing, envelope) plus the
  registry. Scene code reads the manifest and never names a `.glb` or a mesh.
- `features/world` — a map made flyable: terrain, atmosphere, range metrics, and
  `FlightRange`, the one component every flight surface mounts
- `features/flight` — the flight model, controls, telemetry contract, the aircraft rig, and
  the chase camera. Everything here is camera- and surface-agnostic.
- `features/flight-range` — the sortie's own pieces: the HUD and its scene wiring
- `features/dev-flight` — the observer page's own pieces: the dual-view renderer and panel
- `features/viewer` — the hangar
- `three/` — renderer helpers: KTX2 loader, hinge builder, rest pose, graphics profiles,
  demand-render tick
- `ui/` — chrome shared across routes

The two flight surfaces differ in exactly one thing: which camera the aircraft flies.
The sortie hands `FlightRange` no camera, so the rig drives the Canvas's own; the observer
page hands it a detached camera and renders that into the inset. There is one scene, one
physics step and one telemetry object behind both views, so they cannot disagree.

## Adding a map

1. Drop the terrain `.glb` into `public/`.
2. Copy [src/maps/mountainValley.js](src/maps/mountainValley.js) to a new module beside it
   and edit the values: `id`, `name`, `region`, `url`, `assets`, `span`, `edgeMargin`,
   `spawn`, `ceilingAboveTerrain`, `environment`, `camera`, `observer`.
3. List it in `MAPS` in [src/maps/index.js](src/maps/index.js).

Nothing else changes. The range walls, the spawn altitude and the ceiling are measured from
the terrain's own bounds at the declared span, the loader screen and the error copy read the
map's `loading` and `assets`, and the map picker on the observer page is built from
`listMaps()`. To fly it, pass `mapId` to `useFlightSession` — the observer page already
exposes it as a dropdown.

See [ROADMAP.md](ROADMAP.md) for where the missile, dogfight, and graphics-settings work
is meant to land.

## Controls

- Drag to orbit and scroll/pinch to zoom.
- Use the bottom transport to play, pause, restart, or scrub the animation.
- Use the control surface to switch clips, playback speed, camera angle, auto-orbit, and lighting mode.
- Switch to the Flight tab for direct Three.js control of pitch, roll, and yaw. Hold the on-screen controls, or use arrow keys for pitch/roll and `Q` / `E` for yaw. Hold the A/B control or `Shift` to drive the engine through military power and light the afterburner.
- Manual flight moves the ailerons, flaperons, leading-edge flaps, rudders, stabilators, and the thrust-vectoring nozzles while rotating the aircraft itself. Pitch vectors both nozzles together; roll vectors them differentially. Use Level to reset attitude.
- Select `Test flight` in the top bar to fly over `Mountain_Valley_Colorado.glb`. Use arrow keys for pitch/roll, `Q` / `E` for yaw, `W` / `S` for dry throttle, hold `Shift` for afterburner, `Space` for the air brake, `F` for flaps, and `R` to reset. Press `C` to switch between Chase and Nose cameras, drag to free-look around the aircraft on global world axes, and hold `V` for a rear view that keeps the aircraft in frame. Free view is a rotation of the chase pose rather than a second rig: zero drag reproduces the ordinary camera exactly, so grabbing and releasing the mouse cannot pop. The drag is inverted on both axes and orbits the aircraft's own middle at a fixed radius; letting go springs the camera home in about half a second. In the nose camera the same drag turns the pilot's head instead of moving the seat. `Esc` (or `P`, which fullscreen does not swallow) stops the simulation and opens the pause menu — resume, settings, credits, or back to the hangar; its Settings pane remembers Normal or Action camera behavior and Near, Normal, or Far chase distance. Digital axes ramp smoothly instead of snapping. There is no post-stall mode and no entry window: control authority and the AoA fence both follow dynamic pressure, so the slower the air the more the airframe will let a committed pull ask for. Centred stick asks the FCC to recover. Held against the stops down in the thin air it does the other thing: the airstream's restoring moment drops to a quarter, the nose carries on over the top and round past the tail while the flight path runs on underneath, and the engines keep enough roll authority to pick which way the jet leaves. Hold to tumble, roll to aim it, let go to recover.
- Press `Space` to play/pause and `R` to reset the camera.

The Test Flight canvas uses the optimized Meshopt/KTX2 assets and reads its renderer settings from the `low` / `medium` / `high` profiles in [src/three/graphics.js](src/three/graphics.js); the pause menu's Settings pane picks between them and remembers the choice. Antialiasing is fixed when the WebGL context is created, so switching quality rebuilds the renderer and restarts the sortie. The hangar canvas uses the `studio` profile.

The sortie renders with `frameloop="never"` and drives its own frames through `advance()`. Demand mode cannot be used for a frame target: R3F cancels its render loop as soon as nothing is left to draw, so an `invalidate()` issued from inside a frame callback only renders on the following frame, capping the surface at half the display's refresh rate.

The viewer discovers all animation clips from `public/F22_model.glb` at runtime.
