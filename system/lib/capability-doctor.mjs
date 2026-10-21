import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const PRESENCE = new Set(['not_applicable', 'absent', 'present', 'unknown'])
const PRESENCE_KEYS = ['workflow', 'host_command', 'adapter_files', 'plugin_installation', 'plugin_enablement', 'connector_configuration']
const AUTH = new Set(['not_applicable', 'unknown', 'needed', 'confirmed'])
const PERMISSION = new Set(['not_applicable', 'unknown', 'insufficient', 'sufficient'])
const REQUIREMENTS = new Set([...PRESENCE_KEYS, 'auth_state', 'permission_state'])

// The assistants the doctor knows how to look for. Each is reported as its own
// row; plugin metadata is attributed only to the assistant that reported it.
export const HOSTS = Object.freeze({
  codex: Object.freeze({ name: 'Codex', cli: 'Codex CLI', command: 'codex' }),
  'claude-code': Object.freeze({ name: 'Claude Code', cli: 'Claude Code CLI', command: 'claude' }),
  'grok-build': Object.freeze({ name: 'Grok Build', cli: 'Grok Build CLI', command: 'grok' }),
})

// Every command the doctor may start, exactly as run. None starts a model
// session, prompts, signs in, or changes configuration. Anything else is
// refused before a process is created.
export const ALLOWED_COMMANDS = Object.freeze([
  ['git', '--version'],
  ['gh', '--version'],
  ['codex', '--version'],
  ['claude', '--version'],
  ['grok', '--version'],
  ['codex', 'plugin', 'list', '--json'],
].map((argv) => Object.freeze(argv)))

const RESULT_TEXT = {
  usable_read_only: 'usable read-only',
  usable_write: 'usable for changes',
  unavailable: 'unavailable',
}

function satisfies(requirement, observation) {
  if (PRESENCE_KEYS.includes(requirement)) return observation[requirement] === 'present'
  if (requirement === 'auth_state') return observation.auth_state === 'confirmed'
  if (requirement === 'permission_state') return observation.permission_state === 'sufficient'
  throw new Error(`Unknown capability requirement: ${requirement}`)
}

function nextStepFor(missing, observation, declaration) {
  const host = HOSTS[declaration.host]?.name ?? 'the assistant'
  if (observation.probe === 'missing') return 'This doctor version has no probe for this capability; check it directly in the assistant or provider.'
  if (missing.includes('workflow')) return 'Restore or install the named repository Skill before retrying.'
  if (missing.includes('adapter_files')) return `Restore the ${host} adapter files from a fresh Home Base download; the registry entry cites ${host}'s documentation.`
  if (missing.includes('host_command')) return 'Install the named local command, then rerun this read-only doctor.'
  if (missing.some((requirement) => requirement.startsWith('plugin_'))) {
    if (observation.plugin_metadata === 'host_absent') {
      return `${host} is not installed here, so its plugins were not checked. This row covers ${host} only; check plugins inside the assistant you use.`
    }
    if (observation.plugin_metadata === 'unreadable') return `${host} did not report its plugins; open its plugin list directly.`
  }
  if (missing.includes('plugin_installation')) return `Review and install the named ${host} plugin from a trusted marketplace.`
  if (missing.includes('plugin_enablement')) return `Review the installed ${host} plugin and enable it only if you want this capability.`
  if (missing.includes('connector_configuration')) return 'Connect the provider in the host interface; do not paste credentials into Home Base.'
  if (missing.includes('auth_state')) {
    return observation.auth_state === 'needed'
      ? 'Sign in directly on the provider surface, then rerun the doctor.'
      : 'Confirm authentication in the provider surface; the doctor will not trigger login.'
  }
  if (missing.includes('permission_state')) return 'Review provider permissions; authentication alone does not grant action authority.'
  return 'No setup step is required.'
}

