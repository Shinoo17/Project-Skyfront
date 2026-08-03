/*
The contract between the demonstration bot and the panel that watches it.

One plain object, created once per surface and mutated in place by the bot's frame loop.
Like the flight telemetry beside it, it is never React state: a running demonstration
updates it sixty times a second and the panel reads it from its own animation frame, so
watching a manoeuvre costs zero renders.

`expect`, `matchedSeconds` and `matched` are the interesting part. `expect` is what the
script claims the airframe will do; the other two are what `detectManeuver` in the flight
model actually reported while it flew. Nothing anywhere forces the label, so they are a
measurement of the aircraft rather than a readback of the script.
*/
export function createBotStatus() {
  return {
    // 'idle' | 'arm' | 'wait' | 'run' | 'done'
    phase: 'idle',
    stepLabel: '',
    stepIndex: -1,
    stepCount: 0,
    elapsed: 0,
    total: 0,
    expect: null,
    observed: 'normal',
    matchedSeconds: 0,
    matched: false,
    // Completed runs, and the resets the bot did not ask for — a demonstration that keeps
    // restarting is one whose script has drifted out of the range's envelope.
    runs: 0,
    restarts: 0,
  }
}
