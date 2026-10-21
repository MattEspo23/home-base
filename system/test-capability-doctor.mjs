#!/usr/bin/env node

// Capability Doctor tests. Every probe runs against synthetic fixtures: a spy
// replaces node:child_process, so no real command starts, and fixture Home Base
// folders live in the system temporary folder. The one end-to-end group runs
// inspect-runtime.mjs with fake commands on PATH (POSIX only).

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { fileURLToPath } from 'node:url'

const systemDir = path.dirname(fileURLToPath(import.meta.url))
const homeBaseRoot = path.resolve(systemDir, '..')
const require = createRequire(import.meta.url)
const childProcess = require('node:child_process')

// ------------------------------------------------------------ child_process spy

const SPIED = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']
const original = Object.fromEntries(SPIED.map((name) => [name, childProcess[name]]))
const calls = []
const enoent = () => ({ error: Object.assign(new Error('spawnSync ENOENT'), { code: 'ENOENT' }), status: null, stdout: null, stderr: null })
let responder = enoent
for (const name of SPIED) {
  childProcess[name] = (command, args, options) => {
    calls.push({ fn: name, command, args: Array.isArray(args) ? [...args] : [], options })
    if (name !== 'spawnSync') throw new Error(`Capability Doctor called child_process.${name}`)
    return responder(command, Array.isArray(args) ? args : [], options)
  }
}
syncBuiltinESMExports()

const doctor = await import('./lib/capability-doctor.mjs')
const {
  ALLOWED_COMMANDS,
  HOSTS,
  buildReceipt,
  evaluateCapability,
  indexLine,
  inspectCapabilities,
  loadCapabilityRegistry,
  localDate,
  probeEnvironment,
  renderReceiptMarkdown,
} = doctor
const { parseIndex, parseAssistants } = await import('./dashboard/lib/status.mjs')

const registry = loadCapabilityRegistry(homeBaseRoot)
const NOW = new Date('2026-10-15T12:00:00.000Z')
const now = () => NOW
const CHECKED = localDate(NOW)
const allowedKeys = new Set(ALLOWED_COMMANDS.map((argv) => argv.join(' ')))

let checks = 0
const groups = []
function group(name, body) {
  const before = checks
  body()
  groups.push(`${name} (${checks - before})`)
}
function check(condition, message) {
  assert.ok(condition, message)
  checks += 1
}
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message)
  checks += 1
}

// Every spawn the doctor made was spawnSync, exactly allowlisted, without a
// shell and with stdin closed.
function assertOnlyAllowlisted(context) {
  for (const call of calls) {
    check(call.fn === 'spawnSync', `${context}: only spawnSync may run (saw ${call.fn})`)
    check(allowedKeys.has([call.command, ...call.args].join(' ')), `${context}: command outside the allowlist: ${[call.command, ...call.args].join(' ')}`)
    check(call.options?.shell === false && call.options?.stdio?.[0] === 'ignore', `${context}: no shell and closed stdin`)
  }
}

// ------------------------------------------------------------ fixtures