export function evaluateCapability(declaration, observation) {
  for (const requirement of [...declaration.all_of, ...declaration.any_of.flat()]) {
    if (!REQUIREMENTS.has(requirement)) throw new Error(`Unsupported requirement in ${declaration.capability_id}: ${requirement}`)
  }
  for (const key of PRESENCE_KEYS) {
    if (!PRESENCE.has(observation[key])) throw new Error(`Invalid ${key} state for ${declaration.capability_id}`)
  }
  if (!AUTH.has(observation.auth_state)) throw new Error(`Invalid auth_state for ${declaration.capability_id}`)
  if (!PERMISSION.has(observation.permission_state)) throw new Error(`Invalid permission_state for ${declaration.capability_id}`)

  const missingAll = declaration.all_of.filter((requirement) => !satisfies(requirement, observation))
  const anySatisfied = declaration.any_of.length === 0 || declaration.any_of.some((group) => group.every((requirement) => satisfies(requirement, observation)))
  const missingAny = anySatisfied ? [] : [...new Set(declaration.any_of.flat().filter((requirement) => !satisfies(requirement, observation)))]
  const missing = [...new Set([...missingAll, ...missingAny])]
  return {
    ...observation,
    capability_id: declaration.capability_id,
    capability_kind: declaration.capability_kind,
    host: declaration.host ?? null,
    requirements: {
      all_of: declaration.all_of,
      any_of: declaration.any_of,
    },
    action_state: missing.length === 0 ? declaration.maximum_action : 'unavailable',
    missing_requirements: missing,
    next_safe_step: nextStepFor(missing, observation, declaration),
  }
}

function isAllowed(command, args) {
  return ALLOWED_COMMANDS.some((argv) => argv[0] === command && argv.length === args.length + 1 && args.every((arg, index) => argv[index + 1] === arg))
}

// The only place the doctor starts a process. stdin is closed so nothing can
// wait on a prompt, and no shell is involved.
function runAllowed(command, args, timeout) {
  if (!isAllowed(command, args)) throw new Error(`Capability Doctor refused a command outside its allowlist: ${[command, ...args].join(' ')}`)
  return spawnSync(command, args, { encoding: 'utf8', timeout, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
}

const VERSION = /\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]{1,40})?)\b/

// Only a version number leaves this function; other output is discarded.
function commandVersion(command, now) {
  const result = runAllowed(command, ['--version'], 5000)
  const observed_at = now().toISOString()
  if (result.error || result.status !== 0) return { present: false, version: null, observed_at }
  const match = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.match(VERSION)
  return { present: true, version: match ? match[1] : null, observed_at }
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._@/-]{0,79}$/

function codexPluginMetadata(codexPresent) {
  if (!codexPresent) return { state: 'host_absent', plugins: [] }
  const result = runAllowed('codex', ['plugin', 'list', '--json'], 10000)
  if (result.error || result.status !== 0) return { state: 'unreadable', plugins: [] }
  try {
    const parsed = JSON.parse(result.stdout)
    if (!Array.isArray(parsed?.installed)) return { state: 'unreadable', plugins: [] }
    const plugins = parsed.installed
      .filter((item) => typeof item?.name === 'string' && SAFE_NAME.test(item.name))
      .map((item) => ({
        name: item.name,
        installed: item.installed === true,
        enabled: item.enabled === true,
        version: typeof item.version === 'string' && SAFE_NAME.test(item.version) ? item.version : 'unknown',
      }))
    return { state: 'read', plugins }
  } catch {
    return { state: 'unreadable', plugins: [] }
  }
}

function entryKind(root, relative) {
  try {
    const stat = fs.lstatSync(path.join(root, relative))
    if (stat.isFile()) return 'file'
    if (stat.isDirectory()) return 'dir'
    return 'other'
  } catch {
    return null
  }
}

function skillNames(root, relative) {
  if (entryKind(root, relative) !== 'dir') return []
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entryKind(root, path.join(relative, entry.name, 'SKILL.md')) === 'file')
    .map((entry) => entry.name)
}

function claudeImportsAgents(root) {
  if (entryKind(root, 'CLAUDE.md') !== 'file') return false
  const first = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).find((line) => line.trim())
  return first?.trim() === '@AGENTS.md'
}

