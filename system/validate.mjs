#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { containsCredentialShape } from './lib/contracts.mjs'
import { loadCapabilityRegistry } from './lib/capability-doctor.mjs'
import { validateSkillVaultProjection } from './lib/skill-vault-contract.mjs'
import { updateInternals } from './lib/safe-update-contract.mjs'

const systemDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(systemDir, '..')
const errors = []
const checks = []
const notes = []
let skillVaultPackageNames = new Set()

// The release rules (no media, no links or special files, valid local links,
// no credential-shaped text, no source maps, valid setup and skill metadata)
// block only the maintained release files named in the manifest. Everything
// else in the folder (the user's own folders, and any other file or folder
// such as a stray screenshot, an editor's settings folder, or a folder an
// assistant created) is checked too, but a problem there is a note, never a
// failure: updates, rollbacks, and recovery run this validator (the 1.0.x
// updater runs it with no flags), and the user's files must never stop them.
// `--release` makes the notes failures again, for a pristine release tree
// (package.mjs uses it). Without a readable manifest, everything is strict.
const releaseMode = process.argv.includes('--release')
const fold = (name) => name.normalize('NFKC').toLowerCase()
const maintainedRoots = (() => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'system', 'release-manifest.json'), 'utf8'))
    if (!Array.isArray(manifest.maintainedPaths) || manifest.maintainedPaths.length === 0) return null
    return new Set(manifest.maintainedPaths.map(fold))
  } catch {
    return null
  }
})()
// Symbolic links and special files found while walking; never followed or read.
const oddEntries = new Map()

function pass(message) {
  checks.push(message)
}

function fail(message) {
  errors.push(message)
}

// True for a path inside a maintained release root (case-folded, so a case
// variant such as System/ stays strict).
function isRelease(relativePath) {
  return maintainedRoots === null || maintainedRoots.has(fold(relativePath.split('/')[0]))
}

// The user's files: everything outside the maintained release roots.
const isUsers = (relativePath) => !isRelease(relativePath)

// A problem outside the maintained files is a note unless --release is given.
function problem(relativePath, message) {
  if (isUsers(relativePath) && !releaseMode) notes.push(message)
  else fail(message)
}

function relative(filePath) {
  return path.relative(root, filePath).split(path.sep).join('/')
}

function read(relativePath) {
  const absolutePath = path.join(root, relativePath)
  if (!fs.existsSync(absolutePath)) {
    problem(relativePath, `Missing required file: ${relativePath}`)
    return ''
  }
  return fs.readFileSync(absolutePath, 'utf8')
}

function walk(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ['.git', '.home-base', 'node_modules'].includes(entry.name)) {
      return []
    }
    // instance/ (any letter case) is the user's private overlay: never
    // packaged, never an update target, and outside every rule here.
    if (directory === root && fold(entry.name) === updateInternals.INSTANCE_ROOT) return []
    if (entry.isFile() && entry.name.endsWith('.tgz')) return []
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(entryPath)
    if (entry.isFile()) {
      if (fs.lstatSync(entryPath).nlink > 1) oddEntries.set(relative(entryPath), 'a hard-linked file')
      return [entryPath]
    }
    // A symbolic link (to a file or a folder) or a special file is recorded,
    // never followed or read.
    oddEntries.set(relative(entryPath), entry.isSymbolicLink() ? 'a symbolic link' : 'a special file (socket, device, or pipe)')
    return []
  })
}

function frontmatter(contents, filePath) {
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) {
    problem(filePath, `${filePath} must start with YAML frontmatter`)
    return {}
  }

  return Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/))
      .filter(Boolean)
      .map((matchLine) => [
        matchLine[1],
        matchLine[2].replace(/^["']|["']$/g, '').trim(),
      ]),
  )
}

