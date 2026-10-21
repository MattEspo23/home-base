// Put the dashboard online, locked to the owner's own Vercel sign-in. Zero
// dependencies. Three pieces, all used by ../publish.mjs:
//
// - buildSnapshot: a static copy of exactly what the local dashboard shows.
//   The page and its own files from dist/, status.json from the status reader
//   (names and counts only, never file bodies), the checked theme, and the
//   .js/.css/.json files of declared instance modules. Links, files the
//   dashboard would not serve, and anything the privacy scan's default rules
//   or the credential check flag are refused, never skipped.
// - buildPlaceholder: a harmless page with no personal data, uploaded first so
//   the lock can be turned on and checked before anything private goes up.
// - checkLocked: anonymous requests (no cookies) that pass only when every
//   answer is Vercel's own sign-in wall.
//
// writeOutput puts either one in a folder outside Home Base, with a
// .vercelignore allowlist so only the listed files can ever be uploaded, and
// an ONLINE-MANIFEST.json that records them. Nothing here talks to Vercel.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { containsCredentialShape } from '../../lib/contracts.mjs'
import { runPrivacyScan } from '../../privacy-scan.mjs'
import { CUSTOM_LINK, THEME_SLOT, TOKENS_LINK } from './server.mjs'
import { readInside, readInstanceModules, readStatus, resolveInstanceModuleFile } from './status.mjs'
import { THEME_CSS_FILE, THEME_FILE, readCustomCss, readTheme } from './theme.mjs'

// The official Vercel CLI, pinned to an exact release published at least two
// weeks before it was chosen (62.1.0, published 2026-10-01; chosen
// 2026-10-16). Run it as `npx --yes vercel@62.1.0 …`.
export const VERCEL_CLI = 'vercel@62.1.0'
export const MANIFEST = 'ONLINE-MANIFEST.json'
export const VERCEL_IGNORE = '.vercelignore'
// Written into the output folder by a passing --check-locked, and used up by
// the next real copy. Stays on this computer (the .vercelignore allowlist
// never lists it).
export const LOCK_RECORD = 'LOCK-CHECK.json'
export const LOCK_RECORD_MAX_AGE_MS = 30 * 60 * 1000
// Made by the Vercel CLI when it links a folder to a project. Kept, never
// uploaded (the .vercelignore allowlist leaves them out), and never read here.
const CLI_ENTRIES = new Set(['.vercel', '.gitignore'])
const MODULES_DIR = 'instance/dashboard/modules'
const MODULES_FILE = 'instance/dashboard/modules.json'
const MAX_FILE_BYTES = 256 * 1024
const MAX_MODULE_FILES = 200
const MAX_TOTAL_BYTES = 8 * 1024 * 1024
// Finder's folder settings: never served by the dashboard, so never uploaded.
const IGNORED_NAMES = new Set(['.DS_Store'])

export class PublishRefused extends Error {
  constructor(reasons) {
    super(`Refused: ${reasons.join('; ')}`)
    this.reasons = reasons
  }
}

// ------------------------------------------------------- security policy

const COMMON_DIRECTIVES = [
  "default-src 'none'",
  "connect-src 'self'",
  "img-src 'none'",
  "font-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types 'none'",
]

// The same policy the local server sends. A <meta> copy cannot carry
// frame-ancestors, so it is left out there; the header keeps it.
export function onlinePolicy({ scriptSource = "'self'", styleSource = "'self'", meta = false } = {}) {
  return [
    ...COMMON_DIRECTIVES.slice(0, 1),
    `script-src ${scriptSource}`,
    `style-src ${styleSource}`,
    ...COMMON_DIRECTIVES.slice(1),
    ...(meta ? [] : ["frame-ancestors 'none'"]),
  ].join('; ')
}

// Vercel applies these headers to every file (vercel.json `headers`).
function vercelJson(policy) {
  const headers = [
    ['Content-Security-Policy', policy],
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'no-referrer'],
    ['X-Frame-Options', 'DENY'],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
    ['Cross-Origin-Resource-Policy', 'same-origin'],
    ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'],
    ['X-Robots-Tag', 'noindex, nofollow'],
    ['Cache-Control', 'no-cache'],
  ].map(([key, value]) => ({ key, value }))
  return `${JSON.stringify({ cleanUrls: false, trailingSlash: false, headers: [{ source: '/(.*)', headers }] }, null, 2)}\n`
}

