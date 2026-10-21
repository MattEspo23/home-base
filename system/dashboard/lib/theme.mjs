// The user's dashboard look, from instance/dashboard/theme.json (beginner
// safe) and instance/dashboard/theme.css (advanced, the user's own code).
//
// theme.json is checked strictly. A file that is not valid JSON, has a key
// this version does not know, a colour that is not #rgb or #rrggbb, or a value
// outside its list is not applied at all, and the page says why. Colours that
// would make text hard to read (below WCAG AA, 4.5:1) keep the default colour
// for that pair, and the page says which. The result is a small stylesheet of
// CSS custom properties served from this origin, so the page keeps its strict
// Content Security Policy and never shows the default look first.
import { pathPresent, readInside } from './status.mjs'

export const THEME_FILE = 'instance/dashboard/theme.json'
export const THEME_CSS_FILE = 'instance/dashboard/theme.css'
export const THEME_SCHEMA_VERSION = 1
export const MAX_THEME_BYTES = 16 * 1024
export const MIN_TEXT_CONTRAST = 4.5

export const COLOR_KEYS = ['background', 'surface', 'text', 'mutedText', 'accent', 'accentText', 'border', 'success', 'warning', 'danger']

// The defaults, which must equal the colour tokens in src/styles.css (a test
// checks this).
export const DEFAULT_COLORS = Object.freeze({
  light: Object.freeze({
    background: '#f6f7f9', surface: '#ffffff', text: '#0e1116', mutedText: '#5a6370', accent: '#1d4ed8',
    accentText: '#ffffff', border: '#d8dce2', success: '#17794a', warning: '#9a6200', danger: '#b42318',
  }),
  dark: Object.freeze({
    background: '#0a0c0f', surface: '#101318', text: '#e7eaee', mutedText: '#96a0ac', accent: '#7c9cff',
    accentText: '#0a0c0f', border: '#232a33', success: '#4cc38a', warning: '#e0a43a', danger: '#f07a6e',
  }),
})
// Tokens with no theme.json key, kept at their default while the colours
// they sit next to are unchanged.
const DEFAULT_DERIVED = Object.freeze({
  light: Object.freeze({ faint: '#68707c', accentSoft: '#e8eefc', bar: '#7f8894' }),
  dark: Object.freeze({ faint: '#8a939e', accentSoft: '#151d33', bar: '#6a7480' }),
})

const SYSTEM_SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
const CONDENSED = '"Avenir Next Condensed", "DIN Condensed", "Roboto Condensed", "Arial Narrow", "Helvetica Neue", system-ui, sans-serif'
const SYSTEM_MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace'
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
const ROUNDED = 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", Quicksand, Comfortaa, Manjari, "Arial Rounded MT", Calibri, source-sans-pro, sans-serif'
const SERIF = 'ui-serif, "New York", Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif'
const HUMANIST = 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", source-sans-pro, sans-serif'

// Only fonts already on the computer: the page makes no outside requests.
// Each choice sets the four font roles and how labels look.
const plainLabels = { '--label-stretch': 'normal', '--label-case': 'none', '--label-tracking': '0.15' }
export const FONTS = Object.freeze({
  system: { '--font-body': SYSTEM_SANS, '--font-head': 'var(--font-body)', '--font-label': CONDENSED, '--font-num': SYSTEM_MONO, '--label-stretch': 'condensed', '--label-case': 'uppercase', '--label-tracking': '1' },
  plain: { '--font-body': SYSTEM_SANS, '--font-head': 'var(--font-body)', '--font-label': 'var(--font-body)', '--font-num': 'var(--font-body)', ...plainLabels },
  rounded: { '--font-body': ROUNDED, '--font-head': 'var(--font-body)', '--font-label': 'var(--font-body)', '--font-num': 'var(--font-body)', ...plainLabels },
  serif: { '--font-body': SERIF, '--font-head': 'var(--font-body)', '--font-label': SYSTEM_SANS, '--font-num': 'var(--font-body)', '--label-stretch': 'normal', '--label-case': 'uppercase', '--label-tracking': '0.8' },
  mono: { '--font-body': MONO, '--font-head': 'var(--font-body)', '--font-label': 'var(--font-body)', '--font-num': 'var(--font-body)', '--label-stretch': 'normal', '--label-case': 'uppercase', '--label-tracking': '0.6' },
  humanist: { '--font-body': HUMANIST, '--font-head': 'var(--font-body)', '--font-label': 'var(--font-body)', '--font-num': 'var(--font-body)', ...plainLabels },
})