const requiredFiles = [
  'README.md',
  'LICENSE',
  'NOTICE.md',
  'THIRD_PARTY_LICENSES/matt-pocock-MIT.txt',
  'THIRD_PARTY_NOTICES.md',
  'PROVENANCE.json',
  'TRADEMARKS.md',
  'BRAND-ASSETS.md',
  'channels/stable.json',
  'channels/preview.json',
  'SUPPORT.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'SETUP-GUIDE.md',
  'START-HERE.md',
  'SOP-STARTER.md',
  'AGENTS.md',
  'CLAUDE.md',
  'RELEASE-NOTES.md',
  'VERSION.md',
  '.gitignore',
  'system/WORKSPACE-CONTRACT.md',
  'system/README.md',
  'system/LEARNING-LOOP.md',
  'system/SAFETY.md',
  'system/UPDATE-GUIDE.md',
  'system/validate.mjs',
  'system/prove.mjs',
  'system/package.mjs',
  'system/retrieve-release.mjs',
  'system/update.mjs',
  'system/inspect-runtime.mjs',
  'system/capability-registry.json',
  'system/test-capability-doctor.mjs',
  'system/test-safe-update.mjs',
  'system/test-release-retrieval.mjs',
  'system/test-tracked-files.mjs',
  'system/test-instance-skills.mjs',
  'system/instance-skills.mjs',
  'system/privacy-scan.mjs',
  'system/privacy-allowlist.json',
  'system/test-privacy-scan.mjs',
  'system/hooks/pre-push',
  'system/PROMOTION.md',
  'system/test-transition.mjs',
  'system/dashboard/README.md',
  'system/dashboard/serve.mjs',
  'system/dashboard/build.mjs',
  'system/dashboard/test-dashboard.mjs',
  'system/dashboard/publish.mjs',
  'system/dashboard/test-publish.mjs',
  'system/dashboard/lib/online.mjs',
  'system/dashboard/lib/server.mjs',
  'system/dashboard/lib/status.mjs',
  'system/dashboard/lib/theme.mjs',
  'system/dashboard/lib/chrome.mjs',
  'system/dashboard/preview-theme.mjs',
  'system/dashboard/themes/precise.json',
  'system/dashboard/themes/soft.json',
  'system/dashboard/themes/night.json',
  'system/dashboard/themes/calm.json',
  'system/dashboard/src/index.html',
  'system/dashboard/dist/index.html',
  'system/dashboard/dist/build-info.json',
  'system/dashboard/dist/main.js',
  'system/dashboard/dist/styles.css',
  'system/release-manifest.json',
  'system/lib/contracts.mjs',
  'system/lib/update-contract.mjs',
  'system/lib/safe-update-contract.mjs',
  'system/lib/capability-doctor.mjs',
  'system/lib/skill-vault-contract.mjs',
  'system/lib/release-retrieval-contract.mjs',
  'system/lib/tracked-files.mjs',
  'system/distribution/README.md',
  'system/distribution/SKILL-CATALOG.md',
  'system/distribution/skill-vault.lock.json',
  'system/distribution/sync-skill-vault.mjs',
  'system/distribution/skill-vault/LICENSE',
  'system/distribution/skill-vault/NOTICE.md',
  'system/distribution/skill-vault/THIRD_PARTY_LICENSES/matt-pocock-MIT.txt',
  'system/distribution/skill-vault/THIRD_PARTY_NOTICES.md',
  'system/distribution/skill-vault/PROVENANCE.json',
  'system/distribution/skill-vault/SUPPORT.md',
  'system/distribution/skill-vault/SECURITY.md',
  'system/workflows/start.md',
  'system/workflows/deepen.md',
  'system/workflows/build-a-skill.md',
  'system/workflows/discover-sops.md',
  'system/workflows/discover-opportunities.md',
  'system/workflows/blueprint-a-system.md',
  'system/workflows/build-a-system.md',
  'system/workflows/inspect-capabilities.md',
  'system/workflows/enter-build-mode.md',
  'system/workflows/review-interface-and-deployment.md',
  'system/workflows/improve-a-system.md',
  'system/workflows/plan-a-tool-connection.md',
  'system/workflows/review-an-update.md',
  'system/workflows/style-the-dashboard.md',
  'system/workflows/put-the-dashboard-online.md',
  'system/scenarios/scenarios.json',
  'system/scenarios/WALKTHROUGH.md',
  'you/SETUP.md',
  'you/README.md',
  'you/ABOUT.md',
  'you/PREFERENCES.md',
  'you/GOALS.md',
  'work/README.md',
  'work/BUSINESS.md',
  'work/PEOPLE.md',
  'work/PRIORITIES.md',
  'work/CURRENT-TOOLS.md',
  'opportunities/README.md',
  'opportunities/INDEX.md',
  'opportunities/AI-OPPORTUNITY-MAP.md',
  'systems/README.md',
  'systems/INDEX.md',
  'capabilities/README.md',
  'capabilities/INDEX.md',
  'ideas/README.md',
  'ideas/INBOX.md',
  'ideas/REVIEWED.md',
  'ideas/SUGGESTION-LOG.md',
  'memory/MEMORY.md',
  'memory/DECISIONS.md',
  'memory/CORRECTIONS.md',
  'memory/UPDATE-HISTORY.md',
  'knowledge/INDEX.md',
  'knowledge/README.md',
  'projects/INDEX.md',
  'projects/README.md',
  'skills/INDEX.md',
  'skills/README.md',
  'tools/README.md',
  'tools/INDEX.md',
  'inbox/LEARNING-CANDIDATES.md',
  'inbox/README.md',
  'templates/project.md',
  'templates/knowledge.md',
  'templates/memory.md',
  'templates/tool-connection.md',
  'templates/opportunity-map.md',
  'templates/capability.md',
  'templates/action-preview.md',
  'templates/suggestion.md',
  'templates/system/BLUEPRINT.md',
  'templates/system/HARNESS.md',
  'templates/system/CONNECTIONS.md',
  'templates/system/BUILD-MODE.md',
  'templates/system/INTERFACE.md',
  'templates/system/DEPLOYMENT.md',
  'templates/system/PROOF.md',
  'templates/system/LEARNINGS.md',
  'system/examples/daily-follow-up-brief/README.md',
  'system/examples/daily-follow-up-brief/BLUEPRINT.md',
  'system/examples/daily-follow-up-brief/HARNESS.md',
  'system/examples/daily-follow-up-brief/CONNECTIONS.md',
  'system/examples/daily-follow-up-brief/BUILD-MODE.md',
  'system/examples/daily-follow-up-brief/INTERFACE.md',
  'system/examples/daily-follow-up-brief/DEPLOYMENT.md',
  'system/examples/daily-follow-up-brief/PROOF.md',
  'system/examples/daily-follow-up-brief/LEARNINGS.md',
  'system/examples/daily-follow-up-brief/sample-data.json',
  'system/examples/daily-follow-up-brief/preferences.json',
  'system/examples/daily-follow-up-brief/build.mjs',
  'system/examples/daily-follow-up-brief/serve.mjs',
  'system/examples/daily-follow-up-brief/interface/index.html',
  'system/examples/daily-follow-up-brief/interface/styles.css',
  'system/examples/daily-follow-up-brief/interface/app.js',
  'system/examples/daily-follow-up-brief/interface/demo-data.js',
  'templates/skill/SKILL.md',
]

