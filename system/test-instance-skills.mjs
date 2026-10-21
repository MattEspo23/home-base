#!/usr/bin/env node

// Private-skill linking runs only against temporary folders and a fake home
// folder; the real home folder is never touched.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  applyInstanceSkills,
  planInstanceSkills,
  planRemoveInstanceSkills,
  removeInstanceSkills,
} from './instance-skills.mjs'

const systemDir = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-instance-skills-'))
const checks = []

function write(root, relativePath, value) {
  const target = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, value)
}

function skill(name, declared = name) {
  return `---\nname: ${declared}\ndescription: Fixture private skill.\n---\n\n# ${name}\n`
}

function createHomeBase(root) {
  write(root, '.claude/skills/start-home-base/SKILL.md', skill('start-home-base'))
  write(root, '.agents/skills/start-home-base/SKILL.md', skill('start-home-base'))
  write(root, 'instance/skills/owner-weekly-review/SKILL.md', skill('owner-weekly-review'))
  write(root, 'instance/skills/notes.md', 'not a skill folder\n')
}

try {
  const root = path.join(fixtureRoot, 'home-base')
  const home = path.join(fixtureRoot, 'fake-home')
  createHomeBase(root)

  const preview = planInstanceSkills({ root, home })
  assert.equal(preview.steps.length, 2)
  assert.ok(preview.steps.every((step) => step.state === 'missing'))
  assert.equal(fs.existsSync(home), false)
  checks.push('preview lists both user-level links and writes nothing')

  applyInstanceSkills({ root, home })
  for (const adapter of ['.claude', '.agents']) {
    const link = path.join(home, adapter, 'skills', 'owner-weekly-review')
    assert.ok(fs.lstatSync(link).isSymbolicLink())
    assert.equal(fs.readlinkSync(link), path.join(root, 'instance', 'skills', 'owner-weekly-review'))
    assert.ok(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8').includes('owner-weekly-review'))
  }
  assert.ok(applyInstanceSkills({ root, home }).steps.every((step) => step.state === 'linked'))
  checks.push('apply links into ~/.claude/skills and ~/.agents/skills and is idempotent')

  write(home, '.claude/skills/someone-elses-skill/SKILL.md', skill('someone-elses-skill'))
  fs.symlinkSync(path.join(fixtureRoot, 'elsewhere'), path.join(home, '.agents', 'skills', 'foreign-link'))
  const removalPreview = planRemoveInstanceSkills({ root, home })
  assert.equal(removalPreview.links.length, 2)
  assert.ok(fs.lstatSync(path.join(home, '.claude', 'skills', 'owner-weekly-review')).isSymbolicLink(), 'the removal preview deletes nothing')
  const removed = removeInstanceSkills({ root, home })
  assert.equal(removed.removed.length, 2)
  assert.equal(fs.existsSync(path.join(home, '.claude', 'skills', 'owner-weekly-review')), false)
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'someone-elses-skill', 'SKILL.md')))
  assert.ok(fs.lstatSync(path.join(home, '.agents', 'skills', 'foreign-link')).isSymbolicLink())
  checks.push('remove deletes only links that point into this instance/skills folder')

  // The conflict sits in the second target, so an implementation that wrote
  // as it went would already have created the first link.
  fs.mkdirSync(path.join(home, '.agents', 'skills', 'owner-weekly-review'))
  assert.throws(() => applyInstanceSkills({ root, home }), /Refusing to replace an existing user-level skill/)
  assert.equal(fs.lstatSync(path.join(home, '.claude', 'skills', 'owner-weekly-review'), { throwIfNoEntry: false }), undefined)
  fs.rmdirSync(path.join(home, '.agents', 'skills', 'owner-weekly-review'))
  checks.push('an existing non-link entry is never replaced, and nothing is written when any step is refused')

  const collision = path.join(fixtureRoot, 'collision')
  createHomeBase(collision)
  write(collision, 'instance/skills/start-home-base/SKILL.md', skill('start-home-base'))
  assert.throws(() => planInstanceSkills({ root: collision, home }), /shadow a Home Base repository skill/)
  const badName = path.join(fixtureRoot, 'bad-name')
  createHomeBase(badName)
  write(badName, 'instance/skills/Owner_Notes/SKILL.md', skill('Owner_Notes'))
  assert.throws(() => planInstanceSkills({ root: badName, home }), /kebab-case/)
  const mismatch = path.join(fixtureRoot, 'mismatch')
  createHomeBase(mismatch)
  write(mismatch, 'instance/skills/owner-plan/SKILL.md', skill('owner-plan', 'other-name'))
  assert.throws(() => planInstanceSkills({ root: mismatch, home }), /must match its folder/)
  checks.push('repository-skill collisions, non-kebab names, and mismatched SKILL.md names are refused')

  const cliHome = path.join(fixtureRoot, 'cli-home')
  const cli = spawnSync(process.execPath, [path.join(systemDir, 'instance-skills.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, HOME_BASE_SKILLS_HOME: cliHome },
  })
  // The real instance/ may hold the user's own skills; preview must still write nothing.
  assert.ok([0, 1].includes(cli.status), cli.stderr)
  assert.equal(fs.existsSync(cliHome), false)
  const usage = spawnSync(process.execPath, [path.join(systemDir, 'instance-skills.mjs'), '--bogus'], {
    encoding: 'utf8',
    env: { ...process.env, HOME_BASE_SKILLS_HOME: cliHome },
  })
  assert.equal(usage.status, 2)
  const cliRoot = path.join(fixtureRoot, 'cli-root')
  createHomeBase(cliRoot)
  fs.mkdirSync(path.join(cliRoot, 'system'))
  fs.copyFileSync(path.join(systemDir, 'instance-skills.mjs'), path.join(cliRoot, 'system', 'instance-skills.mjs'))
  const cliRun = (...args) => spawnSync(process.execPath, [path.join(cliRoot, 'system', 'instance-skills.mjs'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME_BASE_SKILLS_HOME: cliHome },
  })
  assert.equal(cliRun('--apply').status, 0)
  const cliLink = path.join(cliHome, '.claude', 'skills', 'owner-weekly-review')
  assert.ok(fs.lstatSync(cliLink).isSymbolicLink())
  const removePreview = cliRun('--remove')
  assert.equal(removePreview.status, 0)
  assert.ok(removePreview.stdout.includes('would remove'))
  assert.ok(fs.lstatSync(cliLink).isSymbolicLink(), '--remove alone only previews')
  assert.equal(cliRun('--remove', '--apply').status, 0)
  assert.equal(fs.lstatSync(cliLink, { throwIfNoEntry: false }), undefined)
  checks.push('the command previews by default (for --remove too), needs --apply to write or delete, honours HOME_BASE_SKILLS_HOME, and rejects unknown flags')
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}

console.log(`Instance skill fixtures passed (${checks.length} checks):`)
for (const check of checks) console.log(`- ${check}`)
