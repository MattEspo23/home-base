// Read-only Home Base status for the local dashboard.
//
// What it may return: allowlisted setup fields validated against fixed values,
// the names of *linked* items in a few fixed index sections, assistant names
// parsed from linked capability items, validated dates, counts, and whether the
// adapter files exist. Never: file bodies, unlinked free text, other
// frontmatter keys, or anything read through a symbolic link or from outside
// the Home Base folder.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const MAX_BYTES = 256 * 1024
const MAX_ITEMS = 50
const MAX_NAME = 80

const SETUP_STATUS = new Set(['not_started', 'in_progress', 'complete'])
const STAGES = new Set(['orient', 'opportunity_map', 'blueprint', 'build', 'complete'])
const DISCOVERY_PATHS = new Set(['none', 'personal', 'work', 'both'])
// Question ids the start workflow uses. Anything else that looks like an id is
// reported as `other`, so free text written into next_question never leaves.
const QUESTION_IDS = new Set([
  'scope', 'name', 'current_world', 'desired_change', 'repeated_friction',
  'information_and_tools', 'people', 'proof', 'control', 'none',
])

const ASSISTANT_SECTIONS = new Map([
  ['available and verified', 'verified'],
  ['available but unverified', 'unverified'],
  ['missing or blocked', 'blocked'],
])

// ------------------------------------------------------------ safe reading

// Resolve the Home Base folder once, to its real path.
export function resolveHomeBase(candidate) {
  const real = fs.realpathSync.native(path.resolve(candidate))
  if (!fs.statSync(real).isDirectory()) throw new Error('Home Base path is not a folder')
  return real
}

