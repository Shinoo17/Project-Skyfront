# Roadmap

Nothing below is built yet. The point of this file is that the structure already has a
place for each item, so none of them needs a rewrite of what exists.

## Where things live today

```
src/
  App.jsx                 route table + shell class, nothing else
  routes/                 one file per URL. paths.js is the single source of route paths
  features/viewer/        the studio surface: Scene, Interface, control panel
  features/test-flight/   the flight range: terrain, chase camera, telemetry
  features/flight/        input and flight behaviour shared by any flying surface
  aircraft/               one manifest per airframe + the registry
  three/                  renderer-level helpers: ktx2, hinge, pose, graphics
  ui/                     chrome shared across routes: Topbar, LoaderScreen, fullscreen
```

Adding a surface means a file in `routes/`, a path in `routes/paths.js`, and a folder in
`features/`. Adding an airframe means a file in `aircraft/` listed in `aircraft/index.js`
— no surface should ever name a `.glb` or a mesh again.

## 1. Missile

- `hardpoints: []` on the manifest ([src/aircraft/f22.js](src/aircraft/f22.js)) is
  declared and empty. Fill it with the node names stores hang from; the weapon bay clips
  that expose them already exist in the model.
- New `aircraft/weapons/` for the missile manifests (model url, scale, burn time, speed,
  turn rate) — same shape as an airframe manifest, much smaller.
- Projectile integration belongs in `features/flight/`, beside the code that already
  integrates the aircraft's own position and orientation each frame.
- Launch is an event, not a held axis, so it binds through `keyActions` in
  [useFlightControls](src/features/flight/useFlightControls.js), not through the
  bindings map.

## 2. Dogfight

- Route `/#/dogfight` → `routes/DogfightRoute.jsx`, feature code in `features/dogfight/`.
- Two `useFlightControls({ bindings })` instances with different binding maps. The hook
  already keeps input in a ref precisely so two of them can be read per frame without
  re-rendering anything.
- Balance between the two airframes is the `flight.envelope` block on each manifest
  (speed band, pitch/roll/yaw rates). Tune there, not in the scene.
- Terrain, chase camera, and the eco render profile can be lifted out of
  `features/test-flight/` once a second consumer exists — do it then, not before.

## 3. Graphics settings

- [src/three/graphics.js](src/three/graphics.js) already holds every renderer knob both
  Canvases use (`dpr`, `antialias`, `shadows`, `shadowMapSize`, `environment`,
  `powerPreference`, `targetFps`). `useGraphicsProfile(name)` returns a constant today.
- The work is: a settings surface, persistence to `localStorage`, and making
  `useGraphicsProfile` read the stored choice instead of its argument. No scene file
  should need to change.
- A profile change remounts the WebGL context, so the surfaces need to tolerate that —
  worth checking as part of the milestone.
