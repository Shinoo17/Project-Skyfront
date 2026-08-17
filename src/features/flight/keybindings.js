/*
The pilot's keyboard, as something they own rather than something the build decided.

`FLIGHT_BINDINGS` in `flightInput.js` stays the authored default and the shape the input
layer actually reads: a flat `KeyboardEvent.code → control` map. What lives here is the
other direction — one row per control, with the two slots a pilot expects a rebind screen to
give them — plus the derivation back to the flat map. Storing it the other way round is what
makes "clear the second key on Roll Left" expressible at all.

Codes, never characters. `event.key` is the letter the layout produced, so a binding stored
as "A" moves under the pilot's hand on AZERTY and disappears entirely when they type in Thai.
`event.code` is the physical key, which is what a flight control is.

Two rules the screen depends on:

  Reserved codes are refused. Escape, P, R, I and C are events the sortie owns — the menu,
  the reset and the debug readout — and a pilot who binds the airbrake to Escape has locked
  themselves out of the menu that would let them undo it.

  A code taken by another control is stolen, not rejected. That is what every game does, and
  a conflict dialog in the middle of a rebind is a worse answer than showing the control it
  came from going empty.

Mouse buttons are deliberately not bindable. Left click hands the pointer to the sky and
right drag is free look; both are owned by the stage's pointer handlers rather than by this
map, so the screen shows them as fixed rows. "Keyboard and mouse" is the device profile, not
a promise that the buttons move.
*/

const BINDINGS_KEY = 'f22-flight-key-bindings'

/*
The controls a pilot can move, in the order the screen shows them, grouped the way they are
flown: the stick first, then the things the hands do around it. Every id here is a control
name the flight model already reads — nothing in this list is aspirational.
*/
export const FLIGHT_CONTROL_GROUPS = [
  {
    id: 'stick',
    title: 'STICK',
    rows: [
      { action: 'pitch-up', label: 'Pitch up', note: 'Nose toward the vertical' },
      { action: 'pitch-down', label: 'Pitch down', note: 'Nose toward the ground' },
      { action: 'roll-left', label: 'Roll left', note: 'Bank the wings left' },
      { action: 'roll-right', label: 'Roll right', note: 'Bank the wings right' },
      { action: 'yaw-left', label: 'Rudder left', note: 'Fine aim, not a turn' },
      { action: 'yaw-right', label: 'Rudder right', note: 'Fine aim, not a turn' },
    ],
  },
  {
    id: 'power',
    title: 'POWER & DRAG',
    rows: [
      { action: 'throttle-up', label: 'Ask for more speed', note: 'Commands MIL power' },
      { action: 'throttle-down', label: 'Ask for less speed', note: 'Commands idle' },
      { action: 'afterburner', label: 'Afterburner', note: 'Held; spools, and has a reserve' },
      { action: 'air-brake', label: 'Air brake', note: 'Held; separate from the throttle' },
    ],
  },
  {
    id: 'airframe',
    title: 'AIRFRAME & VIEW',
    rows: [
      { action: 'maneuver-assist', label: 'Maneuver assist', note: 'Held; arms post-stall authority' },
      { action: 'rear-view', label: 'Look back', note: 'Held; does not change the flight path' },
    ],
  },
]

export const FLIGHT_CONTROL_ROWS = FLIGHT_CONTROL_GROUPS.flatMap((group) => group.rows)

/*
The authored defaults, in slot form. These are exactly the pairs `FLIGHT_BINDINGS` already
carries — roll has both the arrow and the letter, the afterburner has both shift keys — read
out as two slots so the second one is a thing the pilot can see and change.
*/
export const DEFAULT_KEY_BINDINGS = {
  'pitch-up': ['ArrowUp', null],
  'pitch-down': ['ArrowDown', null],
  'roll-left': ['ArrowLeft', 'KeyA'],
  'roll-right': ['ArrowRight', 'KeyD'],
  'yaw-left': ['KeyQ', null],
  'yaw-right': ['KeyE', null],
  'throttle-up': ['KeyW', null],
  'throttle-down': ['KeyS', null],
  'afterburner': ['ShiftLeft', 'ShiftRight'],
  'air-brake': ['Space', null],
  'maneuver-assist': ['AltLeft', null],
  'rear-view': ['KeyV', null],
}

// Events the sortie owns. Binding a control onto one of these would take the menu, the
// reset or the debug readout away from the pilot with no way back.
export const RESERVED_CODES = new Set(['Escape', 'KeyP', 'KeyR', 'KeyI', 'KeyC'])

// The mouse, as the screen has to show it: real controls the pilot uses, none of them
// living in this map.
// Icon names are complete filenames from the prompt set rather than a stem the screen adds
// a suffix to: the set has no outline variant of the movement glyph, and a name assembled
// from a rule would ask for a file that is not there.
export const FIXED_MOUSE_ROWS = [
  { icon: 'mouse_move', label: 'Pitch and roll', note: 'While the sky holds the pointer' },
  { icon: 'mouse_left_outline', label: 'Take the stick', note: 'Click the sky to hand it the pointer' },
  { icon: 'mouse_right_outline', label: 'Free look', note: 'Hold and drag; the flight path is unchanged' },
]

function cloneBindings(source) {
  const next = {}
  for (const row of FLIGHT_CONTROL_ROWS) {
    const slots = source[row.action]
    next[row.action] = [slots?.[0] ?? null, slots?.[1] ?? null]
  }
  return next
}

export function defaultKeyBindings() {
  return cloneBindings(DEFAULT_KEY_BINDINGS)
}