for (const requiredFile of requiredFiles) read(requiredFile)
if (errors.length === 0) pass(`${requiredFiles.length} required release files exist`)

const agents = read('AGENTS.md')
for (const expectedReference of [
  'you/SETUP.md',
  'system/WORKSPACE-CONTRACT.md',
  'system/workflows/start.md',
  'system/workflows/discover-opportunities.md',
  'system/workflows/blueprint-a-system.md',
  'system/workflows/build-a-system.md',
  'system/workflows/inspect-capabilities.md',
  'system/workflows/enter-build-mode.md',
  'system/workflows/review-interface-and-deployment.md',
  'system/workflows/improve-a-system.md',
  'system/workflows/discover-sops.md',
  'system/workflows/plan-a-tool-connection.md',
  'system/workflows/review-an-update.md',
  'system/workflows/style-the-dashboard.md',
  'system/workflows/put-the-dashboard-online.md',
  'system/LEARNING-LOOP.md',
  'system/SAFETY.md',
  'skills/INDEX.md',
  'tools/INDEX.md'
]) {
  if (!agents.includes(expectedReference)) {
    fail(`AGENTS.md must route to ${expectedReference}`)
  }
}
if (!errors.some((error) => error.startsWith('AGENTS.md'))) {
  pass('Codex adapter routes to shared Home Base truth')
}

const claude = read('CLAUDE.md')
if (!claude.startsWith('@AGENTS.md')) {
  fail('CLAUDE.md must import AGENTS.md on its first line')
} else {
  pass('Claude Code adapter imports the shared instructions')
}

const setup = frontmatter(read('you/SETUP.md'), 'you/SETUP.md')
if (!['not_started', 'in_progress', 'complete'].includes(setup.setup_status)) {
  problem('you/SETUP.md', 'you/SETUP.md setup_status must be not_started, in_progress, or complete')
} else {
  pass(`Setup state is valid: ${setup.setup_status}`)
}
if (!['none', 'personal', 'work', 'both'].includes(setup.discovery_path)) {
  problem('you/SETUP.md', 'you/SETUP.md discovery_path must be none, personal, work, or both')
}
if (!['orient', 'opportunity_map', 'blueprint', 'build', 'complete'].includes(setup.stage)) {
  problem('you/SETUP.md', 'you/SETUP.md stage is not a supported 1.0 lifecycle stage')
}
if (!/^[0-8]$/.test(setup.orientation_completed ?? '')) {
  problem('you/SETUP.md', 'you/SETUP.md orientation_completed must be an integer from 0 to 8')
}
if (![...errors, ...notes].some((message) => message.startsWith('you/SETUP.md'))) {
  pass('Setup tracks discovery path and progressive 1.0 stage')
}