// Probe the computer and the Home Base folder once. Only allowlisted commands
// run; folder checks read names, and CLAUDE.md's first line.
export function probeEnvironment(homeBaseRoot, { now = () => new Date() } = {}) {
  const startedAt = now()
  const versions = {
    git: commandVersion('git', now),
    gh: commandVersion('gh', now),
  }
  const hosts = {}
  for (const [id, host] of Object.entries(HOSTS)) {
    hosts[id] = { id, label: host.cli, ...commandVersion(host.command, now) }
  }
  const codexPlugins = { ...codexPluginMetadata(hosts.codex.present), observed_at: now().toISOString() }
  const agentsSkills = skillNames(homeBaseRoot, path.join('.agents', 'skills'))
  const claudeSkills = skillNames(homeBaseRoot, path.join('.claude', 'skills'))
  const folder = {
    agentsMd: entryKind(homeBaseRoot, 'AGENTS.md') === 'file',
    claudeMd: entryKind(homeBaseRoot, 'CLAUDE.md') === 'file',
    claudeImportsAgents: claudeImportsAgents(homeBaseRoot),
    agentsSkills,
    claudeSkills,
    updater: entryKind(homeBaseRoot, path.join('system', 'update.mjs')) === 'file',
  }
  return {
    started_at: startedAt,
    node: process.version,
    versions,
    hosts,
    codexPlugins,
    folder,
  }
}

function baseObservation(observedAt) {
  return {
    workflow: 'not_applicable',
    host_command: 'not_applicable',
    adapter_files: 'not_applicable',
    plugin_installation: 'not_applicable',
    plugin_enablement: 'not_applicable',
    connector_configuration: 'not_applicable',
    auth_state: 'not_applicable',
    permission_state: 'not_applicable',
    source: [],
    summary: '',
    observed_at: observedAt,
    confidence: 'high',
  }
}

const versionText = (probe) => probe.version ?? 'version not reported'

function hostCliProbe(hostId) {
  return (observation, env) => {
    const probe = env.hosts[hostId]
    const host = HOSTS[hostId]
    observation.host_command = probe.present ? 'present' : 'absent'
    observation.auth_state = 'unknown'
    observation.observed_at = probe.observed_at
    observation.summary = probe.present ? `present ${versionText(probe)}` : 'not found on this computer'
    observation.source.push(
      probe.present ? `${host.cli} present ${versionText(probe)} (${host.command} --version)` : `${host.cli} not found (${host.command} --version did not run)`,
      'sign-in not checked',
    )
  }
}

function adapterProbe(check) {
  return (observation, env) => {
    const { present, summary } = check(env.folder)
    observation.adapter_files = present ? 'present' : 'absent'
    observation.summary = summary
    observation.source.push(`Home Base folder files: ${summary}`, 'file presence only; not a live load test')
  }
}

const skillsText = (names, folder) => `${folder} (${names.length} Skills)`

function codexPluginObservation(observation, env, names) {
  const metadata = env.codexPlugins
  observation.plugin_metadata = metadata.state
  observation.observed_at = metadata.observed_at
  if (metadata.state === 'host_absent') {
    observation.plugin_installation = 'absent'
    observation.plugin_enablement = 'absent'
    observation.source.push('Codex plugin metadata not read: Codex CLI not found')
    return null
  }
  if (metadata.state === 'unreadable') {
    observation.plugin_installation = 'unknown'
    observation.plugin_enablement = 'unknown'
    observation.source.push('Codex did not report plugin metadata')
    return null
  }
  const plugin = names.map((name) => metadata.plugins.find((item) => item.name === name)).find(Boolean)
  observation.plugin_installation = plugin?.installed ? 'present' : 'absent'
  observation.plugin_enablement = plugin?.enabled ? 'present' : 'absent'
  observation.source.push(plugin ? `Codex plugin metadata: ${plugin.name} ${plugin.version}` : `Codex plugin metadata: ${names[0]} not reported`)
  return plugin
}

