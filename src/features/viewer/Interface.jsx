import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  ChevronDown,
  Crosshair,
  Flame,
  Gauge,
  Lightbulb,
  Layers,
  Plane,
  Rocket,
  Rotate3D,
  RotateCcw,
  RotateCw,
  Scan,
  X,
} from 'lucide-react'

import Topbar from '../../ui/Topbar'

function Toggle({ active, onClick, icon: Icon, children }) {
  return (
    <button
      type="button"
      className={`toggle-row ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon size={16} strokeWidth={1.7} />
      <span>{children}</span>
      <i aria-hidden="true" />
    </button>
  )
}

function AnimationToggle({ clip, index, active, onToggle }) {
  return (
    <button
      type="button"
      className={`animation-toggle ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      onClick={() => onToggle(clip.id)}
    >
      <span className="animation-index">{String(index + 1).padStart(2, '0')}</span>
      <span className="animation-copy">
        <strong>{clip.label}</strong>
        <small>{active ? clip.activeLabel : clip.inactiveLabel}</small>
      </span>
      <i className="animation-switch" aria-hidden="true" />
    </button>
  )
}

function FlightControlButton({
  axis,
  value,
  label,
  icon: Icon,
  flightInput,
  onFlightInput,
}) {
  const isActive = flightInput[axis] === value
  const press = () => onFlightInput(axis, value)
  const release = () => onFlightInput(axis, 0)

  return (
    <button
      type="button"
      className={`flight-control-button ${isActive ? 'is-active' : ''}`}
      aria-label={label}
      aria-pressed={isActive}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        press()
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
          event.preventDefault()
          press()
        }
      }}
      onKeyUp={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          release()
        }
      }}
      onBlur={release}
    >
      <Icon size={17} strokeWidth={1.7} />
      <span>{label}</span>
    </button>
  )
}

function AfterburnerButton({ active, onChange }) {
  const release = () => onChange(false)

  return (
    <button
      type="button"
      className="afterburner-button"
      aria-label="Hold for afterburner"
      aria-pressed={active}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        onChange(true)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
          event.preventDefault()
          onChange(true)
        }
      }}
      onKeyUp={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          release()
        }
      }}
      onBlur={release}
    >
      <Flame size={15} strokeWidth={1.8} />
      <span>Afterburner</span>
      <small>{active ? 'HELD' : 'HOLD'}</small>
    </button>
  )
}