const sha256Source = (text) => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`
const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)

// ------------------------------------------------------------ placeholder

const PLACEHOLDER_STYLE = [
  ':root{color-scheme:light dark;--bg:#f6f7f9;--ink:#0e1116;--muted:#5a6370}',
  '@media (prefers-color-scheme:dark){:root{--bg:#0a0c0f;--ink:#e7eaee;--muted:#96a0ac}}',
  'body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}',
  'main{max-width:560px;margin:0 auto;padding:64px 16px}h1{font-size:24px;line-height:1.25;margin:0 0 12px}p{margin:0;color:var(--muted)}',
].join('')

// No personal data and nothing read from Home Base.
export function buildPlaceholder() {
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">',
    `<title>Home Base</title><style>${PLACEHOLDER_STYLE}</style></head>`,
    '<body><main data-home-base-placeholder>',
    '<h1>This Home Base is locked</h1>',
    '<p>Only its owner can open it, after signing in with Vercel.</p>',
    '</main></body></html>',
  ].join('')
  return new Map([
    ['index.html', Buffer.from(`${html}\n`)],
    ['vercel.json', Buffer.from(vercelJson(onlinePolicy({ scriptSource: "'none'", styleSource: sha256Source(PLACEHOLDER_STYLE) })))],
  ])
}

// --------------------------------------------------------------- snapshot

const lexical = (realRoot, relative) => path.join(realRoot, ...relative.split('/'))
const lstat = (target) => fs.lstatSync(target, { throwIfNoEntry: false })

// Links are refused, not followed or skipped, wherever the snapshot reads.
function refuseLinks(realRoot, relatives, refuse) {
  for (const relative of relatives) {
    const stat = lstat(lexical(realRoot, relative))
    if (stat?.isSymbolicLink()) refuse(`${relative} is a link; only plain files and folders can go online`)
    else if (stat?.isFile() && stat.nlink > 1) refuse(`${relative} is a hard link; only plain files can go online`)
  }
}

function declaredModuleIds(realRoot) {
  try {
    const manifest = JSON.parse(readInside(realRoot, MODULES_FILE) || '{}')
    return (Array.isArray(manifest?.modules) ? manifest.modules : []).map((item) => item?.id).filter((id) => typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id))
  } catch {
    return []
  }
}

// Every file in a declared module's folder must be one the dashboard serves.
function collectModule(realRoot, id, files, refuse) {
  const base = `${MODULES_DIR}/${id}`
  let count = 0
  const walk = (relativeDir) => {
    for (const entry of fs.readdirSync(lexical(realRoot, relativeDir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${relativeDir}/${entry.name}`
      const inner = relative.slice(base.length + 1)
      const stat = lstat(lexical(realRoot, relative))
      if (!stat) continue
      if (stat.isSymbolicLink()) { refuse(`${relative} is a link; only plain files and folders can go online`); continue }
      if (stat.isDirectory()) { walk(relative); continue }
      if (IGNORED_NAMES.has(entry.name)) continue
      if (!stat.isFile()) { refuse(`${relative} is not a plain file`); continue }
      if (stat.nlink > 1) { refuse(`${relative} is a hard link; only plain files can go online`); continue }
      if (!resolveInstanceModuleFile(realRoot, id, inner)) {
        refuse(`${relative} is not a file the dashboard uses (only .js, .css, and .json files with plain names go online); move it out of the module folder`)
        continue
      }
      if (stat.size > MAX_FILE_BYTES) { refuse(`${relative} is larger than 256 KB`); continue }
      count += 1
      if (count > MAX_MODULE_FILES) { refuse(`${base} has more than ${MAX_MODULE_FILES} files`); return }
      const contents = readInside(realRoot, relative)
      if (!contents && stat.size > 0) { refuse(`${relative} could not be read safely`); continue }
      files.set(`instance-modules/${id}/${inner}`, Buffer.from(contents))
    }
  }
  walk(base)
}

