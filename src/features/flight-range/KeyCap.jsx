/*
One key, drawn as the key it is.

The prompt art ships as flat white SVGs, which is exactly the wrong thing to put in an
`<img>` on a near-black panel: it would be a white sticker on a green instrument, immune to
hover and to the latched state the rebind screen needs. So the file is used as a mask and
the colour comes from `currentColor`, which means one cap follows the phosphor everywhere,
brightens with its row, and inverts while it is listening for a new key — with no second
copy of the asset and no recolouring pass.

The outline variants are the ones used: a hollow cap with a solid glyph reads as a key on a
dark surface, where the filled variant would be a solid slab with the letter punched out of
it and would lose the letter to whatever is behind the panel.

A key with no art of its own — an F13, a media key, anything the set does not cover — falls
back to its text label. That is the honest outcome, and it is why the label is always
rendered as the accessible name whether or not a glyph is available.
*/

import { describeKey } from '../flight/keybindings'

const ICON_BASE = '/assets/input_prompts/Keyboard_and_Mouse/Vector'

function iconUrl(name) {
  return `${ICON_BASE}/${name}.svg`
}

export default function KeyCap({ code, icon, label, title }) {
  const described = code ? describeKey(code) : null
  const art = icon ?? (described?.icon ? `${described.icon}_outline` : null)
  const text = label ?? described?.label ?? '—'

  if (!art) return <span className="key-cap is-text">{text}</span>

  return (
    <span
      className="key-cap"
      role="img"
      aria-label={title ?? text}
      title={title ?? text}
      style={{ '--key-art': `url("${iconUrl(art)}")` }}
    />
  )
}
