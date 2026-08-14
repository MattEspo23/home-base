#!/usr/bin/env node

import assert from 'node:assert/strict'
import { evaluateCapability } from './lib/capability-doctor.mjs'

const na = {
  workflow: 'not_applicable',
  host_command: 'not_applicable',
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

const fixtures = [
  {
    name: 'repo-Skill-only ignores non-applicable command/plugin/connector',
    declaration: declaration('repo_skill_only', ['workflow']),
    observation: { ...na, workflow: 'present' },
    expected: 'usable_read_only',
  },
  {
    name: 'command-only supports its declared maximum action',
    declaration: declaration('command_only', ['host_command'], [], 'usable_write'),
    observation: { ...na, host_command: 'present' },
    expected: 'usable_write',
  },
  {
    name: 'plugin-only requires installation and enablement',
    declaration: declaration('plugin_only', ['plugin_installation', 'plugin_enablement']),
    observation: { ...na, plugin_installation: 'present', plugin_enablement: 'present' },
    expected: 'usable_read_only',
  },
  {
    name: 'plugin-plus-connector requires every declared dimension',
    declaration: declaration('plugin_connector', ['plugin_installation', 'plugin_enablement', 'connector_configuration']),
    observation: { ...na, plugin_installation: 'present', plugin_enablement: 'present', connector_configuration: 'present' },
    expected: 'usable_read_only',
  },
  {
    name: 'installed but disabled plugin is unavailable when enablement is required',
    declaration: declaration('plugin_only', ['plugin_installation', 'plugin_enablement']),
    observation: { ...na, plugin_installation: 'present', plugin_enablement: 'absent' },
    expected: 'unavailable',
  },
  {
    name: 'unconfigured connector is unavailable only when declared',
    declaration: declaration('plugin_connector', ['plugin_installation', 'plugin_enablement', 'connector_configuration']),
    observation: { ...na, plugin_installation: 'present', plugin_enablement: 'present', connector_configuration: 'absent' },
    expected: 'unavailable',
  },
  {
    name: 'unknown authentication cannot satisfy an auth requirement',
    declaration: declaration('plugin_connector', ['plugin_installation', 'plugin_enablement', 'auth_state']),
    observation: { ...na, plugin_installation: 'present', plugin_enablement: 'present', auth_state: 'unknown' },
    expected: 'unavailable',
  },
  {
    name: 'insufficient permission cannot produce usable write',
    declaration: declaration('plugin_connector', ['plugin_installation', 'plugin_enablement', 'auth_state', 'permission_state'], [], 'usable_write'),
    observation: { ...na, plugin_installation: 'present', plugin_enablement: 'present', auth_state: 'confirmed', permission_state: 'insufficient' },
    expected: 'unavailable',
  },
  {
    name: 'alternative command-or-plugin satisfies one complete any-of group',
    declaration: declaration('alternative', [], [['host_command'], ['plugin_installation', 'plugin_enablement']]),
    observation: { ...na, host_command: 'present', plugin_installation: 'absent', plugin_enablement: 'absent' },
    expected: 'usable_read_only',
  },
  {
    name: 'absent non-required connector does not block a command capability',
    declaration: declaration('command_only', ['host_command']),
    observation: { ...na, host_command: 'present', connector_configuration: 'absent' },
    expected: 'usable_read_only',
  },
]

for (const fixture of fixtures) {
  const observed = evaluateCapability(fixture.declaration, fixture.observation)
  assert.equal(observed.action_state, fixture.expected, fixture.name)
}

console.log(`Capability Doctor fixtures passed (${fixtures.length} cases).`)