export const RADII = Object.freeze({
  none: { '--radius': '0', '--radius-control': '0', '--radius-bar': '0', '--radius-mark': '0' },
  small: { '--radius': '4px', '--radius-control': '4px', '--radius-bar': '2px', '--radius-mark': '2px' },
  medium: { '--radius': '10px', '--radius-control': '999px', '--radius-bar': '3px', '--radius-mark': '4px' },
  large: { '--radius': '16px', '--radius-control': '999px', '--radius-bar': '6px', '--radius-mark': '5px' },
})

export const DENSITIES = Object.freeze({ compact: '0.8', comfortable: '1', airy: '1.3' })

export const SHADOWS = Object.freeze({
  none: 'none',
  soft: '0 1px 2px rgb(16 24 40 / 0.05), 0 6px 20px rgb(16 24 40 / 0.06)',
})

export const MODES = Object.freeze(['auto', 'light', 'dark'])

const TOP_KEYS = new Set(['schemaVersion', 'name', 'description', 'colors', 'font', 'radius', 'density', 'shadow', 'mode'])
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

// ------------------------------------------------------------ contrast

function linear(channel) {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const n = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * linear(n >> 16) + 0.7152 * linear((n >> 8) & 255) + 0.0722 * linear(n & 255)
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// Every colour the page uses for text, against what it sits on.
export const CONTRAST_PAIRS = Object.freeze([
  ['text', 'background'], ['text', 'surface'],
  ['mutedText', 'background'], ['mutedText', 'surface'],
  ['accent', 'background'], ['accent', 'surface'],
  ['success', 'background'], ['success', 'surface'],
  ['warning', 'background'], ['warning', 'surface'],
  ['danger', 'background'], ['danger', 'surface'],
  ['accentText', 'accent'],
])

const WORDS = {
  background: 'background', surface: 'card colour', text: 'text', mutedText: 'muted text', accent: 'accent',
  accentText: 'accent text', border: 'border', success: 'success', warning: 'warning', danger: 'danger',
}

// Resolves one mode's palette. A pair below 4.5:1 keeps the default text
// colour; if the default text colour still fails on the chosen background,
// the background keeps its default too. Repeats until every pair passes,
// which always ends because the defaults pass among themselves.
export function resolvePalette(mode, chosen = {}) {
  const defaults = DEFAULT_COLORS[mode]
  const palette = { ...defaults, ...chosen }
  const notes = []
  for (let round = 0; round < 20; round += 1) {
    let changed = false
    for (const [fg, bg] of CONTRAST_PAIRS) {
      const ratio = contrastRatio(palette[fg], palette[bg])
      if (ratio >= MIN_TEXT_CONTRAST) continue
      const kept = []
      if (palette[fg] !== defaults[fg]) { palette[fg] = defaults[fg]; kept.push(WORDS[fg]) }
      if (contrastRatio(palette[fg], palette[bg]) < MIN_TEXT_CONTRAST && palette[bg] !== defaults[bg]) { palette[bg] = defaults[bg]; kept.push(WORDS[bg]) }
      if (kept.length === 0) continue
      notes.push(`${mode} ${WORDS[fg]} on ${WORDS[bg]} is ${(Math.floor(ratio * 10) / 10).toFixed(1)}:1 (needs 4.5:1), so the default ${kept.join(' and ')} ${kept.length > 1 ? 'are' : 'is'} kept`)
      changed = true
    }
    if (!changed) break
  }
  return { palette, notes }
}

// ---------------------------------------------------------- validation

const describe = (value) => {
  const text = typeof value === 'string' ? `“${value}”` : JSON.stringify(value)
  return text === undefined ? String(value) : text.length > 40 ? `${text.slice(0, 39)}…` : text
}

function oneOf(theme, key, allowed, problems) {
  if (!(key in theme)) return
  if (typeof theme[key] !== 'string' || !Object.hasOwn(allowed, theme[key])) {
    problems.push(`${key} ${describe(theme[key])} is not one of: ${Object.keys(allowed).join(', ')}`)
  }
}

// Returns { ok: true, theme } with every value checked and colours in
// lower-case #rrggbb, or { ok: false, problems }.
export function validateTheme(theme) {
  const problems = []
  if (theme === null || typeof theme !== 'object' || Array.isArray(theme)) return { ok: false, problems: ['the file must hold one JSON object, like { "schemaVersion": 1 }'] }
  for (const key of Object.keys(theme)) if (!TOP_KEYS.has(key)) problems.push(`unknown setting ${describe(key)}`)
  if (theme.schemaVersion !== THEME_SCHEMA_VERSION) problems.push(`"schemaVersion" must be ${THEME_SCHEMA_VERSION}`)
  if ('name' in theme && (typeof theme.name !== 'string' || !/^[^\u0000-\u001f\u007f]{1,40}$/.test(theme.name.trim()))) problems.push('name must be plain text of 1 to 40 characters')
  if ('description' in theme && (typeof theme.description !== 'string' || theme.description.length > 300)) problems.push('description must be text of at most 300 characters')
  oneOf(theme, 'font', FONTS, problems)
  oneOf(theme, 'radius', RADII, problems)
  oneOf(theme, 'density', DENSITIES, problems)
  oneOf(theme, 'shadow', SHADOWS, problems)
  if ('mode' in theme && !MODES.includes(theme.mode)) problems.push(`mode ${describe(theme.mode)} is not one of: ${MODES.join(', ')}`)
  const colors = { light: {}, dark: {} }
  if ('colors' in theme) {
    const given = theme.colors
    if (given === null || typeof given !== 'object' || Array.isArray(given)) problems.push('colors must be an object with "light" and/or "dark"')
    else {
      for (const key of Object.keys(given)) if (key !== 'light' && key !== 'dark') problems.push(`unknown setting ${describe(`colors.${key}`)}`)
      for (const mode of ['light', 'dark']) {
        if (!(mode in given)) continue
        const set = given[mode]
        if (set === null || typeof set !== 'object' || Array.isArray(set)) { problems.push(`colors.${mode} must be an object of colours`); continue }
        for (const [key, value] of Object.entries(set)) {
          if (!COLOR_KEYS.includes(key)) problems.push(`unknown setting ${describe(`colors.${mode}.${key}`)}`)
          else if (typeof value !== 'string' || !HEX.test(value)) problems.push(`colors.${mode}.${key} ${describe(value)} is not a colour like #1d4ed8`)
          else colors[mode][key] = expandHex(value)
        }
      }
    }
  }
  if (problems.length) return { ok: false, problems }
  return {
    ok: true,
    theme: {
      name: typeof theme.name === 'string' ? theme.name.trim() : 'Your theme',
      font: theme.font ?? 'system',
      radius: theme.radius ?? 'none',
      density: theme.density ?? 'comfortable',
      shadow: theme.shadow ?? 'none',
      mode: theme.mode ?? 'auto',
      colors,
    },
  }
}

function expandHex(value) {
  const hex = value.toLowerCase()
  return hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex
}

// --------------------------------------------------------------- CSS

function colorTokens(mode, palette) {
  const defaults = DEFAULT_COLORS[mode]
  const derived = DEFAULT_DERIVED[mode]
  const same = (...keys) => keys.every((key) => palette[key] === defaults[key])
  return {
    'color-scheme': mode,
    '--bg': palette.background,
    '--surface': palette.surface,
    '--ink': palette.text,
    '--muted': palette.mutedText,
    '--faint': same('mutedText') ? derived.faint : palette.mutedText,
    '--rule': palette.border,
    '--rule-strong': palette.text,
    '--accent': palette.accent,
    '--accent-ink': palette.accentText,
    '--accent-soft': same('accent', 'surface') ? derived.accentSoft : `color-mix(in srgb, ${palette.accent} 12%, ${palette.surface})`,
    '--bar': same('mutedText', 'background', 'surface') ? derived.bar : barColor(palette),
    '--ok': palette.success,
    '--warn': palette.warning,
    '--bad': palette.danger,
    '--focus': palette.accent,
  }
}

function mix(from, to, amount) {
  const channels = (hex) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16))
  const [x, y] = [channels(from), channels(to)]
  return `#${x.map((value, index) => Math.round(value + (y[index] - value) * amount).toString(16).padStart(2, '0')).join('')}`
}