// The local page in static mode: no key, cookie, or launch nonce; its data
// comes from the JSON files written next to it.
export function staticPage(distHtml, { themeLinks, publishedAt }) {
  const steps = [
    [/\n\s*<meta name="home-base-token" content="__HOME_BASE_LAUNCH__" \/>/, ''],
    ['__HOME_BASE_DB__', 'home-base-online'],
    ['<meta name="home-base-mode" content="local" />', `<meta name="home-base-mode" content="static" />\n    <meta name="home-base-published" content="${publishedAt}" />`],
    ['<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${onlinePolicy({ meta: true })}" />`],
    [THEME_SLOT, themeLinks],
  ]
  let html = distHtml
  for (const [from, to] of steps) {
    const next = html.replace(from, to)
    if (next === html) throw new Error('dist/index.html is missing a placeholder the online copy needs; rebuild the dashboard')
    html = next
  }
  return html
}

export function buildSnapshot(realRoot, { distDir, now = new Date() }) {
  const reasons = []
  const refuse = (reason) => reasons.push(reason)
  const files = new Map()

  refuseLinks(realRoot, ['instance', 'instance/dashboard', MODULES_DIR, MODULES_FILE, THEME_FILE, THEME_CSS_FILE], refuse)
  for (const id of declaredModuleIds(realRoot)) refuseLinks(realRoot, [`${MODULES_DIR}/${id}`], refuse)
  if (reasons.length) throw new PublishRefused(reasons)

  for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    if (entry.isFile() && /^[a-z0-9-]+\.(?:js|css)$/.test(entry.name)) files.set(`app/${entry.name}`, fs.readFileSync(path.join(distDir, entry.name)))
  }

  const theme = readTheme(realRoot)
  if (theme.tokens) files.set('instance-theme/tokens.css', Buffer.from(theme.tokens))
  const customCss = theme.customCss ? readCustomCss(realRoot) : null
  if (customCss) files.set('instance-theme/theme.css', Buffer.from(customCss))
  const themeLinks = [theme.tokens ? TOKENS_LINK : '', customCss ? CUSTOM_LINK : ''].filter(Boolean).join('\n    ')

  const modules = readInstanceModules(realRoot)
  for (const module of modules) collectModule(realRoot, module.id, files, refuse)
  if (reasons.length) throw new PublishRefused(reasons)

  const publishedAt = now.toISOString()
  files.set('index.html', Buffer.from(staticPage(fs.readFileSync(path.join(distDir, 'index.html'), 'utf8'), { themeLinks, publishedAt })))
  // Pretty-printed: the same JSON the local endpoints return.
  files.set('status.json', json(readStatus(realRoot)))
  files.set('modules.json', json({ modules }))
  files.set('theme-status.json', json({ schemaVersion: 1, state: theme.state, name: theme.name, notes: theme.notes, customCss: Boolean(customCss) }))
  files.set('vercel.json', Buffer.from(vercelJson(onlinePolicy())))
  return { files, publishedAt }
}

// ----------------------------------------------------------------- checks

const PRIVACY_WORDS = {
  email: 'an email address',
  phone: 'a phone number',
  'card-number': 'a card number',
  'last-four': 'the last digits of a card',
  'machine-path': 'a folder path from this computer',
  unscannable: 'something that cannot be read as text',
  'private-path': 'a private file name',
}