const nativeSkills = [
  ['start-home-base', 'system/workflows/start.md'],
  ['deepen-home-base', 'system/workflows/deepen.md'],
  ['build-home-base-skill', 'system/workflows/build-a-skill.md'],
  ['discover-home-base-sops', 'system/workflows/discover-sops.md'],
  ['plan-home-base-tool', 'system/workflows/plan-a-tool-connection.md'],
  ['review-home-base-update', 'system/workflows/review-an-update.md'],
  ['discover-home-base-opportunities', 'system/workflows/discover-opportunities.md'],
  ['blueprint-home-base-system', 'system/workflows/blueprint-a-system.md'],
  ['build-home-base-system', 'system/workflows/build-a-system.md'],
  ['inspect-home-base-capabilities', 'system/workflows/inspect-capabilities.md'],
  ['enter-home-base-build-mode', 'system/workflows/enter-build-mode.md'],
  ['review-home-base-interface', 'system/workflows/review-interface-and-deployment.md'],
  ['improve-home-base-system', 'system/workflows/improve-a-system.md'],
  ['style-home-base-dashboard', 'system/workflows/style-the-dashboard.md'],
  ['publish-home-base-dashboard', 'system/workflows/put-the-dashboard-online.md'],
]

for (const [skillName, canonicalPath] of nativeSkills) {
  const codexPath = `.agents/skills/${skillName}/SKILL.md`
  const claudePath = `.claude/skills/${skillName}/SKILL.md`
  const codexSkill = read(codexPath)
  const claudeSkill = read(claudePath)
  const codexMeta = frontmatter(codexSkill, codexPath)
  const claudeMeta = frontmatter(claudeSkill, claudePath)

  if (codexMeta.name !== skillName || claudeMeta.name !== skillName) {
    fail(`${skillName} wrappers must use matching name frontmatter`)
  }
  if (!codexMeta.description || !claudeMeta.description) {
    fail(`${skillName} wrappers must include descriptions`)
  }
  if (!codexSkill.includes(canonicalPath) || !claudeSkill.includes(canonicalPath)) {
    fail(`${skillName} wrappers must route to ${canonicalPath}`)
  }
  if (codexSkill !== claudeSkill) {
    fail(`${skillName} Codex and Claude wrappers must stay identical`)
  }
}
if (!errors.some((error) => error.includes('wrappers'))) {
  pass(`${nativeSkills.length} canonical workflows have matching native wrappers`)
}

try {
  const projection = validateSkillVaultProjection(root)
  const lock = JSON.parse(read('system/distribution/skill-vault.lock.json'))
  skillVaultPackageNames = new Set(lock.packages.map((item) => item.name))
  pass(`${projection.totalSkills} repository Skills are collision-free and adapter-identical (${projection.homeBaseCoreSkills} core + ${projection.skillVaultPackages} Skill Vault)`)
} catch (error) {
  fail(`Skill Vault projection is invalid: ${error.message}`)
}

try {
  const registry = loadCapabilityRegistry(root)
  if (registry.capabilities.length < 9) fail('Capability Doctor registry must cover the bundled and external capability classes')
  else pass(`${registry.capabilities.length} Capability Doctor declarations use the typed registry`)
} catch (error) {
  fail(`Capability Doctor registry is invalid: ${error.message}`)
}

for (const skillFile of walk(path.join(root, 'skills')).filter(
  (filePath) => path.basename(filePath) === 'SKILL.md',
)) {
  const skillPath = relative(skillFile)
  const metadata = frontmatter(fs.readFileSync(skillFile, 'utf8'), skillPath)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name ?? '')) {
    problem(skillPath, `${skillPath} name must be kebab-case`)
  }
  if (!metadata.description) problem(skillPath, `${skillPath} must include a description`)
}
if (![...errors, ...notes].some((message) => message.startsWith('skills/'))) {
  pass('User-created skill metadata is valid')
}

let scenarioContract
try {
  scenarioContract = JSON.parse(read('system/scenarios/scenarios.json'))
} catch (error) {
  fail(`Scenario contract is not valid JSON: ${error.message}`)
}

if (scenarioContract) {
  const scenarios = scenarioContract.scenarios
  if (!Array.isArray(scenarios) || scenarios.length < 20) {
    fail('Scenario contract must define at least twenty cases')
  } else {
    const ids = new Set()
    for (const scenario of scenarios) {
      if (!scenario.id || ids.has(scenario.id)) fail('Scenario ids must be present and unique')
      ids.add(scenario.id)
      if (!scenario.persona || !scenario.opening) {
        fail(`Scenario ${scenario.id ?? 'unknown'} needs a persona and opening`)
      }
      if (!Array.isArray(scenario.expected) || scenario.expected.length < 4) {
        fail(`Scenario ${scenario.id ?? 'unknown'} needs at least four observable expectations`)
      }
    }
    if (!errors.some((error) => error.startsWith('Scenario'))) {
      pass(`${scenarios.length} acceptance scenarios have observable expectations`)
    }
  }
}

let releaseManifest
try {
  releaseManifest = JSON.parse(read('system/release-manifest.json'))
} catch (error) {
  fail(`Release manifest is invalid JSON: ${error.message}`)
}