// Chart bars: the muted text colour moved toward the card colour, as far as
// it can go while keeping 3:1 against the background and the cards (the
// muted colour itself always has 4.5:1, so this always finds one).
export function barColor(palette) {
  for (let amount = 0.6; amount > 0; amount -= 0.05) {
    const candidate = mix(palette.mutedText, palette.surface, amount)
    if (contrastRatio(candidate, palette.background) >= 3 && contrastRatio(candidate, palette.surface) >= 3) return candidate
  }
  return palette.mutedText
}

const block = (selector, tokens, indent = '') => `${indent}${selector} {\n${Object.entries(tokens).map(([name, value]) => `${indent}  ${name}: ${value};`).join('\n')}\n${indent}}\n`

// Every value written here comes from the fixed tables above or is a
// checked #rrggbb colour, so the stylesheet cannot carry anything else.
export function themeCss(theme, palettes) {
  const shape = {
    ...FONTS[theme.font],
    ...RADII[theme.radius],
    '--density': DENSITIES[theme.density],
    '--shadow-card': SHADOWS[theme.shadow],
  }
  const parts = ['/* Generated by the Home Base dashboard from instance/dashboard/theme.json. */\n', block(':root', shape)]
  if (theme.mode === 'auto') {
    parts.push(block(':root', colorTokens('light', palettes.light)))
    parts.push(`@media (prefers-color-scheme: dark) {\n${block(':root', colorTokens('dark', palettes.dark), '  ')}}\n`)
  } else {
    parts.push(block(':root', colorTokens(theme.mode, palettes[theme.mode])))
  }
  return parts.join('')
}

