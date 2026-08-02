# F-22 Raptor Viewer

Interactive F-22 model viewer built with React, Vite, React Three Fiber, and Three.js.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite.

## Controls

- Drag to orbit and scroll/pinch to zoom.
- Use the bottom transport to play, pause, restart, or scrub the animation.
- Use the control surface to switch clips, playback speed, camera angle, auto-orbit, and lighting mode.
- Switch to the Flight tab for direct Three.js control of pitch, roll, and yaw. Hold the on-screen controls, or use arrow keys for pitch/roll and `Q` / `E` for yaw.
- Manual flight moves the ailerons, flaperons, leading-edge flaps, rudders, stabilators, and the thrust-vectoring nozzles while rotating the aircraft itself. Pitch vectors both nozzles together; roll vectors them differentially. Use Level to reset attitude.
- Select `Test flight` in the top bar to fly over `Mountain_Valley_Colorado.glb`. Use arrow keys for pitch/roll, `Q` / `E` for yaw, `W` / `S` for throttle, `F` for flaps, and `R` to reset. Touch controls are available on screen.
- Press `Space` to play/pause and `R` to reset the camera.

The Test Flight canvas uses the optimized Meshopt/KTX2 assets at DPR 1, 30 FPS, with no antialiasing, shadows, environment map, or post-processing to keep GPU and battery use low.

The viewer discovers all animation clips from `public/F22_model.glb` at runtime.
