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
turn, post-stall pass, loop, aileron and barrel roll, Split-S, Immelmann — with a bot that
holds the same controls a pilot does. It writes into the same `pressed` set the keyboard
writes into and has no other access, so every limiter, authority curve and energy cost
applies to it. Picking one resets the aircraft first, so each run starts identically.

A script may claim a regime (`expect`), and the panel shows a tick only once
`detectManeuver` in the flight model has actually reported it. Nothing forces the label, so
a cross means the airframe stopped being able to do the thing.

```bash
npm run maneuver-check              # every script, headless, one line each
npm run maneuver-check -- cobra     # one script with a sampled trace
npm run maneuver-check -- all 400   # every script from a 400-unit spawn
```

The checker imports the real flight model at the real fixed step and exits non-zero if a
script no longer produces its regime, or if any of them dives more than 40 units below the
spawn — the margin the range floor allows over any terrain the map registry can load. Run
it after touching `maneuvering` in an aircraft manifest. Scripts live in
[src/features/flight/maneuvers.js](src/features/flight/maneuvers.js).

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
- Switch to the Flight tab for direct Three.js control of pitch, roll, and yaw. Hold the on-screen controls, or use arrow keys for pitch/roll and `Q` / `E` for yaw.
- Manual flight moves the ailerons, flaperons, leading-edge flaps, rudders, stabilators, and the thrust-vectoring nozzles while rotating the aircraft itself. Pitch vectors both nozzles together; roll vectors them differentially. Use Level to reset attitude.
- Select `Test flight` in the top bar to fly over `Mountain_Valley_Colorado.glb`. Use arrow keys for pitch/roll, `Q` / `E` for yaw, `W` / `S` for throttle, `F` for flaps, and `R` to reset. Touch controls are available on screen.
- Press `Space` to play/pause and `R` to reset the camera.

The Test Flight canvas uses the optimized Meshopt/KTX2 assets at DPR 1, 30 FPS, with no antialiasing, shadows, environment map, or post-processing to keep GPU and battery use low. Both canvases read those settings from the `eco` and `studio` profiles in [src/three/graphics.js](src/three/graphics.js).

The viewer discovers all animation clips from `public/F22_model.glb` at runtime.
