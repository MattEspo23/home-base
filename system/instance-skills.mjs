#!/usr/bin/env node

// Links private skills from instance/skills/<name>/SKILL.md into the user-level
// skill folders (~/.claude/skills and ~/.agents/skills) so every project can
// use them, while their source stays in the private instance/ overlay.
//
// Preview is the default and writes nothing. Writing into the home folder is an
// outside action: show the preview, get the user's approval at that moment,
// then run again with --apply. --remove previews the links it would delete
// (only links that point into this instance/skills folder); --remove --apply
// deletes them. HOME_BASE_SKILLS_HOME redirects the home folder (tests).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function skillHome(home) {
  return home ?? process.env.HOME_BASE_SKILLS_HOME ?? os.homedir()
}

function skillTargets(home) {
  return [path.join(home, '.claude', 'skills'), path.join(home, '.agents', 'skills')]
}

function repositorySkillNames(root) {
  const names = new Set()
  for (const adapter of ['.claude', '.agents']) {
    const folder = path.join(root, adapter, 'skills')
    if (!fs.existsSync(folder)) continue
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) names.add(entry.name.toLowerCase())
    }
  }
  return names
}

function frontmatterName(skillFile) {
  const contents = fs.readFileSync(skillFile, 'utf8')
  const block = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const line = block?.[1].split(/\r?\n/).find((item) => /^name:\s*/.test(item))
  return line?.replace(/^name:\s*/, '').replace(/^["']|["']$/g, '').trim()
}

function linkPointsInto(link, folder) {
  const stat = fs.lstatSync(link, { throwIfNoEntry: false })
  if (!stat?.isSymbolicLink()) return false
  const target = path.resolve(path.dirname(link), fs.readlinkSync(link))
  return target.startsWith(`${folder}${path.sep}`)
}

// Returns the full list of link steps, or throws before anything is written.
export function planInstanceSkills({ root, home } = {}) {
  const resolvedHome = skillHome(home)
  const source = path.join(root, 'instance', 'skills')
  const repositorySkills = repositorySkillNames(root)
  const names = fs.existsSync(source)
    ? fs.readdirSync(source).filter((name) => fs.statSync(path.join(source, name)).isDirectory()).sort()
    : []
  const steps = []
  for (const name of names) {
    if (!KEBAB.test(name)) throw new Error(`Private skill folder names must be kebab-case: ${name}`)
    if (repositorySkills.has(name)) {
      throw new Error(`Private skill would shadow a Home Base repository skill everywhere: ${name}`)
    }
    const skillFile = path.join(source, name, 'SKILL.md')
    if (!fs.existsSync(skillFile)) throw new Error(`Private skill is missing SKILL.md: ${name}`)
    if (frontmatterName(skillFile) !== name) throw new Error(`SKILL.md name must match its folder: ${name}`)
    for (const target of skillTargets(resolvedHome)) {
      const link = path.join(target, name)
      const to = path.join(source, name)
      const existing = fs.lstatSync(link, { throwIfNoEntry: false })
      const ours = existing?.isSymbolicLink() && path.resolve(target, fs.readlinkSync(link)) === to
      if (existing && !ours) throw new Error(`Refusing to replace an existing user-level skill that this script did not create: ${link}`)
      steps.push({ name, link, to, state: ours ? 'linked' : 'missing' })
    }
  }
  return { home: resolvedHome, source, steps }
}

export function applyInstanceSkills(options = {}) {
  const plan = planInstanceSkills(options)
  for (const step of plan.steps.filter((item) => item.state === 'missing')) {
    fs.mkdirSync(path.dirname(step.link), { recursive: true })
    fs.symlinkSync(step.to, step.link, 'dir')
    step.state = 'created'
  }
  return plan
}

// Lists the links that --remove would delete; writes nothing.
export function planRemoveInstanceSkills({ root, home } = {}) {
  const resolvedHome = skillHome(home)
  const source = path.join(root, 'instance', 'skills')
  const links = []
  for (const target of skillTargets(resolvedHome)) {
    if (!fs.existsSync(target)) continue
    for (const name of fs.readdirSync(target).sort()) {
      const link = path.join(target, name)
      if (linkPointsInto(link, source)) links.push(link)
    }
  }
  return { home: resolvedHome, source, links }
}

export function removeInstanceSkills(options = {}) {
  const plan = planRemoveInstanceSkills(options)
  const removed = []
  for (const link of plan.links) {
    if (!linkPointsInto(link, plan.source)) continue
    fs.unlinkSync(link)
    removed.push(link)
  }
  return { home: plan.home, source: plan.source, removed }
}

const USAGE = 'Usage: node system/instance-skills.mjs [--apply] | --remove [--apply]\nPreview is the default and writes nothing; --apply performs the previewed links or removals.'

function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const known = new Set(['--apply', '--remove', '--help'])
  const unknown = argv.filter((arg) => !known.has(arg))
  if (unknown.length > 0) {
    console.error(USAGE)
    return 2
  }
  if (argv.includes('--help')) {
    console.log(USAGE)
    return 0
  }
  const apply = argv.includes('--apply')
  try {
    if (argv.includes('--remove')) {
      if (!apply) {
        const plan = planRemoveInstanceSkills({ root })
        for (const link of plan.links) console.log(`would remove: ${link}`)
        console.log(plan.links.length === 0
          ? 'No links into instance/skills were found.'
          : 'Preview only: nothing was removed. Removing links from the home folder is an outside action. Ask the user to approve this exact list, then run again with --remove --apply.')
        return 0
      }
      const result = removeInstanceSkills({ root })
      for (const link of result.removed) console.log(`removed: ${link}`)
      console.log(result.removed.length === 0 ? 'No links into instance/skills were found.' : `Removed ${result.removed.length} link(s).`)
      return 0
    }
    const plan = apply ? applyInstanceSkills({ root }) : planInstanceSkills({ root })
    if (plan.steps.length === 0) {
      console.log('No private skills found in instance/skills/.')
      return 0
    }
    for (const step of plan.steps) console.log(`${step.state}: ${step.link} -> ${step.to}`)
    if (!apply) {
      console.log('Preview only: nothing was written. Linking writes into the home folder, which is an outside action. Ask the user to approve this exact list, then run again with --apply.')
    }
    return 0
  } catch (error) {
    console.error(`Refused: ${error.message}`)
    return 1
  }
}

// Compare real paths so a symlinked folder (macOS /var -> /private/var) still
// runs main instead of importing silently.
function invokedDirectly() {
  if (!process.argv[1]) return false
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  process.exitCode = main(process.argv.slice(2))
}