// The release version comes from the manifest. Only the stable channel stays
// pinned to the last public stable release.
const LAST_STABLE_VERSION = '1.1.0'
const releaseVersion = releaseManifest?.version ?? ''
const isPrerelease = /^1\.\d+\.\d+-dev\.\d+$/.test(releaseVersion)
// A stable build is only ever the pinned last public stable release; a new
// stable version needs this constant (and the stable channel) moved on purpose.
const isStable = releaseVersion === LAST_STABLE_VERSION
const version = read('VERSION.md')
const versionStatus = isPrerelease ? 'Status: pre-release' : 'Status: public stable release'
const versionLines = version.split(/\r?\n/).filter((line) => /^\s*-?\s*Version:/.test(line))
const statusLines = version.split(/\r?\n/).filter((line) => /^\s*-?\s*Status:/.test(line))
if (
  (!isPrerelease && !isStable) ||
  versionLines.length !== 1 ||
  statusLines.length !== 1 ||
  !versionLines[0].includes(`Version: \`${releaseVersion}\``) ||
  !statusLines[0].includes(versionStatus)
) {
  fail(`VERSION.md must identify the manifest version with exactly one Version and one Status line; a stable build must be ${LAST_STABLE_VERSION}, anything else a -dev.N pre-release`)
} else {
  pass(`Version metadata identifies Home Base ${releaseVersion} (${isPrerelease ? 'pre-release' : 'public stable'})`)
}
if (releaseManifest) {
  const maintained = releaseManifest.maintainedPaths ?? []
  const userOwned = releaseManifest.userOwnedPaths ?? []
  const overlap = maintained.filter((maintainedPath) =>
    userOwned.some(
      (userOwnedPath) =>
        maintainedPath === userOwnedPath ||
        maintainedPath.startsWith(`${userOwnedPath}/`) ||
        userOwnedPath.startsWith(`${maintainedPath}/`),
    ),
  )
  if (
    releaseManifest.schemaVersion !== 2 ||
    releaseManifest.releaseId !== `home-base-${releaseVersion}` ||
    JSON.stringify(releaseManifest.instancePaths) !== JSON.stringify([updateInternals.INSTANCE_ROOT]) ||
    releaseManifest.starterSourceRoot !== 'system/starter' ||
    overlap.length > 0 ||
    !userOwned.includes('you') ||
    !userOwned.includes('systems') ||
    !maintained.includes('system') ||
    !maintained.includes('templates') ||
    !maintained.includes('LICENSE') ||
    !maintained.includes('THIRD_PARTY_LICENSES') ||
    !maintained.includes('SUPPORT.md') ||
    !maintained.includes('.github') ||
    !maintained.includes('channels')
  ) {
    fail('Release manifest must separate maintained, user-owned, and instance paths')
  } else {
    pass('Release manifest separates maintained behavior, user-owned content, and the private instance zone')
  }
  const ignoreLines = read('.gitignore').split(/\r?\n/)
  if (!ignoreLines.includes(`${updateInternals.INSTANCE_ROOT}/`) || !ignoreLines.includes('[Ii][Nn][Ss][Tt][Aa][Nn][Cc][Ee]/')) {
    fail('.gitignore must keep the private instance/ overlay (and its case variants) out of Git')
  }
  try {
    updateInternals.readManifest(root)
  } catch (error) {
    fail(`Release manifest paths are unsafe for the update engine: ${error.message}`)
  }

  const missingStarterSources = (releaseManifest.starterFiles ?? []).filter(
    (starterFile) =>
      !fs.existsSync(
        path.join(root, releaseManifest.starterSourceRoot, starterFile),
      ),
  )
  if (missingStarterSources.length > 0) {
    fail(
      `Release manifest has starter targets without pristine sources: ${missingStarterSources.join(', ')}`,
    )
  } else {
    pass(`${releaseManifest.starterFiles.length} starter targets have pristine release sources`)
  }

  const updateGuide = read('system/UPDATE-GUIDE.md')
  const undocumentedPaths = [...maintained, ...userOwned, ...(releaseManifest.instancePaths ?? [])].filter(
    (releasePath) => !updateGuide.includes(releasePath),
  )
  if (undocumentedPaths.length > 0) {
    fail(
      `Update guide does not document manifest paths: ${undocumentedPaths.join(', ')}`,
    )
  } else {
    pass('Update guide and release-manifest ownership paths agree')
  }
}

try {
  const license = read('LICENSE')
  const upstreamLicense = fs.readFileSync(path.join(root, 'THIRD_PARTY_LICENSES', 'matt-pocock-MIT.txt'))
  const upstreamHash = crypto.createHash('sha256').update(upstreamLicense).digest('hex')
  const provenance = JSON.parse(read('PROVENANCE.json'))
  const skillLock = JSON.parse(read('system/distribution/skill-vault.lock.json'))
  if (
    !license.includes('Copyright (c) 2026 Matthew Esposito') ||
    upstreamHash !== '0e7ac423bf2c6e223b7c5b156f8cf72da49d748e56a1641402c31f22ad07dbb5' ||
    provenance.product?.version !== releaseVersion ||
    provenance.homeBaseCoreSkills?.length !== 15 ||
    provenance.skillVault?.commit !== skillLock.source?.commit ||
    provenance.skillVault?.projectionDigest !== skillLock.projectionDigest
  ) {
    fail('Home Base license or provenance identity is incomplete or stale')
  } else {
    pass('Home Base root MIT, byte-verbatim upstream MIT, and 42-Skill provenance agree')
  }
} catch (error) {
  fail(`Home Base license/provenance contract is invalid: ${error.message}`)
}