// ------------------------------------------------------------- reading

const NOT_READ = 'is not used: it must be a plain file in instance/dashboard/ (not a link or folder) and under 16 KB'

// What the page needs: whether a theme applies, its name, plain-language
// notes, the generated stylesheet, and whether theme.css is present.
export function readTheme(realRoot) {
  const result = { state: 'none', name: null, notes: [], tokens: null, customCss: false }
  const raw = readInside(realRoot, THEME_FILE)
  if (!raw || Buffer.byteLength(raw) > MAX_THEME_BYTES) {
    if (pathPresent(realRoot, THEME_FILE)) { result.state = 'not-applied'; result.notes.push(`theme.json ${NOT_READ}`) }
  } else {
    let parsed
    let parsedOk = true
    try { parsed = JSON.parse(raw) } catch { parsedOk = false }
    const checked = parsedOk ? validateTheme(parsed) : { ok: false, problems: ['theme.json is not valid JSON (check for a missing comma or quote)'] }
    if (!checked.ok) {
      result.state = 'not-applied'
      result.notes.push(...checked.problems)
    } else {
      const light = resolvePalette('light', checked.theme.colors.light)
      const dark = resolvePalette('dark', checked.theme.colors.dark)
      const used = checked.theme.mode === 'auto' ? [...light.notes, ...dark.notes] : (checked.theme.mode === 'light' ? light : dark).notes
      result.state = 'applied'
      result.name = checked.theme.name
      result.notes.push(...used)
      result.tokens = themeCss(checked.theme, { light: light.palette, dark: dark.palette })
    }
  }
  const css = readInside(realRoot, THEME_CSS_FILE)
  if (css && Buffer.byteLength(css) <= 256 * 1024) result.customCss = true
  else if (pathPresent(realRoot, THEME_CSS_FILE)) result.notes.push(`theme.css ${NOT_READ.replace('16 KB', '256 KB')}`)
  return result
}

// The user's own theme.css, or null when it is absent or refused.
export function readCustomCss(realRoot) {
  const css = readInside(realRoot, THEME_CSS_FILE)
  return css ? css : null
}