function pluginSummary(observation, plugin, pluginName) {
  if (observation.plugin_metadata === 'host_absent') return 'Codex not installed, so no Codex plugin was checked'
  if (observation.plugin_metadata === 'unreadable') return 'Codex did not report its plugins'
  if (!plugin) return `Codex plugin ${pluginName} not installed`
  return plugin.enabled ? `Codex plugin ${plugin.name} installed and enabled` : `Codex plugin ${plugin.name} installed but not enabled`
}

const PROBES = {
  'home-base-core-skills': (observation, env) => {
    const present = env.folder.agentsSkills.length === 41 && ['start-home-base', 'review-home-base-update'].every((name) => env.folder.agentsSkills.includes(name))
    observation.workflow = present ? 'present' : 'absent'
    observation.summary = present ? 'core Skills present in .agents/skills' : 'core Skills missing from .agents/skills'
    observation.source.push('repository Skill metadata')
  },
  'skill-vault-skills': (observation, env) => {
    const present = env.folder.agentsSkills.length === 41 && ['ask-espo', 'youtube-action-plan'].every((name) => env.folder.agentsSkills.includes(name))
    observation.workflow = present ? 'present' : 'absent'
    observation.summary = present ? 'pinned Skill Vault packages present' : 'pinned Skill Vault packages missing'
    observation.source.push('pinned Skill Vault projection')
  },
  'home-base-updater': (observation, env) => {
    observation.workflow = env.folder.updater ? 'present' : 'absent'
    observation.host_command = 'present'
    observation.summary = env.folder.updater ? `system/update.mjs with Node ${env.node}` : 'system/update.mjs missing'
    observation.source.push(`repository updater; Node ${env.node}`)
  },
  'local-javascript': (observation, env) => {
    observation.host_command = 'present'
    observation.summary = `Node ${env.node}`
    observation.source.push(`Node ${env.node}`)
  },
  'git-local': (observation, env) => {
    const probe = env.versions.git
    observation.host_command = probe.present ? 'present' : 'absent'
    observation.observed_at = probe.observed_at
    observation.summary = probe.present ? `Git ${versionText(probe)}` : 'Git not found'
    observation.source.push(probe.present ? `Git ${versionText(probe)} (git --version)` : 'Git command not found')
  },
  'codex-cli': hostCliProbe('codex'),
  'claude-code-cli': hostCliProbe('claude-code'),
  'grok-build-cli': hostCliProbe('grok-build'),
  'codex-adapter-files': adapterProbe((folder) => {
    const present = folder.agentsMd && folder.agentsSkills.length > 0
    return {
      present,
      summary: present ? `AGENTS.md and ${skillsText(folder.agentsSkills, '.agents/skills')} present` : 'AGENTS.md or .agents/skills missing',
    }
  }),
  'claude-code-adapter-files': adapterProbe((folder) => {
    const present = folder.agentsMd && folder.claudeImportsAgents && folder.claudeSkills.length > 0
    return {
      present,
      summary: present
        ? `CLAUDE.md imports AGENTS.md; ${skillsText(folder.claudeSkills, '.claude/skills')} present`
        : 'CLAUDE.md importing AGENTS.md, or .claude/skills, missing',
    }
  }),
  'grok-build-adapter-files': adapterProbe((folder) => {
    const instructions = [folder.agentsMd && 'AGENTS.md', folder.claudeMd && 'CLAUDE.md'].filter(Boolean)
    const skills = [
      folder.agentsSkills.length > 0 && skillsText(folder.agentsSkills, '.agents/skills'),
      folder.claudeSkills.length > 0 && skillsText(folder.claudeSkills, '.claude/skills'),
    ].filter(Boolean)
    const present = instructions.length > 0 && skills.length > 0
    return {
      present,
      summary: present ? `${instructions.join(' and ')}; ${skills.join(' and ')} present` : 'no AGENTS.md or CLAUDE.md, or no Skills folder',
    }
  }),
  'github-public-read': (observation, env) => githubProbe(observation, env, false),
  'github-account-write': (observation, env) => githubProbe(observation, env, true),
  'browser-control': (observation, env) => {
    const plugin = codexPluginObservation(observation, env, ['browser', 'chrome'])
    observation.summary = pluginSummary(observation, plugin, 'browser')
  },
  'google-drive-write': (observation, env) => {
    const plugin = codexPluginObservation(observation, env, ['google-drive'])
    observation.connector_configuration = 'unknown'
    observation.auth_state = 'unknown'
    observation.permission_state = 'unknown'
    observation.confidence = 'low'
    observation.summary = `${pluginSummary(observation, plugin, 'google-drive')}; connector, sign-in and permission not checked`
    observation.source.push('connector/auth/permission not exposed by allowlisted probes')
  },
}