// Read a fixed relative file inside the Home Base folder. Refuses symbolic
// links anywhere on the path (the real path must equal the plain joined path),
// non-regular files, and files over MAX_BYTES. Returns '' when refused.
export function readInside(realRoot, relative) {
  const lexical = path.join(realRoot, ...relative.split('/'))
  let real
  try {
    const stat = fs.lstatSync(lexical)
    // A hard link can point at a file that also lives outside the folder.
    if (!stat.isFile() || stat.nlink > 1 || stat.size > MAX_BYTES) return ''
    real = fs.realpathSync.native(lexical)
  } catch {
    return ''
  }
  if (real !== lexical) return ''
  let descriptor
  try {
    descriptor = fs.openSync(lexical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.nlink > 1 || stat.size > MAX_BYTES) return ''
    const buffer = Buffer.alloc(stat.size)
    let offset = 0
    while (offset < buffer.length) {
      const read = fs.readSync(descriptor, buffer, offset, buffer.length - offset, offset)
      if (read === 0) break
      offset += read
    }
    // A byte-order mark some editors add would hide frontmatter and headings.
    return buffer.subarray(0, offset).toString('utf8').replace(/^\uFEFF/, '')
  } catch {
    return ''
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

// True when the path exists as the given kind, without following links.
function existsAs(realRoot, relative, kind) {
  const lexical = path.join(realRoot, ...relative.split('/'))
  try {
    const stat = fs.lstatSync(lexical)
    if (stat.isSymbolicLink()) return false
    if (fs.realpathSync.native(lexical) !== lexical) return false
    return kind === 'dir' ? stat.isDirectory() : stat.isFile()
  } catch {
    return false
  }
}

// True when something exists at the path, without following a link at the
// end. Used only to explain why a file that is there was not used.
export function pathPresent(realRoot, relative) {
  try {
    fs.lstatSync(path.join(realRoot, ...relative.split('/')))
    return true
  } catch {
    return false
  }
}

// --------------------------------------------------------------- parsing

// A one-line YAML value: surrounding spaces, one pair of matching quotes, and
// a trailing ` # comment` are removed. Every result is still checked against
// the fixed values below, so nothing else is interpreted.
function scalarValue(raw) {
  const text = raw.trim()
  const quoted = text.match(/^(["'])(.*?)\1(?:\s+#.*)?$/)
  if (quoted) return quoted[2].trim()
  return text.replace(/(?:^|\s)#.*$/, '').trim()
}

export function parseSetup(contents) {
  const setup = { status: null, stage: null, discoveryPath: null, orientationCompleted: null, nextQuestion: null }
  const match = contents.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return setup
  const values = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([a-z_]+):\s*(.*)$/)
    if (pair) values[pair[1]] = scalarValue(pair[2])
  }
  if (SETUP_STATUS.has(values.setup_status)) setup.status = values.setup_status
  if (STAGES.has(values.stage)) setup.stage = values.stage
  if (DISCOVERY_PATHS.has(values.discovery_path)) setup.discoveryPath = values.discovery_path
  if (/^[0-8]$/.test(values.orientation_completed ?? '')) setup.orientationCompleted = Number(values.orientation_completed)
  const question = values.next_question ?? ''
  if (QUESTION_IDS.has(question)) setup.nextQuestion = question
  else if (/^[a-z][a-z0-9_]{0,31}$/.test(question)) setup.nextQuestion = 'other'
  return setup
}

const GRAPHEMES = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
// One user-perceived character longer than this (a letter stacked with many
// combining marks) ends the name, so a short name is also a small one.
const MAX_CHARACTER_UNITS = 32

// At most `max` user-perceived characters, ending with an ellipsis when
// shortened so a cut name does not read as the whole name. The cut falls between
// characters: emoji and accented letters stay whole. Without Intl.Segmenter
// the cut falls between code points, which still keeps surrogate pairs whole.
function shorten(text, max) {
  if (text.length <= max) return text
  const kept = []
  let cut = false
  for (const part of GRAPHEMES ? GRAPHEMES.segment(text) : text) {
    const character = GRAPHEMES ? part.segment : part
    if (kept.length === max || character.length > MAX_CHARACTER_UNITS) { cut = true; break }
    kept.push(character)
  }
  if (!cut) return text
  return `${kept.slice(0, max - 1).join('').trimEnd()}\u2026`
}

function cleanName(text, max = MAX_NAME) {
  const collapsed = text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return shorten(collapsed, max)
}

// The first Markdown link on a list or table line, when its target is a
// relative link inside the folder. Unlinked lines return null.
function linkedItem(line) {
  if (!/^(?:[-*+]\s+|\d+[.)]\s+|\|)/.test(line)) return null
  const link = line.match(/\[([^\]]{1,200})\]\(([^)\s]{1,300})\)/)
  if (!link) return null
  const target = link[2]
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/') || target.startsWith('\\') || target.startsWith('#')) return null
  const name = cleanName(link[1])
  return name ? name : null
}

function isoDate(line) {
  const match = line.match(/\bchecked\s+(\d{4})-(\d{2})-(\d{2})\b/i)
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${match[1]}-${match[2]}-${match[3]}`
}

// Placeholder lines such as "None." or "- No tools recorded yet." are not
// entries.
const PLACEHOLDER = /^(?:none|nothing|no\s|n\/a\b|tbd\b)/i
const TABLE_SEPARATOR = /^\|[\s:|-]+\|?$/

// An indented line that continues the list item above it, as editors and
// assistants write when a long line wraps.
const CONTINUATION = /^(?: ?\t| {2})[ \t]*\S/
// Enough wrapped text to find a date; the rest of a long item is skipped.
const MAX_ITEM_TEXT = 1024

// Sections keyed by lower-case `## ` heading. Each item keeps only the linked
// name and, when present, a validated "checked YYYY-MM-DD" date, which may sit
// on a wrapped continuation line. Each section also keeps its unlinked entries
// in `unlinked`, for counting only: their text never leaves this module.
export function parseIndex(contents) {
  const sections = new Map()
  let current = null
  let inFence = false
  let lastUnlinkedRow = false
  // The linked list item still open for continuation lines, and its text so
  // far. The text is used only to find the date and is never stored.
  let open = null
  let openText = ''
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim()
    const wasUnlinkedRow = lastUnlinkedRow
    lastUnlinkedRow = false
    if (line.startsWith('```')) { inFence = !inFence; open = null; continue }
    if (inFence) continue
    if (open && CONTINUATION.test(raw) && !/^(?:[-*+]\s|\d+[.)]\s|\||#{1,6}(?:\s|$))/.test(line)) {
      if (openText.length < MAX_ITEM_TEXT) {
        openText += ` ${line}`
        open.checked = isoDate(openText)
      }
      continue
    }
    open = null
    const heading = line.match(/^##\s+(.{1,80})$/)
    if (heading) {
      current = Object.assign([], { unlinked: [] })
      sections.set(heading[1].trim().toLowerCase(), current)
      continue
    }
    if (!current) continue
    if (TABLE_SEPARATOR.test(line)) {
      // The row above a separator is a table header, not an entry.
      if (wasUnlinkedRow) current.unlinked.pop()
      continue
    }
    const name = linkedItem(line)
    if (name) {
      if (current.length < MAX_ITEMS) {
        const item = { name, checked: isoDate(line) }
        current.push(item)
        // Table rows do not wrap; list items may.
        if (!line.startsWith('|')) { open = item; openText = line }
      }
      continue
    }
    const entry = line.match(/^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/)?.[1] ?? (line.startsWith('|') ? line.replace(/[|\s]+/g, ' ').trim() : null)
    if (entry && !PLACEHOLDER.test(entry)) {
      current.unlinked.push(entry)
      lastUnlinkedRow = line.startsWith('|')
    }
  }
  return sections
}

const unlinkedCount = (sections, ...headings) => headings.reduce((sum, heading) => sum + (sections.get(heading)?.unlinked.length ?? 0), 0)

const names = (sections, heading) => (sections.get(heading) ?? []).map((item) => item.name)

const ASSISTANT_LINE = /^(.{1,60}?)\s+(opens|reaches)\s+Home Base\b/i

// Assistant lines that the dashboard cannot show because they have no local
// link. Only the count is returned.
export function unlinkedAssistantCount(contents) {
  const sections = parseIndex(contents)
  let count = 0
  for (const heading of ASSISTANT_SECTIONS.keys()) {
    for (const entry of sections.get(heading)?.unlinked ?? []) {
      if (/\b(?:opens|reaches)\s+Home Base\b/i.test(entry.replace(/[*_`[\]]/g, ''))) count += 1
    }
  }
  return count
}

export function parseAssistants(contents) {
  const sections = parseIndex(contents)
  const assistants = []
  for (const [heading, state] of ASSISTANT_SECTIONS) {
    for (const item of sections.get(heading) ?? []) {
      const match = item.name.match(ASSISTANT_LINE)
      if (!match) continue
      // "Verified" needs a real calendar date in the line; without one the
      // assistant shows as not verified yet.
      assistants.push({ name: match[1], reach: match[2].toLowerCase(), state: state === 'verified' && !item.checked ? 'unverified' : state, checked: item.checked })
    }
  }
  return assistants
}

function repositorySkillCount(realRoot) {
  const found = new Set()
  for (const folder of ['.agents/skills', '.claude/skills']) {
    if (!existsAs(realRoot, folder, 'dir')) continue
    for (const entry of fs.readdirSync(path.join(realRoot, ...folder.split('/')), { withFileTypes: true })) {
      if (entry.isDirectory() && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name) && existsAs(realRoot, `${folder}/${entry.name}/SKILL.md`, 'file')) {
        found.add(entry.name)
      }
    }
  }
  return found.size
}

function releaseVersion(realRoot) {
  try {
    const version = JSON.parse(readInside(realRoot, 'system/release-manifest.json') || '{}').version
    return typeof version === 'string' && /^\d+\.\d+\.\d+(?:-dev\.\d+)?$/.test(version) ? version : null
  } catch {
    return null
  }
}

export function readStatus(realRoot) {
  const projects = parseIndex(readInside(realRoot, 'projects/INDEX.md'))
  const systems = parseIndex(readInside(realRoot, 'systems/INDEX.md'))
  const skills = parseIndex(readInside(realRoot, 'skills/INDEX.md'))
  const capabilities = readInside(realRoot, 'capabilities/INDEX.md')
  return {
    schemaVersion: 1,
    version: releaseVersion(realRoot),
    setup: parseSetup(readInside(realRoot, 'you/SETUP.md')),
    projects: { active: names(projects, 'active') },
    systems: {
      active: names(systems, 'active'),
      building: names(systems, 'building or testing'),
      designing: names(systems, 'designing'),
    },
    assistants: parseAssistants(capabilities),
    skills: { repository: repositorySkillCount(realRoot), user: names(skills, 'active').length },
    // Entries written without a local link: counts only, never their text.
    unlinked: {
      projects: unlinkedCount(projects, 'active'),
      systems: unlinkedCount(systems, 'active', 'building or testing'),
      skills: unlinkedCount(skills, 'active'),
      assistants: unlinkedAssistantCount(capabilities),
    },
    adapters: {
      agentsMd: existsAs(realRoot, 'AGENTS.md', 'file'),
      claudeMd: existsAs(realRoot, 'CLAUDE.md', 'file'),
      agentsSkills: existsAs(realRoot, '.agents/skills', 'dir'),
      claudeSkills: existsAs(realRoot, '.claude/skills', 'dir'),
    },
  }
}

// ------------------------------------------------------- instance modules

// Declared in instance/dashboard/modules.json and served only from
// instance/dashboard/modules/<id>/, with no symbolic links on the path.
export function readInstanceModules(realRoot) {
  const manifestText = readInside(realRoot, 'instance/dashboard/modules.json')
  if (!manifestText) return []
  let manifest
  try { manifest = JSON.parse(manifestText) } catch { return [] }
  return (Array.isArray(manifest?.modules) ? manifest.modules : [])
    .filter((item) => /^[a-z0-9-]{1,40}$/.test(item?.id ?? '') && /^[A-Za-z0-9._/-]{1,120}\.js$/.test(item?.entry ?? '') && !item.entry.split('/').some((part) => part === '..' || part === '.' || part === ''))
    .filter((item) => resolveInstanceModuleFile(realRoot, item.id, item.entry) !== null)
    .slice(0, 12)
    .map((item) => ({ id: item.id, title: cleanName(String(item.title ?? item.id), 60) || item.id, url: `/instance-modules/${item.id}/${item.entry}` }))
}

export function resolveInstanceModuleFile(realRoot, id, relative) {
  if (!/^[a-z0-9-]{1,40}$/.test(id) || !/^[A-Za-z0-9._/-]{1,160}$/.test(relative)) return null
  if (relative.split('/').some((part) => part === '..' || part === '.' || part === '')) return null
  if (!['.js', '.css', '.json'].includes(path.extname(relative))) return null
  const target = `instance/dashboard/modules/${id}/${relative}`
  if (!existsAs(realRoot, target, 'file')) return null
  return target
}

// ------------------------------------------------------ per-install identity

// Ports a dashboard must never use: a reserved local app port, the common
// dev-server port, and a few busy defaults.
export const BLOCKED_PORTS = new Set([4173, 5173, 3000, 5000, 8000, 8080, 8888])
export const IDENTITY_FILE = '.home-base/state/dashboard.json'
const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function portAllowed(port) {
  return Number.isInteger(port) && port >= 1024 && port <= 65535 && !BLOCKED_PORTS.has(port)
}

// A folder is treated as a Home Base only when it has both of these files.
// The launcher checks this before writing anything.
export function looksLikeHomeBase(realRoot) {
  return existsAs(realRoot, 'AGENTS.md', 'file') && existsAs(realRoot, 'you/SETUP.md', 'file')
}

export function deriveIdentity(seed) {
  const hash = crypto.createHash('sha256').update(`home-base-dashboard:${seed}`).digest()
  let port = 20000 + (hash.readUInt32BE(0) % 20000)
  while (BLOCKED_PORTS.has(port)) port += 1
  return { port, dbName: `home-base-${hash.toString('hex').slice(8, 20)}` }
}

// Salted with the per-install key, so the stored value cannot be matched
// against a list of likely folder paths.
function rootFingerprint(realRoot, key) {
  return crypto.createHmac('sha256', key).update(`home-base-root:${realRoot}`).digest('hex').slice(0, 32)
}

// The unsalted form written by 1.1.0-dev.2, accepted once so an existing
// install keeps its port and browser database when it gains a key.
function legacyFingerprint(realRoot) {
  return crypto.createHash('sha256').update(`home-base-root:${realRoot}`).digest('hex').slice(0, 16)
}

function readJsonInside(realRoot, relative) {
  try { return JSON.parse(readInside(realRoot, relative) || 'null') } catch { return null }
}

function ensureRealDirectory(realRoot, relative) {
  const lexical = path.join(realRoot, ...relative.split('/'))
  const stat = fs.lstatSync(lexical, { throwIfNoEntry: false })
  if (!stat) fs.mkdirSync(lexical, { mode: 0o700 })
  else if (!stat.isDirectory()) throw new Error(`${relative} is not a plain folder`)
  if (fs.realpathSync.native(lexical) !== lexical) throw new Error(`${relative} is reached through a link`)
}

// Written atomically with mode 0600. A link at the target is replaced, never
// written through.
function writeIdentity(realRoot, record) {
  ensureRealDirectory(realRoot, '.home-base')
  ensureRealDirectory(realRoot, '.home-base/state')
  const file = path.join(realRoot, ...IDENTITY_FILE.split('/'))
  const pending = `${file}.pending-${process.pid}-${crypto.randomUUID()}`
  fs.writeFileSync(pending, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  fs.renameSync(pending, file)
}

function identityFileMode(realRoot) {
  try { return fs.lstatSync(path.join(realRoot, ...IDENTITY_FILE.split('/'))).mode & 0o777 } catch { return null }
}

export const newKey = () => crypto.randomBytes(32).toString('base64url')

// The identity (port, browser database name, and a random per-install key)
// is created at first launch and saved, so `init` later adding an
// installationId does not move the port or the browser database. A copied or
// moved folder gets a fresh identity. Options: `port` saves a chosen port,
// `rotateKey` replaces the key (old browser sign-ins stop working).
export function loadIdentity(realRoot, { persist = true, port: chosenPort, rotateKey = false } = {}) {
  const saved = readJsonInside(realRoot, IDENTITY_FILE)
  const savedShapeOk = saved?.schemaVersion === 1 && portAllowed(saved.port) && /^home-base-[0-9a-f]{12}$/.test(saved.dbName ?? '')
  const savedKey = typeof saved?.key === 'string' && KEY_PATTERN.test(saved.key) ? saved.key : null
  const reuse = savedShapeOk && (savedKey
    ? saved.rootFingerprint === rootFingerprint(realRoot, savedKey)
    : saved.rootFingerprint === legacyFingerprint(realRoot))
  let identity
  if (reuse) {
    identity = { port: saved.port, dbName: saved.dbName }
  } else {
    const installationId = readJsonInside(realRoot, '.home-base/state/update-state.json')?.installationId
    const seed = `${typeof installationId === 'string' && /^[0-9a-f-]{36}$/i.test(installationId) ? installationId : 'uninitialized'}|${realRoot}`
    identity = deriveIdentity(seed)
  }
  const key = reuse && savedKey && !rotateKey ? savedKey : newKey()
  if (chosenPort !== undefined) {
    if (!portAllowed(chosenPort)) throw new Error('Port is reserved or invalid')
    identity.port = chosenPort
  }
  const changed = !reuse || key !== savedKey || identity.port !== saved.port || identityFileMode(realRoot) !== 0o600
  if (persist && changed) {
    writeIdentity(realRoot, {
      schemaVersion: 1,
      rootFingerprint: rootFingerprint(realRoot, key),
      port: identity.port,
      dbName: identity.dbName,
      key,
      createdAt: reuse && typeof saved.createdAt === 'string' ? saved.createdAt : new Date().toISOString(),
    })
  }
  return { ...identity, key, persisted: reuse }
}
