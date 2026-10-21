#!/usr/bin/env node
// Check a dashboard theme and, when Chrome or Chromium is installed, picture
// it on a fictional sample Home Base. It never opens the user's own dashboard,
// never reads their other files, and writes only the pictures.
//
//   node system/dashboard/preview-theme.mjs                 your instance/dashboard/theme.json (+ theme.css)
//   node system/dashboard/preview-theme.mjs --preset soft   a preset from system/dashboard/themes/
//   node system/dashboard/preview-theme.mjs --theme <file>  any theme.json
//   node system/dashboard/preview-theme.mjs --default       the default look
//
// Other options: --css <file> (an advanced theme.css), --no-css, --out
// <folder> (default: a new temporary folder), --name <prefix>.
// Exit codes: 0 the theme applies (notes, if any, are printed), 1 it would
// not be applied, 2 bad arguments.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBrowser, freePort, openBrowser, startDashboard } from './lib/chrome.mjs'
import { THEME_CSS_FILE, THEME_FILE, readTheme } from './lib/theme.mjs'

const dashboardDir = path.dirname(fileURLToPath(import.meta.url))
const homeBase = path.resolve(dashboardDir, '..', '..')
const args = process.argv.slice(2)
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const usage = (message) => { console.error(`${message}\nUsage: node system/dashboard/preview-theme.mjs [--preset <name> | --theme <file> | --default] [--css <file> | --no-css] [--out <folder>] [--name <prefix>]`); process.exit(2) }

const known = new Set(['--preset', '--theme', '--default', '--css', '--no-css', '--out', '--name'])
for (let index = 0; index < args.length; index += 1) {
  if (!known.has(args[index])) usage(`Unknown argument: ${args[index]}`)
  if (!['--default', '--no-css'].includes(args[index])) index += 1
}

const presets = fs.readdirSync(path.join(dashboardDir, 'themes')).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5))
let themeSource = null
if (option('--preset')) {
  if (!presets.includes(option('--preset'))) usage(`No preset named “${option('--preset')}”. Presets: ${presets.join(', ')}`)
  themeSource = path.join(dashboardDir, 'themes', `${option('--preset')}.json`)
} else if (option('--theme')) themeSource = path.resolve(option('--theme'))
else if (!args.includes('--default') && fs.existsSync(path.join(homeBase, THEME_FILE))) themeSource = path.join(homeBase, THEME_FILE)
let cssSource = null
if (option('--css')) cssSource = path.resolve(option('--css'))
else if (!args.includes('--no-css') && !args.includes('--default') && fs.existsSync(path.join(homeBase, THEME_CSS_FILE))) cssSource = path.join(homeBase, THEME_CSS_FILE)

// The dashboard refuses links, so the preview does too.
function readPlain(file) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false })
  if (!stat) usage(`Not found: ${file}`)
  if (!stat.isFile()) usage(`${file} is a link or folder; the dashboard only uses a plain file.`)
  return fs.readFileSync(file)
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-theme-preview-'))
const home = path.join(scratch, 'home-base')
const write = (relative, contents) => {
  fs.mkdirSync(path.dirname(path.join(home, relative)), { recursive: true })
  fs.writeFileSync(path.join(home, relative), contents)
}
// A fictional Home Base: made-up names only.
write('AGENTS.md', '# Agents\n')
write('CLAUDE.md', '@AGENTS.md\n')
write('you/SETUP.md', '---\nsetup_status: in_progress\nstage: blueprint\ndiscovery_path: personal\norientation_completed: 8\nnext_question: none\n---\n')
write('projects/INDEX.md', '## Active\n\n- [Lake trip](lake-trip.md) — book the cabin\n- [Garden plan](garden.md)\n')
write('systems/INDEX.md', '## Active\n\n- [Weekly meal plan](meal/BLUEPRINT.md)\n\n## Building or testing\n\n- [Reading log](reading/BLUEPRINT.md)\n')
write('capabilities/INDEX.md', '## Available and verified\n\n- [Codex opens Home Base directly](codex.md) — reads AGENTS.md; checked 2026-10-12\n- [Claude Code opens Home Base directly](claude.md) — reads CLAUDE.md; checked 2026-10-14\n\n## Available but unverified\n\n- [Grok Build CLI opens Home Base](grok.md)\n')
for (const folder of ['.agents/skills', '.claude/skills']) write(`${folder}/start-home-base/SKILL.md`, 'x')
if (themeSource) write(THEME_FILE, readPlain(themeSource))
if (cssSource) write(THEME_CSS_FILE, readPlain(cssSource))

const theme = readTheme(fs.realpathSync.native(home))
const shown = (file) => { const relative = path.relative(process.cwd(), file); return relative && !relative.startsWith('..') ? relative : file }
const label = themeSource ? shown(themeSource) : 'the default look'
if (theme.state === 'not-applied') console.log(`Theme not applied (${label}):\n${theme.notes.map((note) => `- ${note}`).join('\n')}`)
else if (theme.state === 'applied') console.log(`Theme “${theme.name}” applies (${label}).${theme.notes.length ? `\nSome colours keep the default so text stays readable:\n${theme.notes.map((note) => `- ${note}`).join('\n')}` : ' Every text colour meets 4.5:1.'}`)
else console.log('No theme: the default look.')
if (cssSource) console.log(theme.customCss ? `theme.css is applied (${shown(cssSource)}).` : 'theme.css is not used.')

const cleanups = []
async function pictures() {
  const browserPath = findBrowser()
  if (!browserPath) { console.log('No Chrome or Chromium found (set CHROME_PATH), so no pictures were taken.'); return }
  const out = path.resolve(option('--out') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-theme-pictures-')))
  fs.mkdirSync(out, { recursive: true })
  const prefix = (option('--name') ?? (option('--preset') || (themeSource ? 'theme' : 'default'))).replace(/[^A-Za-z0-9_-]+/g, '-')
  const port = await freePort()
  const key = await startDashboard(dashboardDir, home, port, cleanups)
  const browser = await openBrowser(browserPath, path.join(scratch, 'profile'), cleanups)
  await browser.open(`http://127.0.0.1:${port}/#key=${key}`, `document.querySelector('#domains-body .domain-grid') !== null && !document.getElementById('foot-theme').hidden === ${theme.state !== 'none' || theme.customCss || theme.notes.length > 0}`)
  const written = []
  for (const [shape, width, mobile] of [['desktop', 1280, false], ['phone', 390, true]]) {
    for (const scheme of ['light', 'dark']) {
      const file = path.join(out, `${prefix}-${shape}-${scheme}.png`)
      const actual = await browser.screenshot(file, { width, mobile, scheme })
      written.push(file)
      if (actual > width) console.log(`Warning: at ${width} px (${scheme}) the page is ${actual} px wide, so it scrolls sideways. Check theme.css, or try a more compact density.`)
    }
  }
  console.log(`Pictures of fictional sample data:\n${written.map((file) => `- ${file}`).join('\n')}`)
}

try {
  await pictures()
} catch (error) {
  console.error(`Could not take pictures: ${error.message}`)
} finally {
  for (const cleanup of cleanups.reverse()) { try { cleanup() } catch {} }
  setTimeout(() => {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    process.exit(theme.state === 'not-applied' ? 1 : 0)
  }, 300)
}
