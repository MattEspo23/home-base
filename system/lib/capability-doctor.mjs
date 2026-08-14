import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const PRESENCE = new Set(['not_applicable', 'absent', 'present'])
const AUTH = new Set(['not_applicable', 'unknown', 'needed', 'confirmed'])
const PERMISSION = new Set(['not_applicable', 'unknown', 'insufficient', 'sufficient'])
const REQUIREMENTS = new Set([
  'workflow',
  'host_command',
  'plugin_installation',
  'plugin_enablement',
  'connector_configuration',
  'auth_state',
  'permission_state',
])

function satisfies(requirement, observation) {
  if (['workflow', 'host_command', 'plugin_installation', 'plugin_enablement', 'connector_configuration'].includes(requirement)) {
    return observation[requirement] === 'present'
  }
  if (requirement === 'auth_state') return observation.auth_state === 'confirmed'
  if (requirement === 'permission_state') return observation.permission_state === 'sufficient'
  throw new Error(`Unknown capability requirement: ${requirement}`)
}

function nextStepFor(missing, observation) {
  if (missing.includes('workflow')) return 'Restore or install the named repository Skill before retrying.'
  if (missing.includes('host_command')) return 'Install the named local command, then rerun this read-only doctor.'
  if (missing.includes('plugin_installation')) return 'Review and install the named plugin from a trusted marketplace.'
  if (missing.includes('plugin_enablement')) return 'Review the installed plugin and enable it only if you want this capability.'
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
  for (const key of ['workflow', 'host_command', 'plugin_installation', 'plugin_enablement', 'connector_configuration']) {
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
    requirements: {
      all_of: declaration.all_of,
      any_of: declaration.any_of,
    },
    action_state: missing.length === 0 ? declaration.maximum_action : 'unavailable',
    missing_requirements: missing,
    next_safe_step: nextStepFor(missing, observation),
  }
}

function commandVersion(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 5000 })
  if (result.error || result.status !== 0) return null
  return `${result.stdout ?? result.stderr}`.trim().split('\n')[0]
}

function pluginMetadata() {
  const result = spawnSync('codex', ['plugin', 'list', '--json'], { encoding: 'utf8', timeout: 10000 })
  if (result.error || result.status !== 0) return []
  try {
    const parsed = JSON.parse(result.stdout)
    return Array.isArray(parsed.installed) ? parsed.installed.map((item) => ({
      name: item.name,
      installed: item.installed === true,
      enabled: item.enabled === true,
      version: item.version ?? 'unknown',
    })) : []
  } catch {
    return []
  }
}

function baseObservation() {
  return {
    workflow: 'not_applicable',
    host_command: 'not_applicable',
    plugin_installation: 'not_applicable',
    plugin_enablement: 'not_applicable',
    connector_configuration: 'not_applicable',
    auth_state: 'not_applicable',
    permission_state: 'not_applicable',
    source: [],
    observed_at: new Date().toISOString(),
    confidence: 'high',
  }
}

export function inspectCapabilities(homeBaseRoot, registry) {
  const versions = {
    node: process.version,
    git: commandVersion('git'),
    codex: commandVersion('codex'),
    claude: commandVersion('claude'),
    gh: commandVersion('gh'),
  }
  const plugins = pluginMetadata()
  const plugin = (name) => plugins.find((item) => item.name === name)
  const hasSkillCount = (expected, names) => names.every((name) => fs.existsSync(path.join(homeBaseRoot, '.agents', 'skills', name, 'SKILL.md')))
    && fs.readdirSync(path.join(homeBaseRoot, '.agents', 'skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length === expected

  return registry.capabilities.map((declaration) => {
    const observation = baseObservation()
    if (declaration.capability_id === 'home-base-core-skills') {
      observation.workflow = hasSkillCount(40, ['start-home-base', 'review-home-base-update']) ? 'present' : 'absent'
      observation.source.push('repository Skill metadata')
    } else if (declaration.capability_id === 'skill-vault-skills') {
      observation.workflow = hasSkillCount(40, ['ask-espo', 'youtube-action-plan']) ? 'present' : 'absent'
      observation.source.push('pinned Skill Vault projection')
    } else if (declaration.capability_id === 'home-base-updater') {
      observation.workflow = fs.existsSync(path.join(homeBaseRoot, 'system', 'update.mjs')) ? 'present' : 'absent'
      observation.host_command = versions.node ? 'present' : 'absent'
      observation.source.push(`repository updater; Node ${versions.node ?? 'not found'}`)
    } else if (declaration.capability_id === 'local-javascript') {
      observation.host_command = 'present'
      observation.source.push(`Node ${versions.node}`)
    } else if (declaration.capability_id === 'git-local') {
      observation.host_command = versions.git ? 'present' : 'absent'
      observation.source.push(versions.git ?? 'Git command not found')
    } else if (declaration.capability_id === 'codex-cli') {
      observation.host_command = versions.codex ? 'present' : 'absent'
      observation.source.push(versions.codex ?? 'Codex command not found')
    } else if (declaration.capability_id === 'claude-code-cli') {
      observation.host_command = versions.claude ? 'present' : 'absent'
      observation.source.push(versions.claude ?? 'Claude command not found')
    } else if (declaration.capability_id.startsWith('github-')) {
      const githubPlugin = plugin('github')
      observation.host_command = versions.gh ? 'present' : 'absent'
      observation.plugin_installation = githubPlugin?.installed ? 'present' : 'absent'
      observation.plugin_enablement = githubPlugin?.enabled ? 'present' : 'absent'
      observation.source.push(versions.gh ?? 'GitHub CLI not found', githubPlugin ? `host plugin metadata: github ${githubPlugin.version}` : 'GitHub plugin not reported')
      if (declaration.capability_id === 'github-account-write') {
        observation.auth_state = 'unknown'
        observation.permission_state = 'unknown'
        observation.confidence = 'medium'
      }
    } else if (declaration.capability_id === 'browser-control') {
      const browserPlugin = plugin('browser') ?? plugin('chrome')
      observation.plugin_installation = browserPlugin?.installed ? 'present' : 'absent'
      observation.plugin_enablement = browserPlugin?.enabled ? 'present' : 'absent'
      observation.source.push(browserPlugin ? `host plugin metadata: ${browserPlugin.name} ${browserPlugin.version}` : 'Browser plugin not reported')
    } else if (declaration.capability_id === 'google-drive-write') {
      const drivePlugin = plugin('google-drive')
      observation.plugin_installation = drivePlugin?.installed ? 'present' : 'absent'
      observation.plugin_enablement = drivePlugin?.enabled ? 'present' : 'absent'
      observation.connector_configuration = 'absent'
      observation.auth_state = 'unknown'
      observation.permission_state = 'unknown'
      observation.confidence = 'low'
      observation.source.push(drivePlugin ? `host plugin metadata: google-drive ${drivePlugin.version}` : 'Google Drive plugin not reported', 'connector/auth/permission not exposed by allowlisted probes')
    }
    return {
      label: declaration.label,
      ...evaluateCapability(declaration, observation),
    }
  })
}

export function loadCapabilityRegistry(homeBaseRoot) {
  const registry = JSON.parse(fs.readFileSync(path.join(homeBaseRoot, 'system', 'capability-registry.json'), 'utf8'))
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.capabilities)) throw new Error('Unsupported Capability Doctor registry')
  return registry
}
