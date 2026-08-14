#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  inspectCapabilities,
  loadCapabilityRegistry,
} from './lib/capability-doctor.mjs'

const systemDir = path.dirname(fileURLToPath(import.meta.url))
const homeBaseRoot = path.resolve(systemDir, '..')
const args = process.argv.slice(2)
const outputIndex = args.indexOf('--output')
const output = outputIndex >= 0 ? args[outputIndex + 1] : undefined
const json = args.includes('--json')
const receipt = {
  schemaVersion: 1,
  receiptType: 'live_environment_evidence_not_correctness_proof',
  probePolicy: 'allowlisted_command_versions_repository_metadata_and_host_reported_plugin_metadata_only',
  capabilities: inspectCapabilities(homeBaseRoot, loadCapabilityRegistry(homeBaseRoot)),
}

function markdown() {
  return `# Capability Doctor receipt\n\nThis is live environment evidence, not proof of correctness or permission to act. The doctor read repository metadata, allowlisted command versions, and host-reported plugin metadata only. It did not read tokens or config contents, trigger login, call provider business data, test a write, or change plugin/connector state.\n\n| Capability | Kind | Result | Evidence | Next safe step |\n|---|---|---|---|---|\n${receipt.capabilities.map((item) => `| ${item.label.replaceAll('|', '\\|')} | ${item.capability_kind} | ${item.action_state} | ${item.source.join('; ').replaceAll('|', '\\|')} | ${item.next_safe_step.replaceAll('|', '\\|')} |`).join('\n')}\n`
}

const rendered = json ? `${JSON.stringify(receipt, null, 2)}\n` : markdown()
if (!output) {
  process.stdout.write(rendered)
} else {
  const outputPath = path.resolve(homeBaseRoot, output)
  const relative = path.relative(homeBaseRoot, outputPath)
  if (relative.startsWith('..') || path.isAbsolute(relative) || !relative.startsWith(`capabilities${path.sep}`)) {
    throw new Error('--output must stay inside capabilities/')
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, rendered)
  console.log(`Wrote ${relative}`)
}