function githubProbe(observation, env, write) {
  const gh = env.versions.gh
  observation.host_command = gh.present ? 'present' : 'absent'
  observation.source.push(gh.present ? `GitHub CLI ${versionText(gh)} (gh --version)` : 'GitHub CLI not found')
  const plugin = codexPluginObservation(observation, env, ['github'])
  const parts = [gh.present ? `GitHub CLI ${versionText(gh)}` : 'GitHub CLI not found', pluginSummary(observation, plugin, 'github')]
  if (write) {
    observation.auth_state = 'unknown'
    observation.permission_state = 'unknown'
    observation.confidence = 'medium'
    parts.push('sign-in and permission not checked')
  }
  observation.summary = parts.join('; ')
}

export function inspectCapabilities(homeBaseRoot, registry, env = probeEnvironment(homeBaseRoot)) {
  const observedAt = env.started_at.toISOString()
  return registry.capabilities.map((declaration) => {
    const observation = baseObservation(observedAt)
    const probe = PROBES[declaration.capability_id]
    if (probe) {
      probe(observation, env)
    } else {
      // An entry this doctor cannot probe is reported as unchecked, never as
      // available.
      observation.probe = 'missing'
      for (const requirement of [...declaration.all_of, ...declaration.any_of.flat()]) {
        if (PRESENCE_KEYS.includes(requirement)) observation[requirement] = 'unknown'
        if (requirement === 'auth_state') observation.auth_state = 'unknown'
        if (requirement === 'permission_state') observation.permission_state = 'unknown'
      }
      observation.confidence = 'low'
      observation.summary = 'not checked by this doctor version'
      observation.source.push('no probe for this capability')
    }
    return {
      label: declaration.label,
      ...evaluateCapability(declaration, observation),
    }
  })
}