export function readKeyBindings() {
  try {
    const stored = window.localStorage.getItem(BINDINGS_KEY)
    if (!stored) return defaultKeyBindings()
    // Anything the stored map does not name falls back to the default for that control, so
    // a build that adds a control does not leave the pilot with a dead row.
    return cloneBindings({ ...DEFAULT_KEY_BINDINGS, ...JSON.parse(stored) })
  } catch {
    return defaultKeyBindings()
  }
}

export function writeKeyBindings(bindings) {
  try {
    window.localStorage.setItem(BINDINGS_KEY, JSON.stringify(bindings))
  } catch {
    // Storage can be refused; the bindings still hold for this session.
  }
}

/*
Put `code` in `slot` of `action`, and take it off whatever else was holding it.

The steal is deliberate and total: a code can only ever name one control, so the same code
found anywhere else — including the other slot of this very control — is cleared. Returns a
new object; nothing is mutated in place, because React state is what holds this.
*/
export function assignBinding(bindings, action, slot, code) {
  if (RESERVED_CODES.has(code)) return bindings
  const next = cloneBindings(bindings)
  for (const row of FLIGHT_CONTROL_ROWS) {
    const slots = next[row.action]
    if (slots[0] === code) slots[0] = null
    if (slots[1] === code) slots[1] = null
  }
  next[action][slot] = code
  return next
}

export function clearBinding(bindings, action, slot) {
  const next = cloneBindings(bindings)
  next[action][slot] = null
  return next
}

/*
Back to the shape `useFlightControls` reads. Both slots point at the same control, which is
how one aircraft function ends up with two keys on it.
*/
export function toBindingMap(bindings) {
  const map = {}
  for (const row of FLIGHT_CONTROL_ROWS) {
    for (const code of bindings[row.action] ?? []) {
      if (code) map[code] = row.action
    }
  }
  return map
}

/*
What a key is called, and which prompt art stands for it.

The labels are the short forms a key legend uses rather than the raw code — `ShiftLeft` is
"L SHIFT" on a keycap, never "ShiftLeft". The icon names index the shipped prompt set; a key
with no art of its own falls back to its text label alone, which is the honest outcome for
something like F13 or a media key.
*/
const NAMED_KEYS = {
  Space: { label: 'SPACE', icon: 'keyboard_space_icon' },
  Enter: { label: 'ENTER', icon: 'keyboard_enter' },
  NumpadEnter: { label: 'NUM ENTER', icon: 'keyboard_numpad_enter' },
  Tab: { label: 'TAB', icon: 'keyboard_tab_icon' },
  Backspace: { label: 'BKSP', icon: 'keyboard_backspace_icon' },
  CapsLock: { label: 'CAPS', icon: 'keyboard_capslock_icon' },
  ShiftLeft: { label: 'L SHIFT', icon: 'keyboard_shift_icon' },
  ShiftRight: { label: 'R SHIFT', icon: 'keyboard_shift_icon' },
  ControlLeft: { label: 'L CTRL', icon: 'keyboard_ctrl' },
  ControlRight: { label: 'R CTRL', icon: 'keyboard_ctrl' },
  AltLeft: { label: 'L ALT', icon: 'keyboard_alt' },
  AltRight: { label: 'R ALT', icon: 'keyboard_alt' },
  MetaLeft: { label: 'L META', icon: 'keyboard_command' },
  MetaRight: { label: 'R META', icon: 'keyboard_command' },
  ArrowUp: { label: 'UP', icon: 'keyboard_arrow_up' },
  ArrowDown: { label: 'DOWN', icon: 'keyboard_arrow_down' },
  ArrowLeft: { label: 'LEFT', icon: 'keyboard_arrow_left' },
  ArrowRight: { label: 'RIGHT', icon: 'keyboard_arrow_right' },
  Insert: { label: 'INS', icon: 'keyboard_insert' },
  Delete: { label: 'DEL', icon: 'keyboard_delete' },
  Home: { label: 'HOME', icon: 'keyboard_home' },
  End: { label: 'END', icon: 'keyboard_end' },
  PageUp: { label: 'PG UP', icon: 'keyboard_page_up' },
  PageDown: { label: 'PG DN', icon: 'keyboard_page_down' },
  Backquote: { label: '`', icon: 'keyboard_tilde' },
  Minus: { label: '-', icon: 'keyboard_minus' },
  Equal: { label: '=', icon: 'keyboard_equals' },
  BracketLeft: { label: '[', icon: 'keyboard_bracket_open' },
  BracketRight: { label: ']', icon: 'keyboard_bracket_close' },
  Backslash: { label: '\\', icon: 'keyboard_slash_back' },
  Slash: { label: '/', icon: 'keyboard_slash_forward' },
  Semicolon: { label: ';', icon: 'keyboard_semicolon' },
  Quote: { label: "'", icon: 'keyboard_apostrophe' },
  Comma: { label: ',', icon: 'keyboard_comma' },
  Period: { label: '.', icon: 'keyboard_period' },
}

export function describeKey(code) {
  if (!code) return null
  const named = NAMED_KEYS[code]
  if (named) return named
  if (/^Key[A-Z]$/.test(code)) {
    const letter = code.slice(3)
    return { label: letter, icon: `keyboard_${letter.toLowerCase()}` }
  }
  if (/^Digit[0-9]$/.test(code)) {
    const digit = code.slice(5)
    return { label: digit, icon: `keyboard_${digit}` }
  }
  if (/^Numpad[0-9]$/.test(code)) {
    return { label: `NUM ${code.slice(6)}`, icon: `keyboard_${code.slice(6)}` }
  }
  if (/^F([1-9]|1[0-2])$/.test(code)) {
    return { label: code, icon: `keyboard_${code.toLowerCase()}` }
  }
  return { label: code.toUpperCase(), icon: null }
}
