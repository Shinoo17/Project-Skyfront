import { Check, Play, Repeat, Square, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { listManeuvers } from '../flight/maneuvers'

/*
The demonstration board: pick a manoeuvre, watch the bot fly it, and read whether the
flight model agreed that it happened.

The verdict line is the part worth having. `expect` on a script is a claim about the
airframe — that this sequence of held controls really does put it into that regime — and
the only thing that can settle it is `detectManeuver` reading the physics back. A cross
means the script no longer works, which after a tuning change is exactly what a developer
wants to find out.

Progress and telemetry are written straight to the DOM from one animation frame, the same
way the HUD does it: they change every frame and none of them belong in React state.
*/
export default function ManeuverPanel({
  aircraft,
  status,
  activeId,
  onSelect,
  onReplay,
  onStop,
  loop,
  onLoopChange,
}) {
  const dom = useRef({})
  const maneuvers = listManeuvers(aircraft)
  const active = maneuvers.find((maneuver) => maneuver.id === activeId) ?? null

  useEffect(() => {
    let request = 0
    const paint = () => {
      request = window.requestAnimationFrame(paint)
      const value = status.current
      const nodes = dom.current

      if (nodes.bar) {
        const progress = value.total > 0 ? Math.min(1, value.elapsed / value.total) : 0
        nodes.bar.style.setProperty('--progress', String(progress))
      }
      if (nodes.step && nodes.step.textContent !== value.stepLabel) {
        nodes.step.textContent = value.stepLabel || '—'
      }
      const clock = value.total > 0
        ? `${value.elapsed.toFixed(1)} / ${value.total.toFixed(1)}s`
        : '—'
      if (nodes.clock && nodes.clock.textContent !== clock) nodes.clock.textContent = clock
      if (nodes.observed && nodes.observed.textContent !== value.observed) {
        nodes.observed.textContent = value.observed
      }
      const held = value.expect
        ? `${value.matchedSeconds.toFixed(1)}s`
        : 'n/a'
      if (nodes.held && nodes.held.textContent !== held) nodes.held.textContent = held
      if (nodes.verdict) {
        nodes.verdict.classList.toggle('is-matched', Boolean(value.expect) && value.matched)
        nodes.verdict.classList.toggle(
          'is-missed',
          Boolean(value.expect) && !value.matched && value.phase === 'done',
        )
      }
      if (nodes.restarts) {
        const text = value.restarts ? `${value.restarts} restart(s)` : ''
        if (nodes.restarts.textContent !== text) nodes.restarts.textContent = text
      }
      // A finished run puts the play glyph back on the button it is sitting on, because
      // that is what clicking it now does. The swap is CSS on a class rather than a React
      // re-render, so nothing about the tree changes sixty times a second.
      if (nodes.active) nodes.active.classList.toggle('is-done', value.phase === 'done')
    }
    request = window.requestAnimationFrame(paint)
    return () => window.cancelAnimationFrame(request)
  }, [status])

  return (
    <aside className="demo-panel" aria-label="Manoeuvre demonstrations">
      <p className="dev-panel-title">MANOEUVRE DEMOS</p>

      <ul className="demo-list">
        {maneuvers.map((maneuver) => {
          const isActive = maneuver.id === activeId
          return (
            <li key={maneuver.id}>
              <button
                type="button"
                className={isActive ? 'is-on' : ''}
                aria-pressed={isActive}
                ref={isActive ? (node) => { dom.current.active = node } : undefined}
                onClick={() => {
                  if (!isActive) return onSelect(maneuver.id)
                  // Clicking the one that is already selected stops it, unless it has
                  // finished — then it flies it again.
                  return status.current.phase === 'done' ? onReplay() : onSelect(null)
                }}
              >
                <Play size={12} strokeWidth={2.2} className="demo-icon-play" aria-hidden="true" />
                <Square size={12} strokeWidth={2.2} className="demo-icon-stop" aria-hidden="true" />
                <span>{maneuver.name}</span>
                {maneuver.expect && <em>{maneuver.expect}</em>}
              </button>
            </li>
          )
        })}
      </ul>

      <div className="demo-panel-buttons">
        <button
          type="button"
          className={loop ? 'is-on' : ''}
          aria-pressed={loop}
          onClick={() => onLoopChange(!loop)}
        >
          <Repeat size={14} strokeWidth={1.9} /> Loop
        </button>
        <button type="button" onClick={onStop} disabled={!activeId}>
          <Square size={14} strokeWidth={1.9} /> Stop
        </button>
      </div>

      {active ? (
        <>
          <p className="demo-brief">{active.brief}</p>

          <div className="demo-progress" ref={(node) => { dom.current.bar = node }}>
            <i />
          </div>

          <dl className="dev-panel-readout demo-readout">
            <div>
              <dt>STEP</dt>
              <dd ref={(node) => { dom.current.step = node }}>—</dd>
            </div>
            <div>
              <dt>TIME</dt>
              <dd ref={(node) => { dom.current.clock = node }}>—</dd>
            </div>
            <div>
              <dt>MODEL SAYS</dt>
              <dd ref={(node) => { dom.current.observed = node }}>—</dd>
            </div>
            <div>
              <dt>HELD</dt>
              <dd ref={(node) => { dom.current.held = node }}>—</dd>
            </div>
          </dl>

          {active.expect && (
            <p className="demo-verdict" ref={(node) => { dom.current.verdict = node }}>
              <Check size={13} strokeWidth={2.4} className="demo-tick" aria-hidden="true" />
              <X size={13} strokeWidth={2.4} className="demo-cross" aria-hidden="true" />
              <span>expects <strong>{active.expect}</strong> from the flight model</span>
            </p>
          )}

          <p className="dev-panel-hint" ref={(node) => { dom.current.restarts = node }} />
        </>
      ) : (
        <p className="dev-panel-hint">
          The bot holds the same controls a pilot does — no privileged inputs, every limiter
          applies. Picking one resets the aircraft first, so every run starts identically.
        </p>
      )}
    </aside>
  )
}