// The privacy scan's default rules (no denylist) and the credential check the
// validator uses. Findings name the file and line, never the matched text.
export function scanFiles(files) {
  const reasons = []
  let total = 0
  for (const [name, bytes] of files) {
    total += bytes.length
    if (containsCredentialShape(bytes.toString('utf8'))) reasons.push(`${name} contains text shaped like a password, key, or token`)
  }
  if (total > MAX_TOTAL_BYTES) reasons.push('the files add up to more than 8 MB')
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-online-scan-'))
  try {
    fs.chmodSync(staging, 0o700)
    for (const [name, bytes] of files) {
      const target = path.join(staging, ...name.split('/'))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, bytes, { mode: 0o600 })
    }
    const report = runPrivacyScan(['--tree', staging])
    for (const finding of report.findings) {
      reasons.push(`${finding.where} has ${PRIVACY_WORDS[finding.rule] ?? finding.rule}${finding.line === 'name' || finding.line === '-' ? '' : ` on line ${finding.line}`}`)
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
  return reasons
}

// --------------------------------------------------------------- output

const fold = (value) => value.normalize('NFC').toLowerCase()
function isInside(child, parent) {
  const relative = path.relative(fold(parent), fold(child))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

// The real path of a folder that may not exist yet: the nearest existing
// ancestor resolved through any links, plus the rest.
function realTarget(target) {
  let existing = path.resolve(target)
  const rest = []
  while (!fs.existsSync(existing)) {
    rest.unshift(path.basename(existing))
    const parent = path.dirname(existing)
    if (parent === existing) break
    existing = parent
  }
  return path.join(fs.realpathSync.native(existing), ...rest)
}

function readManifest(outDir) {
  const file = path.join(outDir, MANIFEST)
  const stat = lstat(file)
  if (!stat) return null
  if (!stat.isFile()) throw new PublishRefused([`${MANIFEST} in the output folder is not a plain file`])
  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('shape')
    return manifest
  } catch {
    throw new PublishRefused([`${MANIFEST} in the output folder cannot be read; use a new, empty folder`])
  }
}

// Every file in the folder must be one this tool wrote last time, or the
// Vercel CLI's own link files at the top.
function unknownEntries(outDir, known) {
  const unknown = []
  const walk = (relativeDir) => {
    for (const name of fs.readdirSync(path.join(outDir, ...relativeDir.split('/').filter(Boolean))).sort()) {
      const relative = relativeDir ? `${relativeDir}/${name}` : name
      if (!relativeDir && CLI_ENTRIES.has(name)) continue
      const stat = lstat(path.join(outDir, ...relative.split('/')))
      if (stat.isSymbolicLink()) unknown.push(relative)
      else if (stat.isDirectory()) walk(relative)
      else if (!known.has(relative)) unknown.push(relative)
    }
  }
  walk('')
  return unknown
}

// Checks the output folder and returns its real path and previous manifest.
// `requireManifest`: the folder must already hold this tool's files (the
// snapshot goes only where the placeholder went first).
export function prepareOutput(outDir, realRoot, { requireManifest = false } = {}) {
  if (typeof outDir !== 'string' || !outDir) throw new PublishRefused(['choose an output folder with --out'])
  const realOut = realTarget(outDir)
  if (isInside(realOut, realRoot)) throw new PublishRefused(['the output folder is inside your Home Base folder; choose a folder outside it, for example next to it'])
  if (isInside(realRoot, realOut)) throw new PublishRefused(['the output folder contains your Home Base folder; choose a new folder outside it'])
  if (fold(realOut) === fold(realTarget(os.homedir()))) throw new PublishRefused(['choose a new folder, not your home folder'])
  const given = lstat(path.resolve(outDir))
  if (given?.isSymbolicLink()) throw new PublishRefused(['the output folder is a link; choose a plain folder'])
  if (given && !given.isDirectory()) throw new PublishRefused(['the output path is a file, not a folder'])
  const previous = given ? readManifest(realOut) : null
  if (requireManifest && !previous) {
    throw new PublishRefused(['this folder has not been set up yet: build the placeholder here first and check the lock (see system/workflows/put-the-dashboard-online.md)'])
  }
  if (given) {
    const known = new Set([...(previous?.files ?? []).map((item) => item?.path), ...(previous ? [MANIFEST, VERCEL_IGNORE, LOCK_RECORD] : [])].filter((item) => typeof item === 'string'))
    const unknown = unknownEntries(realOut, known)
    if (unknown.length) {
      const shown = unknown.slice(0, 5).join(', ')
      throw new PublishRefused([`the output folder has files Home Base did not put there (${shown}${unknown.length > 5 ? `, and ${unknown.length - 5} more` : ''}); use a new, empty folder`])
    }
  }
  return { realOut, previous }
}

function removePrevious(realOut, previous) {
  if (!previous) return
  const names = [...previous.files.map((item) => item.path), VERCEL_IGNORE, MANIFEST, LOCK_RECORD]
  for (const name of names) {
    if (typeof name !== 'string' || name.split('/').some((part) => part === '' || part === '.' || part === '..')) continue
    const target = path.join(realOut, ...name.split('/'))
    if (lstat(target)?.isFile()) fs.rmSync(target)
  }
  // Empty folders left behind, deepest first; never the CLI's own.
  const folders = []
  const walk = (relative) => {
    for (const entry of fs.readdirSync(path.join(realOut, ...relative.split('/').filter(Boolean)), { withFileTypes: true })) {
      if (!relative && CLI_ENTRIES.has(entry.name)) continue
      if (entry.isDirectory()) { const child = relative ? `${relative}/${entry.name}` : entry.name; walk(child); folders.push(child) }
    }
  }
  walk('')
  for (const folder of folders.reverse()) {
    const target = path.join(realOut, ...folder.split('/'))
    if (fs.readdirSync(target).length === 0) fs.rmdirSync(target)
  }
}

// Writes the files, the .vercelignore allowlist (only the top-level files and
// folders written here can be uploaded; publish.mjs refuses stray files the
// next time it runs), and the manifest. Any lock record is used up. Returns
// the manifest.
export function writeOutput(realOut, previous, files, { kind, createdAt }) {
  fs.mkdirSync(realOut, { recursive: true, mode: 0o700 })
  removePrevious(realOut, previous)
  const listed = [...files.keys()].sort()
  for (const name of listed) {
    const target = path.join(realOut, ...name.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, files.get(name))
  }
  const topLevel = [...new Set(listed.map((name) => name.split('/')[0]))].sort()
  fs.writeFileSync(path.join(realOut, VERCEL_IGNORE), [
    '# Written by Home Base (system/dashboard/publish.mjs). Only these go online.',
    '/*',
    ...topLevel.map((name) => `!${name}`),
    '',
  ].join('\n'))
  const manifest = {
    schemaVersion: 1,
    kind,
    createdAt,
    vercelCli: VERCEL_CLI,
    files: listed.map((name) => ({ path: name, bytes: files.get(name).length, sha256: crypto.createHash('sha256').update(files.get(name)).digest('hex') })),
    localOnly: [VERCEL_IGNORE, MANIFEST, LOCK_RECORD],
  }
  fs.writeFileSync(path.join(realOut, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

// ------------------------------------------------------------ lock record

// After a passing lock check: notes in the output folder (which must already
// hold this tool's files) which addresses passed, and when.
export function recordLockCheck(outDir, realRoot, origins, now = new Date()) {
  const { realOut } = prepareOutput(outDir, realRoot, { requireManifest: true })
  fs.writeFileSync(path.join(realOut, LOCK_RECORD), `${JSON.stringify({ schemaVersion: 1, checkedAt: now.toISOString(), addresses: origins }, null, 2)}\n`)
  return realOut
}

// After a failed lock check: an older record no longer counts.
export function clearLockRecord(outDir, realRoot) {
  const { realOut } = prepareOutput(outDir, realRoot, { requireManifest: true })
  const target = path.join(realOut, LOCK_RECORD)
  if (lstat(target)?.isFile()) fs.rmSync(target)
}

// The real copy is written only into a folder the placeholder was uploaded
// from (the Vercel CLI linked it: .vercel/project.json) and only within 30
// minutes after a lock check passed for that folder.
export function requireLockCheck(realOut, now = new Date()) {
  const reasons = []
  if (!lstat(path.join(realOut, '.vercel'))?.isDirectory() || !lstat(path.join(realOut, '.vercel', 'project.json'))?.isFile()) {
    reasons.push('the placeholder has not been uploaded from this folder yet; upload it and turn on the lock first (see system/workflows/put-the-dashboard-online.md)')
  }
  const recordPath = path.join(realOut, LOCK_RECORD)
  let checkedAt = Number.NaN
  let addresses = []
  if (lstat(recordPath)?.isFile()) {
    try {
      const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
      checkedAt = Date.parse(record.checkedAt)
      addresses = Array.isArray(record.addresses) ? record.addresses : []
    } catch { checkedAt = Number.NaN }
  }
  // When the Vercel CLI noted the project's name, every checked address must
  // be one of that project's own (its addresses start with the name).
  let projectName = null
  try { projectName = JSON.parse(fs.readFileSync(path.join(realOut, '.vercel', 'project.json'), 'utf8')).projectName } catch { projectName = null }
  if (typeof projectName === 'string' && projectName && Number.isFinite(checkedAt)) {
    const prefix = projectName.toLowerCase()
    const foreign = addresses.filter((address) => { try { return !new URL(address).hostname.toLowerCase().startsWith(prefix) } catch { return true } })
    if (addresses.length === 0 || foreign.length) reasons.push(`the lock was checked on an address that is not this project’s (${projectName}); check the addresses the upload printed`)
  }
  const age = now.getTime() - checkedAt
  if (!Number.isFinite(checkedAt) || age < -60_000 || age > LOCK_RECORD_MAX_AGE_MS) {
    reasons.push('check the lock first: node system/dashboard/publish.mjs --check-locked <production address> <deployment address> --out <this folder> must pass within the 30 minutes before the real copy is built')
  }
  if (reasons.length) throw new PublishRefused(reasons)
}

// ------------------------------------------------------- automatic update

// An automatic update (a standing yes the user recorded) only re-publishes the
// same kind of copy the user already saw go online: never a first upload, and
// never a file path the previous copy did not have (a new module, a new file).
// Anything else stops so the assistant can show the list and ask.
export function requireSameFiles(previous, files) {
  if (previous?.kind !== 'snapshot' || !Array.isArray(previous.files)) {
    throw new PublishRefused(['an automatic update never makes the first upload of your dashboard; show the file list and ask the user'])
  }
  const before = new Set(previous.files.map((item) => item?.path).filter((item) => typeof item === 'string'))
  const added = [...files.keys()].filter((name) => !before.has(name)).sort()
  if (added.length) {
    const shown = added.slice(0, 10).join(', ')
    throw new PublishRefused([`this copy has files the last upload did not have (${shown}${added.length > 10 ? `, and ${added.length - 10} more` : ''}); an automatic update stops here: show the file list and ask the user`])
  }
}

// ------------------------------------------------------------ lock check

// Paths asked for on each address: the page, the data, and an asset.
export const PROBE_PATHS = ['/', '/index.html', '/status.json', '/app/main.js']
// Text that appears only in Home Base's own pages and data.
const HOME_BASE_MARKERS = ['home-base-mode', 'data-home-base-placeholder', '"schemaVersion"', 'Home Base']
const LOGIN_PATHS = [/^\/login(?:\/|$)/, /^\/sso-api(?:\/|$)/, /^\/sso(?:\/|$)/]
// Vercel's firewall or bot protection, not its sign-in: such an answer can
// refuse this check while a browser is let through.
const MITIGATED = 'x-vercel-mitigated'

function fromVercel(headers) {
  if (/vercel/i.test(headers.get('server') ?? '')) return true
  for (const name of headers.keys()) if (name.toLowerCase().startsWith('x-vercel-')) return true
  return false
}

async function readSome(response, limit = 64 * 1024) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (size < limit) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.length
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

// One anonymous request: no cookies, no stored sign-in, redirects not followed.
// Returns { ok, status, why }. The body is searched, never returned.
export async function probe(url, { timeoutMs = 15_000 } = {}) {
  let response
  try {
    response = await fetch(url, {
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'user-agent': 'home-base-lock-check', accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return { ok: false, status: null, why: 'could not be reached' }
  }
  const { status } = response
  if (response.headers.has(MITIGATED)) {
    await response.body?.cancel().catch(() => {})
    return { ok: false, status, why: 'a Vercel firewall or bot check answered, not the Vercel sign-in' }
  }
  if (status >= 300 && status < 400) {
    await response.body?.cancel().catch(() => {})
    let target = null
    try { target = new URL(response.headers.get('location') ?? '', url) } catch { target = null }
    const toVercelLogin = target && target.protocol === 'https:' && target.hostname === 'vercel.com' && !target.username && !target.password && LOGIN_PATHS.some((pattern) => pattern.test(target.pathname))
    return toVercelLogin
      ? { ok: true, status, why: 'sends you to sign in with Vercel' }
      : { ok: false, status, why: 'redirects somewhere other than the Vercel sign-in' }
  }
  const body = await readSome(response).catch(() => '')
  if (HOME_BASE_MARKERS.some((marker) => body.includes(marker))) return { ok: false, status, why: 'answered with Home Base content without a sign-in' }
  // Vercel Authentication answers an anonymous request with 401. A 403 can
  // come from a firewall or bot rule that lets browsers through, so it fails.
  if (status === 401) {
    return fromVercel(response.headers)
      ? { ok: true, status, why: 'Vercel asks for a sign-in' }
      : { ok: false, status, why: 'refused, but not with Vercel’s sign-in' }
  }
  if (status === 403) return { ok: false, status, why: 'refused without asking for a sign-in (a firewall or bot rule can do this while browsers get through)' }
  return { ok: false, status, why: status >= 200 && status < 300 ? 'answered without a sign-in' : 'did not ask for a Vercel sign-in' }
}

// Normalises an address to its origin. Only https, unless a test allows a
// plain local address.
export function lockCheckOrigin(address, { allowLocalHttp = false } = {}) {
  let url
  try { url = new URL(address) } catch { return null }
  if (url.username || url.password) return null
  const local = allowLocalHttp && url.protocol === 'http:' && url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !local) return null
  return url.origin
}

// Passes only when every path on every address is Vercel's sign-in wall.
export async function checkLocked(addresses, { allowLocalHttp = false, timeoutMs } = {}) {
  const results = []
  for (const address of addresses) {
    const origin = lockCheckOrigin(address, { allowLocalHttp })
    if (!origin) throw new PublishRefused([`not an https address: ${String(address).slice(0, 200)}`])
    for (const pathname of PROBE_PATHS) results.push({ url: `${origin}${pathname}`, ...(await probe(`${origin}${pathname}`, { timeoutMs })) })
  }
  return { locked: results.length > 0 && results.every((result) => result.ok), results }
}

export function formatBytes(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}