const tempRoots = []
function fixtureHomeBase({ agentsMd = true, claudeMd = '@AGENTS.md\n', agentsSkills = 40, claudeSkills = 40 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-doctor-'))
  tempRoots.push(root)
  fs.mkdirSync(path.join(root, 'system'), { recursive: true })
  fs.writeFileSync(path.join(root, 'system', 'update.mjs'), '// fixture\n')
  if (agentsMd) fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Fixture instructions\n')
  if (claudeMd !== null) fs.writeFileSync(path.join(root, 'CLAUDE.md'), claudeMd)
  const names = ['start-home-base', 'review-home-base-update', 'ask-espo', 'youtube-action-plan']
  while (names.length < 40) names.push(`fixture-skill-${names.length}`)
  for (const [folder, count] of [['.agents', agentsSkills], ['.claude', claudeSkills]]) {
    for (const name of names.slice(0, count)) {
      fs.mkdirSync(path.join(root, folder, 'skills', name), { recursive: true })
      fs.writeFileSync(path.join(root, folder, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: Fixture.\n---\n`)
    }
  }
  return root
}

const ok = (stdout) => ({ error: undefined, status: 0, stdout, stderr: '' })
const failed = () => ({ error: undefined, status: 1, stdout: '', stderr: 'fixture failure' })

// A synthetic computer: each value is the version a command reports, or null
// when the command is missing.
function machine({ codex = null, claude = null, grok = null, git = '2.39.5', gh = '2.60.0', plugins = [], pluginList = 'ok', noise = '' } = {}) {
  const versionOutput = {
    git: git && `git version ${git}`,
    gh: gh && `gh version ${gh} (2026-01-01)\nhttps://example.invalid/release`,
    codex: codex && `codex-cli ${codex}${noise}`,
    claude: claude && `${claude} (Claude Code)${noise}`,
    grok: grok && `grok ${grok} (c0ffee12) [stable]${noise}`,
  }
  return (command, args) => {
    if (args.length === 1 && args[0] === '--version') return versionOutput[command] ? ok(`${versionOutput[command]}\n`) : enoent()
    if (command === 'codex' && args.join(' ') === 'plugin list --json') {
      if (!codex) return enoent()
      if (pluginList === 'fail') return failed()
      if (pluginList === 'garbage') return ok('not json')
      return ok(JSON.stringify({ installed: plugins }))
    }
    return enoent()
  }
}

function run(root, spec) {
  calls.length = 0
  responder = machine(spec)
  const receipt = buildReceipt(root, registry, { now })
  responder = enoent
  return receipt
}

const byId = (receipt, id) => receipt.capabilities.find((item) => item.capability_id === id)
const HOST_ROW = { codex: 'codex-cli', 'claude-code': 'claude-code-cli', 'grok-build': 'grok-build-cli' }
const HOST_SPEC = { codex: 'codex', 'claude-code': 'claude', 'grok-build': 'grok' }
const VERSIONS = { codex: '0.160.1', claude: '2.1.289', grok: '1.0.50' }

// ------------------------------------------------------------ groups

const na = {
  workflow: 'not_applicable',
  host_command: 'not_applicable',
  adapter_files: 'not_applicable',
  plugin_installation: 'not_applicable',
  plugin_enablement: 'not_applicable',
  connector_configuration: 'not_applicable',
  auth_state: 'not_applicable',
  permission_state: 'not_applicable',
  source: ['deterministic fixture'],
  observed_at: 'fixture',
  confidence: 'high',
}

function declaration(capability_kind, all_of, any_of = [], maximum_action = 'usable_read_only') {
  return { capability_id: `fixture-${capability_kind}`, capability_kind, all_of, any_of, maximum_action }
}

group('requirement evaluation', () => {
  const fixtures = [
    ['repo-Skill-only ignores non-applicable command/plugin/connector', declaration('repo_skill_only', ['workflow']), { workflow: 'present' }, 'usable_read_only'],
    ['command-only supports its declared maximum action', declaration('command_only', ['host_command'], [], 'usable_write'), { host_command: 'present' }, 'usable_write'],
    ['plugin-only requires installation and enablement', declaration('plugin_only', ['plugin_installation', 'plugin_enablement']), { plugin_installation: 'present', plugin_enablement: 'present' }, 'usable_read_only'],
    ['plugin-plus-connector requires every declared dimension', declaration('plugin_connector', ['plugin_installation', 'plugin_enablement', 'connector_configuration']), { plugin_installation: 'present', plugin_enablement: 'present', connector_configuration: 'present' }, 'usable_read_only'],
    ['installed but disabled plugin is unavailable when enablement is required', declaration('plugin_only', ['plugin_installation', 'plugin_enablement']), { plugin_installation: 'present', plugin_enablement: 'absent' }, 'unavailable'],
    ['unconfigured connector is unavailable only when declared', declaration('plugin_connector', ['plugin_installation', 'plugin_enablement', 'connector_configuration']), { plugin_installation: 'present', plugin_enablement: 'present', connector_configuration: 'absent' }, 'unavailable'],
    ['unknown authentication cannot satisfy an auth requirement', declaration('plugin_connector', ['plugin_installation', 'plugin_enablement', 'auth_state']), { plugin_installation: 'present', plugin_enablement: 'present', auth_state: 'unknown' }, 'unavailable'],
    ['insufficient permission cannot produce usable write', declaration('plugin_connector', ['plugin_installation', 'plugin_enablement', 'auth_state', 'permission_state'], [], 'usable_write'), { plugin_installation: 'present', plugin_enablement: 'present', auth_state: 'confirmed', permission_state: 'insufficient' }, 'unavailable'],
    ['alternative command-or-plugin satisfies one complete any-of group', declaration('alternative', [], [['host_command'], ['plugin_installation', 'plugin_enablement']]), { host_command: 'present', plugin_installation: 'absent', plugin_enablement: 'absent' }, 'usable_read_only'],
    ['absent non-required connector does not block a command capability', declaration('command_only', ['host_command']), { host_command: 'present', connector_configuration: 'absent' }, 'usable_read_only'],
    ['unknown plugin state never counts as present', declaration('plugin_only', ['plugin_installation', 'plugin_enablement']), { plugin_installation: 'unknown', plugin_enablement: 'unknown' }, 'unavailable'],
    ['adapter files satisfy only when present', declaration('adapter_files', ['adapter_files']), { adapter_files: 'present' }, 'usable_read_only'],
    ['absent adapter files are unavailable', declaration('adapter_files', ['adapter_files']), { adapter_files: 'absent' }, 'unavailable'],
  ]
  for (const [name, decl, observation, expected] of fixtures) {
    equal(evaluateCapability(decl, { ...na, ...observation }).action_state, expected, name)
  }
  assert.throws(() => evaluateCapability(declaration('command_only', ['host_command']), { ...na, adapter_files: undefined }), /Invalid adapter_files/)
  checks += 1
})

group('registry', () => {
  const ids = registry.capabilities.map((item) => item.capability_id)
  for (const id of ['codex-cli', 'claude-code-cli', 'grok-build-cli', 'codex-adapter-files', 'claude-code-adapter-files', 'grok-build-adapter-files']) {
    check(ids.includes(id), `registry declares ${id}`)
  }
  const sources = (id) => registry.capabilities.find((item) => item.capability_id === id).sources ?? []
  check(sources('codex-adapter-files').includes('https://learn.chatgpt.com/docs/agent-configuration/agents-md'), 'Codex adapter cites the AGENTS.md guide')
  check(sources('claude-code-adapter-files').includes('https://code.claude.com/docs/en/memory'), 'Claude Code adapter cites the memory guide')
  check(sources('grok-build-adapter-files').some((url) => url.startsWith('https://github.com/xai-org/grok-build/') && url.endsWith('/docs/user-guide/12-project-rules.md')), 'Grok Build adapter cites project rules')
  check(sources('grok-build-adapter-files').some((url) => url.startsWith('https://github.com/xai-org/grok-build/') && url.endsWith('/docs/user-guide/08-skills.md')), 'Grok Build adapter cites skills')
  for (const item of registry.capabilities) {
    const pluginBacked = [...item.all_of, ...item.any_of.flat()].some((requirement) => requirement.startsWith('plugin_'))
    if (pluginBacked) check(item.host === 'codex' && /Codex plugin/.test(item.label), `${item.capability_id} names Codex as its plugin host`)
  }
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-registry-'))
  tempRoots.push(bad)
  fs.mkdirSync(path.join(bad, 'system'))
  const attempt = (capabilities) => {
    fs.writeFileSync(path.join(bad, 'system', 'capability-registry.json'), JSON.stringify({ schemaVersion: 1, capabilities }))
    return () => loadCapabilityRegistry(bad)
  }
  const base = { capability_id: 'x', label: 'X', capability_kind: 'adapter_files', all_of: ['adapter_files'], any_of: [], maximum_action: 'usable_read_only' }
  assert.throws(attempt([base]), /must cite/)
  assert.throws(attempt([{ ...base, sources: ['http://insecure.invalid'] }]), /https/)
  assert.throws(attempt([{ ...base, sources: ['https://example.invalid'], host: 'someone-else' }]), /Unknown host/)
  assert.throws(attempt([{ ...base, sources: ['https://example.invalid'] }, { ...base, sources: ['https://example.invalid'] }]), /Duplicate/)
  checks += 4
})

group('host present/absent combinations', () => {
  const root = fixtureHomeBase()
  const hostIds = Object.keys(HOSTS)
  for (let mask = 0; mask < 2 ** hostIds.length; mask += 1) {
    const present = hostIds.filter((_, index) => mask & (1 << index))
    const spec = Object.fromEntries(present.map((id) => [HOST_SPEC[id], VERSIONS[HOST_SPEC[id]]]))
    const receipt = run(root, spec)
    const context = `hosts [${present.join(', ') || 'none'}]`
    assertOnlyAllowlisted(context)
    check(calls.filter((call) => call.args.includes('plugin')).length === (present.includes('codex') ? 1 : 0), `${context}: Codex plugin list runs only when Codex is present`)
    for (const id of hostIds) {
      const row = byId(receipt, HOST_ROW[id])
      const isPresent = present.includes(id)
      const version = VERSIONS[HOST_SPEC[id]]
      check(row.host === id, `${context}: ${id} row is its own host`)
      check(row.action_state === (isPresent ? 'usable_read_only' : 'unavailable'), `${context}: ${id} result`)
      check(row.source[0] === (isPresent ? `${HOSTS[id].cli} present ${version} (${HOSTS[id].command} --version)` : `${HOSTS[id].cli} not found (${HOSTS[id].command} --version did not run)`), `${context}: ${id} evidence`)
      check(row.auth_state === 'unknown' && row.source.includes('sign-in not checked'), `${context}: ${id} sign-in is reported as unknown`)
      check(row.observed_at === NOW.toISOString(), `${context}: ${id} observed_at`)
      const hostSummary = receipt.hosts.find((host) => host.id === id)
      check(hostSummary.present === isPresent && hostSummary.version === (isPresent ? version : null), `${context}: ${id} host summary`)
    }
    // Plugin evidence belongs to Codex alone, whatever else is installed.
    for (const item of receipt.capabilities) {
      if (item.host !== 'codex') {
        check(item.plugin_installation === 'not_applicable' && item.plugin_enablement === 'not_applicable', `${context}: ${item.capability_id} carries no plugin state`)
        check(!item.source.some((text) => /plugin/i.test(text)), `${context}: ${item.capability_id} cites no plugin metadata`)
      }
    }
  }
})

group('no Codex on this computer', () => {
  const root = fixtureHomeBase()
  const receipt = run(root, { claude: '2.1.289', grok: '1.0.50' })
  assertOnlyAllowlisted('no Codex')
  check(!calls.some((call) => call.command === 'codex' && call.args[0] === 'plugin'), 'no Codex plugin list without Codex')
  equal(receipt.plugin_metadata.state, 'host_absent', 'plugin metadata is marked host_absent')
  for (const id of ['browser-control', 'google-drive-write']) {
    const row = byId(receipt, id)
    check(row.action_state === 'unavailable', `${id} is unavailable without Codex`)
    check(row.host === 'codex' && row.label.includes('Codex plugin'), `${id} stays labelled as a Codex plugin row`)
    check(row.source.includes('Codex plugin metadata not read: Codex CLI not found'), `${id} says why`)
    check(/Codex is not installed here/.test(row.next_safe_step) && /Codex only/.test(row.next_safe_step), `${id} next step does not send Claude or Grok users to a Codex plugin`)
  }
  check(byId(receipt, 'github-public-read').action_state === 'usable_read_only', 'GitHub CLI still provides public reading without Codex')
  check(byId(receipt, 'claude-code-cli').action_state === 'usable_read_only' && byId(receipt, 'grok-build-cli').action_state === 'usable_read_only', 'Claude Code and Grok Build rows are usable')
  const markdown = renderReceiptMarkdown(receipt)
  check(markdown.includes('Codex is not installed here, so no plugin metadata was read'), 'receipt says no plugin metadata was read')
  check(markdown.includes('plugins and connectors inside Claude Code and Grok Build were not checked'), 'receipt says other hosts were not checked')
  for (const line of markdown.split('\n').filter((text) => text.startsWith('| ') && /plugin/i.test(text))) {
    check(line.split(' | ')[1] === 'Codex', `plugin detail row is attributed to Codex: ${line.slice(0, 60)}`)
  }
})

group('Codex plugin metadata', () => {
  const root = fixtureHomeBase()
  const plugins = [
    { name: 'github', installed: true, enabled: true, version: '1.2.0' },
    { name: 'browser', installed: true, enabled: false, version: '0.9.0' },
    { name: 'bad name with spaces; rm -rf', installed: true, enabled: true, version: '1' },
  ]
  const receipt = run(root, { codex: '0.160.1', claude: '2.1.289', grok: '1.0.50', gh: null, plugins })
  assertOnlyAllowlisted('plugins read')
  check(byId(receipt, 'github-public-read').action_state === 'usable_read_only', 'enabled Codex GitHub plugin satisfies public reading')
  check(byId(receipt, 'github-public-read').source.includes('Codex plugin metadata: github 1.2.0'), 'GitHub plugin evidence names Codex')
  check(byId(receipt, 'browser-control').action_state === 'unavailable' && /enable it only if/.test(byId(receipt, 'browser-control').next_safe_step), 'installed but disabled browser plugin')
  check(!JSON.stringify(receipt).includes('rm -rf'), 'unsafe plugin names are dropped')
  for (const mode of ['fail', 'garbage']) {
    const unreadable = run(root, { codex: '0.160.1', pluginList: mode })
    const row = byId(unreadable, 'browser-control')
    check(row.plugin_installation === 'unknown' && row.action_state === 'unavailable', `plugin list ${mode}: unknown, not absent`)
    check(/did not report its plugins/.test(row.next_safe_step), `plugin list ${mode}: next step says so`)
  }
})

group('adapter files', () => {
  const cases = [
    ['complete Home Base', {}, { codex: true, claude: true, grok: true }],
    ['no CLAUDE.md', { claudeMd: null }, { codex: true, claude: false, grok: true }],
    ['CLAUDE.md without the AGENTS.md import', { claudeMd: '# Claude only\n' }, { codex: true, claude: false, grok: true }],
    ['import below the first line', { claudeMd: ['# Title', '@AGENTS.md', ''].join('\n') }, { codex: true, claude: false, grok: true }],
    ['byte-order mark before the import', { claudeMd: ['\uFEFF', '@AGENTS.md\n'].join('') }, { codex: true, claude: true, grok: true }],
    ['no .claude/skills', { claudeSkills: 0 }, { codex: true, claude: false, grok: true }],
    ['no .agents/skills', { agentsSkills: 0 }, { codex: false, claude: true, grok: true }],
    ['no AGENTS.md', { agentsMd: false, claudeMd: '# Claude only\n' }, { codex: false, claude: false, grok: true }],
    ['no instructions at all', { agentsMd: false, claudeMd: null }, { codex: false, claude: false, grok: false }],
    ['no Skills folders', { agentsSkills: 0, claudeSkills: 0 }, { codex: false, claude: false, grok: false }],
  ]
  for (const [name, layout, expected] of cases) {
    const root = fixtureHomeBase(layout)
    calls.length = 0
    const env = probeEnvironment(root, { now })
    const rows = inspectCapabilities(root, registry, env)
    for (const [host, id] of [['codex', 'codex-adapter-files'], ['claude', 'claude-code-adapter-files'], ['grok', 'grok-build-adapter-files']]) {
      const row = rows.find((item) => item.capability_id === id)
      check(row.action_state === (expected[host] ? 'usable_read_only' : 'unavailable'), `${name}: ${id}`)
      check(row.source.includes('file presence only; not a live load test'), `${name}: ${id} is honest about its evidence`)
    }
  }
  const missingFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-empty-'))
  tempRoots.push(missingFolder)
  const rows = inspectCapabilities(missingFolder, registry, probeEnvironment(missingFolder, { now }))
  check(rows.find((item) => item.capability_id === 'home-base-core-skills').action_state === 'unavailable', 'an empty folder does not crash the Skill checks')
})

group('dated receipt in index line format', () => {
  const root = fixtureHomeBase()
  const receipt = run(root, { codex: '0.160.1', claude: '2.1.289', grok: '1.0.50' })
  equal(receipt.checked_on, CHECKED, 'JSON receipt carries the check date')
  check(/^\d{4}-\d{2}-\d{2}$/.test(receipt.checked_on), 'check date is a calendar date')
  for (const [options, link] of [[{}, `capability-doctor-${CHECKED}.md`], [{ link: 'doctor/today.md', saved: true }, 'doctor/today.md']]) {
    const markdown = renderReceiptMarkdown(receipt, options)
    check(markdown.split('\n').includes(`- Checked: ${CHECKED}`), 'markdown receipt has a date line')
    check(markdown.includes(`- Observed at: ${NOW.toISOString()}`), 'markdown receipt has the observation time')
    const lines = markdown.split('\n').filter((line) => line.startsWith('- ['))
    check(lines.length === receipt.capabilities.length, 'one linked line per record')
    const pattern = new RegExp(`^- \\[[^\\]]+\\]\\(${link.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\) — [^\\n]+; checked ${CHECKED}$`)
    for (const line of lines) check(pattern.test(line), `index line format: ${line}`)
    check(markdown.includes(`- [Codex CLI](${link}) — present 0.160.1; usable read-only; checked ${CHECKED}`), 'Codex CLI line')
    check(markdown.includes(`- [Claude Code CLI](${link}) — present 2.1.289; usable read-only; checked ${CHECKED}`), 'Claude Code CLI line')
    check(markdown.includes(`- [Grok Build CLI](${link}) — present 1.0.50; usable read-only; checked ${CHECKED}`), 'Grok Build CLI line')
    // The dashboard reads the same lines from capabilities/INDEX.md.
    const sections = ['Available and verified', 'Missing or blocked']
    const index = sections.map((heading) => {
      const body = markdown.split(`### ${heading}\n\n`)[1].split('\n\n')[0]
      return `## ${heading}\n\n${body}\n`
    }).join('\n')
    const parsed = parseIndex(index)
    const items = sections.flatMap((heading) => parsed.get(heading.toLowerCase()) ?? [])
    check(items.length === receipt.capabilities.length && items.every((item) => item.checked === CHECKED), 'dashboard parser reads every line as linked and dated')
    check(sections.every((heading) => (parsed.get(heading.toLowerCase())?.unlinked.length ?? 0) === 0), 'no unlinked entries')
    equal(parseAssistants(index), [], 'doctor lines never claim an assistant opens Home Base')
  }
  const saved = renderReceiptMarkdown(receipt, { link: 'today.md', saved: true })
  check(saved.includes('saved as `capabilities/today.md`'), 'saved receipt names its own file')
  check(!renderReceiptMarkdown(receipt).includes(os.tmpdir()), 'no machine path in the receipt')
  const sample = { ...receipt.capabilities[0], label: 'Odd [label]', summary: 'two\nlines' }
  check(indexLine(sample, 'r.md', CHECKED) === `- [Odd (label)](r.md) — two lines; usable read-only; checked ${CHECKED}`, 'labels and summaries stay on one parseable line')
})

group('no secrets from command output', () => {
  const root = fixtureHomeBase()
  const noise = ' extra-output FIXTURE-OUTPUT-MARKER-7f3a'
  const receipt = run(root, { codex: '0.160.1', claude: '2.1.289', grok: '1.0.50', noise })
  const text = `${JSON.stringify(receipt)}\n${renderReceiptMarkdown(receipt)}`
  check(!text.includes('FIXTURE-OUTPUT-MARKER') && !text.includes('extra-output'), 'only the version number leaves command output')
  check(byId(receipt, 'grok-build-cli').source[0] === 'Grok Build CLI present 1.0.50 (grok --version)', 'version still parsed')
  const odd = run(root, { codex: 'not-a-version' })
  check(byId(odd, 'codex-cli').source[0] === 'Codex CLI present version not reported (codex --version)', 'unparseable version is reported as such')
})

group('allowlist', () => {
  equal(ALLOWED_COMMANDS.map((argv) => argv.join(' ')), [
    'git --version',
    'gh --version',
    'codex --version',
    'claude --version',
    'grok --version',
    'codex plugin list --json',
  ], 'the allowlist is exactly the read-only version and listing commands')
  check(Object.isFrozen(ALLOWED_COMMANDS) && ALLOWED_COMMANDS.every(Object.isFrozen), 'the allowlist cannot be changed at runtime')
  check(!ALLOWED_COMMANDS.some((argv) => argv.some((arg) => /^(-p|--print|exec|-c|auth|login|inspect|mcp)$/.test(arg))), 'no prompt, session, sign-in, inspect or MCP command')
})

// End to end: inspect-runtime.mjs in a fixture folder, with fake commands on
// PATH that record how they were called.
group('inspect-runtime end to end', () => {
  if (process.platform === 'win32') return
  const root = fixtureHomeBase()
  fs.mkdirSync(path.join(root, 'system', 'lib'), { recursive: true })
  for (const file of ['inspect-runtime.mjs', 'capability-registry.json', path.join('lib', 'capability-doctor.mjs')]) {
    fs.copyFileSync(path.join(systemDir, file), path.join(root, 'system', file))
  }
  const bin = path.join(root, 'fake-bin')
  const log = path.join(root, 'calls.log')
  fs.mkdirSync(bin)
  const fake = { git: 'git version 2.39.5', claude: '2.1.289 (Claude Code)', grok: 'grok 1.0.50 (c0ffee12) [stable]' }
  for (const [name, version] of Object.entries(fake)) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\necho "${version}"\n`, { mode: 0o755 })
  }
  const runtime = (args) => original.spawnSync(process.execPath, [path.join(root, 'system', 'inspect-runtime.mjs'), ...args], {
    encoding: 'utf8',
    env: { PATH: bin, HOME: root },
  })
  const result = runtime(['--output', 'capabilities/doctor.md'])
  check(result.status === 0, `inspect-runtime runs: ${result.stderr}`)
  const markdown = fs.readFileSync(path.join(root, 'capabilities', 'doctor.md'), 'utf8')
  check(/^- Checked: \d{4}-\d{2}-\d{2}$/m.test(markdown), 'saved receipt is dated')
  check(markdown.includes('- [Codex CLI](doctor.md) — not found on this computer; unavailable; checked '), 'missing Codex is reported, linked to the saved file')
  check(markdown.includes('- [Grok Build CLI](doctor.md) — present 1.0.50; usable read-only; checked '), 'Grok Build found')
  const logged = fs.readFileSync(log, 'utf8').trim().split('\n').sort()
  equal(logged, ['claude --version', 'git --version', 'grok --version'], 'only allowlisted version commands ran')
  const json = JSON.parse(runtime(['--json']).stdout)
  check(json.schemaVersion === 2 && /^\d{4}-\d{2}-\d{2}$/.test(json.checked_on), 'JSON receipt is dated')
  const outside = runtime(['--output', '../escape.md'])
  check(outside.status !== 0 && !fs.existsSync(path.join(root, '..', 'escape.md')), '--output stays inside capabilities/')
})

for (const name of SPIED) childProcess[name] = original[name]
syncBuiltinESMExports()
for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true })

console.log(`Capability Doctor tests passed (${groups.length} groups, ${checks} checks):\n- ${groups.join('\n- ')}`)
