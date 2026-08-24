interface ServerGlyphProps {
  name: string
  /** Edge length in px. The handoff uses 22 on cards, 20 in the registry. */
  size?: number
}

/**
 * Saturation and lightness are fixed so every tile sits in the dark UI at the
 * same weight; only the hue varies.
 *
 * Hues are quantized to evenly spaced buckets rather than taken raw from the
 * hash. Two names hashing 3 degrees apart are indistinguishable at this
 * saturation and read as a rendering fault; landing on the same bucket reads
 * as deliberate. The letter is what identifies a server anyway — colour is
 * there to help the eye group and scan.
 */
const FILL = 'hsl(HUE, 26%, 17%)'
const INK = 'hsl(HUE, 52%, 72%)'

/**
 * Stable across runs and machines, unlike a hash that depends on iteration
 * order — the same server must always get the same tile. FNV-1a, for spread
 * across neighbouring names like "github" and "gitlab".
 */
/**
 * Ten leaves 36 degrees between neighbouring tiles — comfortably apart at
 * this saturation — and, unlike 8 or 12, gives no two servers Roster ships
 * both the same letter and the same colour. It cannot promise that for names
 * someone invents, which is fine: the card prints the full name beside the
 * tile, so the tile never has to carry identification on its own.
 */
const BUCKETS = 10

export function hueFor(name: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return (hash % BUCKETS) * (360 / BUCKETS)
}

/** The letter to stamp on the tile. */
function monogramFor(name: string): string {
  const first = name.trim().charAt(0)
  return first === '' ? '?' : first.toUpperCase()
}

/**
 * A server's tile: its initial on a colour derived from its name.
 *
 * The handoff ships flat placeholder squares here and says any icon set can
 * replace them. Roster draws its own rather than bundling brand marks: it
 * runs offline behind a strict CSP, servers are user-installed and open-
 * ended, and a monogram works for a command someone wired up themselves.
 */
export function ServerGlyph({ name, size = 22 }: ServerGlyphProps) {
  const hue = String(hueFor(name))

  return (
    <span
      aria-hidden
      title={name}
      className="flex flex-none items-center justify-center rounded-chip font-ui font-semibold"
      style={{
        width: size,
        height: size,
        background: FILL.replace('HUE', hue),
        color: INK.replace('HUE', hue),
        fontSize: Math.round(size * 0.5),
        lineHeight: 1,
      }}
    >
      {monogramFor(name)}
    </span>
  )
}