const support = read('SUPPORT.md')
const security = read('SECURITY.md')
const brandAssets = read('BRAND-ASSETS.md')
const issueForm = read('.github/ISSUE_TEMPLATE/bug_report.yml')
if (
  !support.includes('there is no SLA') ||
  !support.includes('Latest stable') ||
  !support.includes('Codex Desktop') ||
  !support.includes('Claude Code') ||
  !security.includes('private vulnerability reporting') ||
  !brandAssets.includes('contains no EspoAI logo') ||
  !issueForm.includes('unredacted diagnostic output')
) {
  fail('Support, security, brand, or sanitized-intake posture is incomplete')
} else {
  pass('Support, security, brand, and sanitized-intake boundaries are explicit')
}

const MEDIA = /\.(?:png|jpe?g|gif|webp|svg|mp3|wav|m4a|mp4|mov)$/i
const LARGE_USER_FILE = 2 * 1024 * 1024
// What a 1.0.x validator would refuse is worth listing, because those files
// must be parked before a rollback to 1.0.x (see system/UPDATE-GUIDE.md).
const PARK_HINT = 'fine to keep; move it out only before a rollback to 1.0.x'
const sourceMaps = walk(root).filter((filePath) =>
  filePath.endsWith('.map') ||
  (/\.(?:m?js|css)$/.test(filePath) && /[#@]\s*sourceMappingURL=/.test(fs.readFileSync(filePath, 'utf8'))),
).map(relative).filter((file) => file !== 'system/validate.mjs')
for (const file of sourceMaps.filter(isUsers)) problem(file, `${file} is or references a source map (${PARK_HINT})`)
const releaseSourceMaps = sourceMaps.filter(isRelease)
if (releaseSourceMaps.length > 0) fail(`Release contains source maps or sourceMappingURL comments: ${releaseSourceMaps.join(', ')}`)
else pass('Release contains no source maps')

const media = walk(root).filter((filePath) => MEDIA.test(filePath)).map(relative)
for (const file of media.filter(isUsers)) problem(file, `${file} is a media file (${PARK_HINT})`)
const excludedBrandMedia = media.filter(isRelease)
if (excludedBrandMedia.length > 0) {
  fail(`Release contains excluded brand/media files: ${excludedBrandMedia.join(', ')}`)
} else {
  pass('Release contains zero logo, portrait, audio, video, course-art, or promotional-media files')
}

try {
  const stableChannel = JSON.parse(read('channels/stable.json'))
  const previewChannel = JSON.parse(read('channels/preview.json'))
  if (
    stableChannel.channel !== 'stable' ||
    previewChannel.channel !== 'preview' ||
    stableChannel.state !== 'available' ||
    previewChannel.state !== 'unavailable' ||
    stableChannel.metadataUrl !== `https://github.com/MattEspo23/home-base/releases/download/v${LAST_STABLE_VERSION}/home-base-${LAST_STABLE_VERSION}.tgz.json` ||
    previewChannel.metadataUrl !== null
  ) {
    fail('Stable release discovery must be immutable while preview fails closed')
  } else {
    pass(`Stable discovery points to v${LAST_STABLE_VERSION} metadata and preview fails closed`)
  }
} catch (error) {
  fail(`Update channel contract is invalid: ${error.message}`)
}

for (const [file, kind] of [...oddEntries].sort(([left], [right]) => left.localeCompare(right))) {
  problem(file, isRelease(file)
    ? `Release files may not contain symbolic links, hard links, or special files: ${file} is ${kind}`
    : `${file} is ${kind}${kind === 'a hard-linked file' ? '' : '; Home Base never follows or reads it'} (${PARK_HINT})`)
}

// Maintained roots are checked strictly. The rest of the folder only adds
// notes (collisions such as README.md beside Readme.md), unless --release.
if (!releaseMode && maintainedRoots !== null) {
  try {
    updateInternals.scanWholeTree(root)
  } catch (error) {
    if (!/symbolic links|special files|hard-linked/.test(error.message)) notes.push(`Outside the maintained files: ${error.message}`)
  }
}
try {
  if (releaseMode || maintainedRoots === null) updateInternals.scanWholeTree(root)
  else updateInternals.scanRoots(root, [...new Set(JSON.parse(fs.readFileSync(path.join(root, 'system', 'release-manifest.json'), 'utf8')).maintainedPaths)])
  pass('Release tree contains no symlinks, hardlinks, special files, or Unicode/case path collisions')
} catch (error) {
  fail(`Release tree safety check failed: ${error.message}`)
}

const opportunityWorkflow = read('system/workflows/discover-opportunities.md')
for (const signal of [
  'two actionable-now choices',
  'saved-later',
  'visible evidence',
  'none fit',
]) {
  if (!opportunityWorkflow.includes(signal)) {
    fail(`Opportunity workflow must include ${signal}`)
  }
}
const buildModeWorkflow = read('system/workflows/enter-build-mode.md')
for (const signal of [
  'Credential guard',
  'read/data scope',
  'volume ceiling',
  'credible worst case',
  'undo or disconnect',
  'remaining access',
  'task- and session-specific',
  'mark Build Mode `completed`',
]) {
  if (!buildModeWorkflow.includes(signal)) {
    fail(`Build Mode workflow must include ${signal}`)
  }
}
const improvementWorkflow = read('system/workflows/improve-a-system.md')
for (const signal of [
  'at most one unsolicited suggestion',
  'Treat “no” as durable',
  'same task',
  'without asking the user to restate',
]) {
  if (!improvementWorkflow.includes(signal)) {
    fail(`Improvement workflow must include ${signal}`)
  }
}
const blueprintWorkflow = read('system/workflows/blueprint-a-system.md')
for (const signal of ['set `stage: blueprint`', 'current focus', 'next question']) {
  if (!blueprintWorkflow.includes(signal)) {
    fail(`Blueprint workflow must include ${signal}`)
  }
}
const buildWorkflow = read('system/workflows/build-a-system.md')
if (!buildWorkflow.includes('stage: build')) {
  fail('Build workflow must enter the build lifecycle stage')
}
for (const signal of ['stage: complete', 'observed result', 'explicit next action']) {
  if (!improvementWorkflow.includes(signal)) {
    fail(`Improvement workflow must include lifecycle signal ${signal}`)
  }
}
if (!errors.some((error) => error.includes('workflow must include'))) {
  pass('1.0 discovery, Build Mode, and changed-result workflow contracts are explicit')
}

const blueprintTemplate = read('templates/system/BLUEPRINT.md')
for (const signal of [
  'Smallest useful version',
  'Execution shape',
  'Authority',
  'Interface decision',
  'Deployment decision',
  'Proof and rollback',
]) {
  if (!blueprintTemplate.includes(signal)) {
    fail(`System blueprint template must include ${signal}`)
  }
}
const actionPreview = read('templates/action-preview.md')
for (const signal of [
  'Read/data scope',
  'Volume ceiling',
  'Credible worst case',
  'Undo or disconnect',
  'Access remaining afterward',
]) {
  if (!actionPreview.includes(signal)) {
    fail(`Action preview template must include ${signal}`)
  }
}
if (!errors.some((error) => error.includes('template must include'))) {
  pass('Generated-system and bounded-action templates cover the complete contract')
}
const buildModeTemplate = read('templates/system/BUILD-MODE.md')
for (const signal of [
  'not_entered | approved | stopped | completed',
  'Approved session',
  'Completed or stopped at',
  'earlier session must be previewed and approved again',
]) {
  if (!buildModeTemplate.includes(signal)) {
    fail(`Build Mode template must include ${signal}`)
  }
}

let exampleData
try {
  exampleData = JSON.parse(
    read('system/examples/daily-follow-up-brief/sample-data.json'),
  )
} catch (error) {
  fail(`Daily Follow-Up Brief sample data is invalid JSON: ${error.message}`)
}
if (exampleData) {
  if (exampleData.inbox?.length !== 3 || exampleData.calendar?.length !== 2) {
    fail('Daily Follow-Up Brief sample data must stay bounded to three messages and two events')
  }
  const labels = JSON.stringify(exampleData)
  if (!labels.includes('Demo Contact') || labels.includes('@')) {
    fail('Daily Follow-Up Brief sample data must remain synthetic and contain no email addresses')
  }
}
let examplePreferences
try {
  examplePreferences = JSON.parse(
    read('system/examples/daily-follow-up-brief/preferences.json'),
  )
} catch (error) {
  fail(`Daily Follow-Up Brief preferences are invalid JSON: ${error.message}`)
}
if (examplePreferences?.summaryStyle !== 'concise') {
  fail('Daily Follow-Up Brief must ship its confirmed concise preference')
}
const demoInterface = read(
  'system/examples/daily-follow-up-brief/interface/index.html',
)
const demoApp = read('system/examples/daily-follow-up-brief/interface/app.js')
const demoData = read(
  'system/examples/daily-follow-up-brief/interface/demo-data.js',
)
if (
  !demoInterface.includes('Sends disabled') ||
  !demoInterface.includes('Synthetic') ||
  demoApp.includes('innerHTML') ||
  !demoData.includes('"summaryStyle": "concise"')
) {
  fail('Daily Follow-Up Brief interface must show safety, use saved style, and avoid HTML injection')
} else if (exampleData) {
  pass('Daily Follow-Up Brief reference is bounded, synthetic, and injection-safe')
}

const markdownFiles = walk(root).filter((filePath) => filePath.endsWith('.md'))
for (const markdownFile of markdownFiles) {
  const markdownRelative = relative(markdownFile)
  const projectedSkillMatch = markdownRelative.match(/^\.(?:agents|claude)\/skills\/([^/]+)\//)
  if (projectedSkillMatch && skillVaultPackageNames.has(projectedSkillMatch[1])) continue
  // Fenced blocks and inline code spans show example lines, not links.
  const contents = fs.readFileSync(markdownFile, 'utf8')
    .replace(/^([ \t]*)(```|~~~)[^\n]*\n[\s\S]*?^\1\2[^\n]*$/gm, '')
    .replace(/`[^`\n]+`/g, '')
  for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].trim()
    if (
      !target ||
      target.startsWith('#') ||
      target.startsWith('http://') ||
      target.startsWith('https://') ||
      target.startsWith('mailto:')
    ) {
      continue
    }
    if (path.isAbsolute(target)) {
      problem(markdownRelative, `${markdownRelative} has a non-portable absolute local link: ${target}${isUsers(markdownRelative) ? ` (${PARK_HINT})` : ''}`)
      continue
    }
    const targetWithoutAnchor = target.split('#')[0]
    const resolved = path.resolve(path.dirname(markdownFile), targetWithoutAnchor)
    if (!fs.existsSync(resolved)) {
      problem(markdownRelative, `${markdownRelative} has a broken local link: ${target}${isUsers(markdownRelative) ? ` (${PARK_HINT})` : ''}`)
    }
  }
}
if (!errors.some((error) => error.includes('broken local link'))) {
  if (!errors.some((error) => error.includes('non-portable absolute local link'))) {
    pass(`${markdownFiles.length} Markdown files have valid portable local links`)
  }
}

// Binary by its first bytes: a NUL byte, or a PDF, ZIP (office files), gzip,
// or 7-Zip signature.
function isBinary(bytes) {
  const head = bytes.subarray(0, 8192)
  if (head.includes(0)) return true
  const signature = head.subarray(0, 6).toString('latin1')
  return signature.startsWith('%PDF') || signature.startsWith('PK\u0003\u0004') || signature.startsWith('\u001f\u008b') || signature.startsWith('7z\u00bc\u00af')
}

const credentialScanAllowlist = new Set([
  'system/lib/contracts.mjs',
  'system/prove.mjs',
  'system/validate.mjs',
])
for (const textFile of walk(root)) {
  const file = relative(textFile)
  if (credentialScanAllowlist.has(file)) continue
  if (isUsers(file)) {
    // The user's media is noted above. Large and binary files are not text
    // worth scanning, but a 1.0.x validator reads them all, so they are noted.
    if (MEDIA.test(file)) continue
    if (fs.statSync(textFile).size > LARGE_USER_FILE) {
      problem(file, `${file} is larger than 2 MB, so it is not checked for passwords (${PARK_HINT})`)
      continue
    }
    const bytes = fs.readFileSync(textFile)
    if (isBinary(bytes)) {
      problem(file, `${file} is a binary file such as a PDF or an archive, so it is not checked for passwords (${PARK_HINT})`)
      continue
    }
    if (containsCredentialShape(bytes.toString('utf8'))) {
      problem(file, `${file} contains text shaped like a password, key, or token; Home Base should not store secrets, so remove it if it is real (a 1.0.x validator refuses it too)`)
    }
    continue
  }
  const contents = fs.readFileSync(textFile, 'utf8')
  if (containsCredentialShape(contents)) {
    fail(`Release file contains credential-shaped content: ${file}`)
  }
}
if (!errors.some((error) => error.includes('secret-like'))) {
  if (!errors.some((error) => error.includes('credential-shaped content'))) {
    pass('Release files contain no known credential-shaped values')
  }
}

function printNotes() {
  if (notes.length === 0) return
  console.log(`Notes about your own files (${notes.length}); they never block an update, rollback, or recovery:`)
  for (const note of notes) console.log(`- ${note}`)
}

if (errors.length > 0) {
  console.error(`Home Base validation failed with ${errors.length} error(s):`)
  for (const error of errors) console.error(`- ${error}`)
  printNotes()
  process.exitCode = 1
} else {
  console.log(`Home Base validation passed (${checks.length} checks):`)
  for (const check of checks) console.log(`- ${check}`)
  printNotes()
}
