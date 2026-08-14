/*
The three pieces every settings tab is built out of. Keeping them here is what stops five
different tabs from becoming five different layouts.
*/

// One row of the settings panel: what it is on the left, the control on the right.
export function Row({ label, note, children }) {
  return (
    <div className="pause-row">
      <div className="pause-row-name">
        <span>{label}</span>
        {note && <i>{note}</i>}
      </div>
      <div className="pause-row-control">{children}</div>
    </div>
  )
}

/*
The segmented control the whole screen is built on. The latched option is filled rather than
merely outlined: which one is in force has to be readable without comparison.

An option that switches something *off* is filled in fog white rather than phosphor. Green
is the live signal on this interface — it means the system is running — so a latched OFF
glowing the same green as a latched ON would say the opposite of what it means.
*/
export function Segmented({ options, value, onChange, label, disabled = false }) {
  return (
    <div className="pause-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`pause-seg ${option.id === value ? 'is-on' : ''} ${option.id === 'off' ? 'is-negative' : ''}`}
          aria-pressed={option.id === value}
          disabled={disabled}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Slider({ label, value, min, max, step, text, onChange, disabled = false }) {
  return (
    <div className="pause-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <output>{text}</output>
    </div>
  )
}