// Calendar date of the check on this computer, as a person would write it.
export function localDate(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function buildReceipt(homeBaseRoot, registry, options = {}) {
  const env = options.env ?? probeEnvironment(homeBaseRoot, options)
  return {
    schemaVersion: 2,
    receiptType: 'live_environment_evidence_not_correctness_proof',
    probePolicy: 'allowlisted_command_versions_home_base_folder_files_and_codex_plugin_metadata_only',
    checked_on: localDate(env.started_at),
    observed_at: env.started_at.toISOString(),
    allowed_commands: ALLOWED_COMMANDS.map((argv) => argv.join(' ')),
    hosts: Object.values(env.hosts).map(({ id, label, present, version, observed_at }) => ({ id, label, present, version, observed_at })),
    plugin_metadata: { host: 'codex', state: env.codexPlugins.state, observed_at: env.codexPlugins.observed_at },
    capabilities: inspectCapabilities(homeBaseRoot, registry, env),
  }
}

// Index sections from system/WORKSPACE-CONTRACT.md. The doctor's evidence is
// either a usable result or not; it never writes "Superseded".
export function indexSection(item) {
  return item.action_state === 'unavailable' ? 'Missing or blocked' : 'Available and verified'
}

const oneLine = (text) => String(text).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()

// One linked line per record, in the capabilities/INDEX.md format:
// - [<Capability>](<file>.md) — <one line>; checked YYYY-MM-DD
export function indexLine(item, link, checkedOn) {
  const label = oneLine(item.label).replaceAll('[', '(').replaceAll(']', ')')
  return `- [${label}](${link}) — ${oneLine(item.summary)}; ${RESULT_TEXT[item.action_state] ?? item.action_state}; checked ${checkedOn}`
}

export const DEFAULT_RECEIPT_NAME = (checkedOn) => `capability-doctor-${checkedOn}.md`

const cell = (text) => oneLine(text).replaceAll('|', '\\|')

export function renderReceiptMarkdown(receipt, { link, saved = false } = {}) {
  const target = link ?? DEFAULT_RECEIPT_NAME(receipt.checked_on)
  const found = receipt.hosts.filter((host) => host.present).map((host) => `${host.label} ${host.version ?? '(version not reported)'}`)
  const missing = receipt.hosts.filter((host) => !host.present).map((host) => host.label)
  const pluginNote = {
    read: 'Plugin rows come only from Codex’s own plugin list',
    unreadable: 'Codex did not report its plugins, so plugin rows are unconfirmed',
    host_absent: 'Codex is not installed here, so no plugin metadata was read',
  }[receipt.plugin_metadata.state]
  const sections = ['Available and verified', 'Missing or blocked'].map((heading) => {
    const lines = receipt.capabilities.filter((item) => indexSection(item) === heading).map((item) => indexLine(item, target, receipt.checked_on))
    return `### ${heading}\n\n${lines.length ? lines.join('\n') : 'None.'}\n`
  })
  const where = saved
    ? `The links point at this receipt, saved as \`capabilities/${target}\`.`
    : `Save this receipt with \`--output capabilities/${target}\` so the links work.`
  return `# Capability Doctor receipt

- Checked: ${receipt.checked_on}
- Observed at: ${receipt.observed_at}
- Assistants found: ${found.length ? found.join('; ') : 'none'}
- Assistants not found: ${missing.length ? missing.join('; ') : 'none'}

This is live environment evidence, not proof of correctness or permission to act. The doctor ran only allowlisted version commands and, when Codex is installed, Codex’s own plugin list; it read Home Base folder file names and the first line of \`CLAUDE.md\`. It did not start a model session, read tokens or config contents, check or trigger sign-in, call provider business data, test a write, or change plugin/connector state. ${pluginNote}; plugins and connectors inside Claude Code and Grok Build were not checked. Adapter rows show that the files each assistant documents reading are present, not that the assistant loaded them.

## Index lines

Copy a line into \`capabilities/INDEX.md\` under the heading of the same name (Index entries in \`system/WORKSPACE-CONTRACT.md\`). ${where} The assistant running this check adds its own \`opens Home Base directly\` line.

${sections.join('\n')}
## Details

| Capability | Host | Kind | Result | Evidence | Observed at | Next safe step |
|---|---|---|---|---|---|---|
${receipt.capabilities.map((item) => `| ${cell(item.label)} | ${cell(HOSTS[item.host]?.name ?? 'This computer')} | ${item.capability_kind} | ${item.action_state} | ${cell(item.source.join('; '))} | ${item.observed_at} | ${cell(item.next_safe_step)} |`).join('\n')}
`
}

const SOURCE_URL = /^https:\/\/[^\s]+$/

export function loadCapabilityRegistry(homeBaseRoot) {
  const registry = JSON.parse(fs.readFileSync(path.join(homeBaseRoot, 'system', 'capability-registry.json'), 'utf8'))
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.capabilities)) throw new Error('Unsupported Capability Doctor registry')
  const ids = new Set()
  for (const declaration of registry.capabilities) {
    if (ids.has(declaration.capability_id)) throw new Error(`Duplicate capability_id: ${declaration.capability_id}`)
    ids.add(declaration.capability_id)
    if (declaration.host !== undefined && !Object.hasOwn(HOSTS, declaration.host)) throw new Error(`Unknown host in ${declaration.capability_id}: ${declaration.host}`)
    if (declaration.sources !== undefined && (!Array.isArray(declaration.sources) || !declaration.sources.every((url) => typeof url === 'string' && SOURCE_URL.test(url)))) {
      throw new Error(`Sources in ${declaration.capability_id} must be https URLs`)
    }
    if ([...declaration.all_of, ...declaration.any_of.flat()].includes('adapter_files') && !declaration.sources?.length) {
      throw new Error(`Adapter entry ${declaration.capability_id} must cite the assistant's documentation`)
    }
  }
  return registry
}