function WeaponOption({ weapon, active, onSelect }) {
  return (
    <button
      type="button"
      className={`weapon-option ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      onClick={() => onSelect(weapon.id)}
    >
      <span className="weapon-count">{weapon.count}×</span>
      <span className="animation-copy">
        <strong>{weapon.designation}</strong>
        <small>{weapon.role}</small>
      </span>
      <span className="weapon-station">{weapon.station}</span>
    </button>
  )
}

function ControlPanel({
  aircraft,
  loadout,
  weaponView,
  onWeaponViewChange,
  panelMode,
  clips,
  animationStates,
  onAnimationToggle,
  playbackSpeed,
  onSpeedChange,
  autoRotate,
  onAutoRotate,
  lightingMode,
  onLightingMode,
  onViewChange,
  aircraftMotionEnabled,
  onAircraftMotionToggle,
  flightInput,
  throttle,
  afterburner,
  onManualFlightChange,
  onFlightInput,
  onThrottleChange,
  onAfterburnerChange,
  onFlightReset,
  isOpen,
  onClose,
}) {
  // The tab is a readout of what the stage is showing, never its own piece of state — the
  // route owns both the weapons view and direct control, so a flight key can never leave
  // the panel pointing at a tab the viewer is not on.
  const changePanelMode = (mode) => {
    onWeaponViewChange(mode === 'weapons' ? 'all' : null)
    if (mode !== 'weapons') onManualFlightChange(mode === 'flight')
  }

  const selectedWeapon = loadout.find((weapon) => weapon.id === weaponView) ?? null

  const signedInput = (value) => {
    const amount = Math.round(value * 100)
    return `${amount > 0 ? '+' : ''}${amount}`
  }

  return (
    <aside
      className={`control-panel ${isOpen ? 'is-open' : ''} ${panelMode === 'flight' ? 'is-flight' : ''}`}
      aria-label="Model controls"
    >
      <div className="panel-drag" aria-hidden="true" />
      <div className="panel-heading">
        <div>
          <span>{panelMode === 'weapons' ? 'WEAPONS CONTROL' : 'AIRFRAME CONTROL'}</span>
          <strong>{aircraft.shortName} / READY</strong>
        </div>
        <button type="button" className="icon-button close-panel" onClick={onClose} aria-label="ปิดแผงควบคุม">
          <X size={18} />
        </button>
      </div>

      <div className="panel-tabs" role="tablist" aria-label="Control mode">
        <button
          type="button"
          role="tab"
          aria-selected={panelMode === 'animations'}
          className={panelMode === 'animations' ? 'is-active' : ''}
          onClick={() => changePanelMode('animations')}
        >
          <Scan size={13} /> Systems
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panelMode === 'flight'}
          className={panelMode === 'flight' ? 'is-active' : ''}
          onClick={() => changePanelMode('flight')}
        >
          <Plane size={13} /> Flight
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panelMode === 'weapons'}
          className={panelMode === 'weapons' ? 'is-active' : ''}
          disabled={!loadout.length}
          onClick={() => changePanelMode('weapons')}
        >
          <Rocket size={13} /> Weapons
        </button>
      </div>

      {panelMode === 'weapons' && (
        <section className="panel-section weapon-section" role="tabpanel">
          <p className="section-label">
            <Rocket size={13} />
            {aircraft.shortName} loadout
            <span className="clip-count">{loadout.length} types</span>
          </p>

          <div className="weapon-list">
            <button
              type="button"
              className={`weapon-option is-all ${weaponView === 'all' ? 'is-active' : ''}`}
              aria-pressed={weaponView === 'all'}
              onClick={() => onWeaponViewChange('all')}
            >
              <span className="weapon-count"><Layers size={13} /></span>
              <span className="animation-copy">
                <strong>All weapons</strong>
                <small>Crossed pair</small>
              </span>
              <span className="weapon-station">ALL</span>
            </button>

            {loadout.map((weapon) => (
              <WeaponOption
                key={weapon.id}
                weapon={weapon}
                active={weaponView === weapon.id}
                onSelect={onWeaponViewChange}
              />
            ))}
          </div>

          {selectedWeapon ? (
            <dl className="weapon-spec" aria-live="polite">
              {selectedWeapon.spec.map(([term, value]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="weapon-hint">
              เลือกอาวุธหนึ่งรายการเพื่อหมุนให้เห็นตรงๆ พร้อมข้อมูลจำเพาะ
            </p>
          )}
        </section>
      )}

      {panelMode === 'animations' && (
        <section className="panel-section animation-section" role="tabpanel">
        <p className="section-label">
          <Scan size={13} />
          Airframe systems
          <span className="clip-count">{clips.length} controls</span>
        </p>
        <div
          className="animation-toggle-list"
          tabIndex={clips.length ? 0 : -1}
          aria-label={`ระบบควบคุมเครื่องบิน ${clips.length} รายการ`}
        >
          {clips.length ? clips.map((clip, index) => (
            <AnimationToggle
              key={clip.id}
              clip={clip}
              index={index}
              active={Boolean(animationStates[clip.id])}
              onToggle={onAnimationToggle}
            />
          )) : (
            <div className="clip-skeleton"><span /><span /></div>
          )}
        </div>
      </section>
      )}

      {panelMode === 'flight' && (
        <section className="panel-section flight-section" role="tabpanel">
          <p className="section-label">
            <Plane size={13} />
            Manual flight
            <span className="manual-status">Live</span>
          </p>

          <div className="flight-pad">
            <FlightControlButton
              axis="yaw"
              value={-1}
              label="Yaw left"
              icon={RotateCcw}
              flightInput={flightInput}
              onFlightInput={onFlightInput}
            />
            <FlightControlButton
              axis="pitch"
              value={1}
              label="Pitch up"
              icon={ArrowUp}
              flightInput={flightInput}
              onFlightInput={onFlightInput}
            />
            <FlightControlButton
              axis="yaw"
              value={1}
              label="Yaw right"
              icon={RotateCw}
              flightInput={flightInput}
              onFlightInput={onFlightInput}
            />
            <FlightControlButton
              axis="roll"
              value={-1}
              label="Roll left"
              icon={ArrowLeft}
              flightInput={flightInput}
              onFlightInput={onFlightInput}
            />
            <button
              type="button"
              className="flight-reset-button"
              aria-label="Reset aircraft attitude"
              onClick={onFlightReset}
            >
              <Crosshair size={17} />
              <span>Level</span>
            </button>
            <FlightControlButton
              axis="roll"
              value={1}
              label="Roll right"
              icon={ArrowRight}
              flightInput={flightInput}
              onFlightInput={onFlightInput}
            />
            <FlightControlButton
              axis="pitch"
              value={-1}
              label="Pitch down"
              icon={ArrowDown}
              flightInput={flightInput}
              onFlightInput={onFlightInput}
            />
            <span aria-hidden="true" />
          </div>

          <div className="flight-readout" aria-live="polite">
            <span>PITCH <strong>{signedInput(flightInput.pitch)}</strong></span>
            <span>ROLL <strong>{signedInput(flightInput.roll)}</strong></span>
            <span>YAW <strong>{signedInput(flightInput.yaw)}</strong></span>
          </div>

          <div
            className={`engine-control ${afterburner ? 'is-afterburner' : ''}`}
            style={{ '--throttle-scale': throttle }}
          >
            <div className="engine-heading">
              <span><Gauge size={12} /> Engine thrust</span>
              <output aria-live="polite">{Math.round(throttle * 100)}%</output>
            </div>
            <div className="throttle-control">
              <kbd>S</kbd>
              <div className="throttle-track">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={throttle}
                  aria-label="Engine throttle"
                  onChange={(event) => onThrottleChange(Number(event.target.value))}
                />
              </div>
              <kbd>W</kbd>
            </div>
            <AfterburnerButton active={afterburner} onChange={onAfterburnerChange} />
          </div>

          <p className="flight-help">ARROWS: PITCH / ROLL &nbsp; A D: ROLL &nbsp; Q E: YAW &nbsp; W S: SPEED &nbsp; SHIFT: HOLD A/B &nbsp; FCS: AUTO SURFACES</p>
        </section>
      )}

      {panelMode === 'animations' && (
        <section className="panel-section">
        <p className="section-label"><Gauge size={13} /> Playback velocity</p>
        <div className="segmented-control" aria-label="Playback speed">
          {[0.5, 1, 1.5, 2].map((speed) => (
            <button
              type="button"
              key={speed}
              className={playbackSpeed === speed ? 'is-active' : ''}
              onClick={() => onSpeedChange(speed)}
            >
              {speed}×
            </button>
          ))}
        </div>
      </section>
      )}

      <section className="panel-section">
        <p className="section-label"><Box size={13} /> Camera vector</p>
        <div className="view-grid">
          {[
            ['perspective', '3/4'],
            ['front', 'FRONT'],
            ['side', 'SIDE'],
            ['top', 'TOP'],
          ].map(([view, label]) => (
            <button type="button" key={view} onClick={() => onViewChange(view)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section toggle-stack">
        {panelMode !== 'flight' && (
          <Toggle active={autoRotate} onClick={onAutoRotate} icon={Rotate3D}>
            Auto orbit
          </Toggle>
        )}
        {panelMode === 'flight' && (
          <Toggle
            active={aircraftMotionEnabled}
            onClick={onAircraftMotionToggle}
            icon={Rotate3D}
          >
            Aircraft follows input
          </Toggle>
        )}
        <Toggle
          active={lightingMode === 'stealth'}
          onClick={onLightingMode}
          icon={Lightbulb}
        >
          Low-light mode
        </Toggle>
      </section>

      <p className="panel-note">
        DRAG TO ORBIT / SCROLL TO ZOOM<br />
        DOUBLE TAP TO RECENTER
      </p>
    </aside>
  )
}

export default function Interface({
  aircraft,
  loadout = [],
  weaponView,
  onWeaponViewChange,
  clips,
  animationStates,
  onAnimationToggle,
  playbackSpeed,
  onSpeedChange,
  autoRotate,
  onAutoRotate,
  lightingMode,
  onLightingMode,
  onViewChange,
  onFullscreen,
  isPanelOpen,
  manualFlight,
  aircraftMotionEnabled,
  onAircraftMotionToggle,
  flightInput,
  throttle,
  afterburner,
  onManualFlightChange,
  onFlightInput,
  onThrottleChange,
  onAfterburnerChange,
  onFlightReset,
  onPanelOpen,
  onPanelClose,
}) {
  const activeSystemCount = Object.values(animationStates).filter(Boolean).length
  const panelMode = weaponView
    ? 'weapons'
    : manualFlight ? 'flight' : 'animations'
  const mode = panelMode === 'weapons'
    ? 'WEAPONS BAY'
    : manualFlight ? 'DIRECT CONTROL' : 'HANGAR VIEW'
  const selectedTitle = loadout
    .find((weapon) => weapon.id === weaponView)?.displayName.toUpperCase() ?? null

  return (
    <div className="interface">
      <Topbar onFullscreen={onFullscreen} />

      <div className="viewer-status-rail" aria-live="polite">
        <span><small>MODE</small><strong>{mode}</strong></span>
        <span><small>SYSTEMS</small><strong>{activeSystemCount} / {clips.length || '-'}</strong></span>
        <span><small>THRUST</small><strong>{Math.round(throttle * 100)}%</strong></span>
        <span><small>LIGHT</small><strong>{lightingMode === 'stealth' ? 'LOW' : 'STUDIO'}</strong></span>
      </div>

      <div className="left-readout" aria-hidden="true">
        <span>SYS</span>
        <i />
        <p>AIRFRAME<br />ONLINE</p>
      </div>

      <div className="viewer-sight" aria-hidden="true"><i /><i /><b /></div>

      <div className="airframe-title" aria-hidden="true">
        <span>{panelMode === 'weapons' ? 'HANGAR / WEAPONS BAY' : 'HANGAR / AIRFRAME BAY'}</span>
        <strong>
          {panelMode === 'weapons'
            ? (selectedTitle ?? `${aircraft.shortName} WEAPONS`)
            : aircraft.displayName.toUpperCase()}
        </strong>
        <p>
          {panelMode === 'weapons'
            ? 'ORBIT CAMERA / WEAPON INSPECTION / NOT ARMED'
            : 'ORBIT CAMERA / LIVE CONTROL SURFACES / FLIGHT RANGE READY'}
        </p>
      </div>

      <button type="button" className="open-panel" onClick={onPanelOpen}>
        {panelMode === 'weapons' ? 'WEAPONS' : manualFlight ? 'FLIGHT' : 'CONTROLS'}
        <ChevronDown size={15} />
      </button>

      <ControlPanel
        aircraft={aircraft}
        loadout={loadout}
        weaponView={weaponView}
        onWeaponViewChange={onWeaponViewChange}
        panelMode={panelMode}
        clips={clips}
        animationStates={animationStates}
        onAnimationToggle={onAnimationToggle}
        playbackSpeed={playbackSpeed}
        onSpeedChange={onSpeedChange}
        autoRotate={autoRotate}
        onAutoRotate={onAutoRotate}
        lightingMode={lightingMode}
        onLightingMode={onLightingMode}
        onViewChange={onViewChange}
        aircraftMotionEnabled={aircraftMotionEnabled}
        onAircraftMotionToggle={onAircraftMotionToggle}
        flightInput={flightInput}
        throttle={throttle}
        afterburner={afterburner}
        onManualFlightChange={onManualFlightChange}
        onFlightInput={onFlightInput}
        onThrottleChange={onThrottleChange}
        onAfterburnerChange={onAfterburnerChange}
        onFlightReset={onFlightReset}
        isOpen={isPanelOpen}
        onClose={onPanelClose}
      />

      {/* <div className="corner-data" aria-hidden="true">
        <Expand size={13} />
        <span>WEBGL / PBR</span>
        <i />
        <span>LIVE RENDER</span>
      </div> */}
    </div>
  )
}
