#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildReceipt,
  loadCapabilityRegistry,
  renderReceiptMarkdown,
} from './lib/capability-doctor.mjs'

const systemDir = path.dirname(fileURLToPath(import.meta.url))
const homeBaseRoot = path.resolve(systemDir, '..')
const args = process.argv.slice(2)
const outputIndex = args.indexOf('--output')
const output = outputIndex >= 0 ? args[outputIndex + 1] : undefined
const json = args.includes('--json')
if (outputIndex >= 0 && (!output || output.startsWith('--'))) throw new Error('--output needs a path inside capabilities/')

let outputPath
let link
if (output) {
  outputPath = path.resolve(homeBaseRoot, output)
  const relative = path.relative(homeBaseRoot, outputPath)
  if (relative.startsWith('..') || path.isAbsolute(relative) || !relative.startsWith(`capabilities${path.sep}`)) {
    throw new Error('--output must stay inside capabilities/')
  }
  // Index links are relative to capabilities/INDEX.md.
  link = path.relative(path.join(homeBaseRoot, 'capabilities'), outputPath).split(path.sep).join('/')
}

const receipt = buildReceipt(homeBaseRoot, loadCapabilityRegistry(homeBaseRoot))
const rendered = json
  ? `${JSON.stringify(receipt, null, 2)}\n`
  : renderReceiptMarkdown(receipt, { link: link?.endsWith('.md') ? link : undefined, saved: Boolean(link?.endsWith('.md')) })

if (!outputPath) {
  process.stdout.write(rendered)
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, rendered)
  console.log(`Wrote ${path.relative(homeBaseRoot, outputPath)}`)
}
