// Sticker registry. The 9 Whisp stickers are bundled with the app — the
// chat doc only stores a string `key`, the recipient looks up the URL via
// STICKER_BY_KEY. This means stickers are public/plaintext (like reactions)
// — encrypting a key drawn from a public list of 9 buys nothing.
//
// Adding a new sticker: drop the PNG in src/assets/stickers/ following the
// `<NN>-<key>.png` convention, add an entry below. Keep `key` stable forever
// — it's persisted in Firestore message docs; renaming the key would orphan
// every existing sticker message that referenced the old name.

const stickerUrls = import.meta.glob<{ default: string }>(
  './assets/stickers/*.png',
  { eager: true },
)

interface StickerSpec {
  key: string
  label: string
  filename: string
}

const SPECS: StickerSpec[] = [
  { key: 'hello',    label: 'Hello',    filename: '01-hello.png' },
  { key: 'shh',      label: 'Shh',      filename: '02-shh.png' },
  { key: 'vanish',   label: 'Vanishing', filename: '03-vanish.png' },
  { key: 'happy',    label: 'Happy',    filename: '04-happy.png' },
  { key: 'message',  label: 'Sending',  filename: '05-message.png' },
  { key: 'sleep',    label: 'Sleeping', filename: '06-sleep.png' },
  { key: 'surprise', label: 'Surprised', filename: '07-surprise.png' },
  { key: 'lock',     label: 'Encrypted', filename: '08-lock.png' },
  { key: 'bye',      label: 'Bye',      filename: '09-bye.png' },
]

export interface Sticker {
  key: string
  label: string
  url: string
}

export const STICKERS: Sticker[] = SPECS.map((s) => {
  const mod = stickerUrls[`./assets/stickers/${s.filename}`]
  if (!mod) {
    // Fail loud at import time if a sticker file is missing — easier to
    // catch a typo / missing file in dev than silently break in chat.
    throw new Error(`Sticker asset missing: ${s.filename}`)
  }
  return { key: s.key, label: s.label, url: mod.default }
})

const STICKER_BY_KEY = new Map(STICKERS.map((s) => [s.key, s]))

export function stickerUrl(key: string): string | null {
  return STICKER_BY_KEY.get(key)?.url ?? null
}
