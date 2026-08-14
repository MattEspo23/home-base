#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const exampleDir = path.dirname(fileURLToPath(import.meta.url))

function ageHours(asOf, receivedAt) {
  return Math.max(0, (new Date(asOf).getTime() - new Date(receivedAt).getTime()) / 3_600_000)
}

function upcomingEvent(calendar, contactLabel, asOf) {
  const now = new Date(asOf).getTime()
  return calendar
    .filter((event) => event.contactLabel === contactLabel)
    .filter((event) => new Date(event.start).getTime() >= now)
    .sort((a, b) => new Date(a.start) - new Date(b.start))[0]
}

function priorityFor(message, event, asOf) {
  let score = message.urgency === 'high' ? 4 : 2
  if (ageHours(asOf, message.receivedAt) >= 24) score += 2
  if (event) score += 1
  return score
}

function draftFor(message, style) {
  if (style === 'concise') {
    return `Quick follow-up on “${message.subject}”: ${message.nextStep}.`
  }
  return `Following up on “${message.subject}.” The next useful step is to ${message.nextStep.toLowerCase()}. Review this draft before any message is sent.`
}

export function buildBrief(data, preferences = {}) {
  const summaryStyle = preferences.summaryStyle === 'concise' ? 'concise' : 'detailed'
  const queue = data.inbox
    .filter((message) => message.status === 'needs_reply')
    .map((message) => {
      const event = upcomingEvent(data.calendar, message.contactLabel, data.asOf)
      return {
        id: message.id,
        contactLabel: message.contactLabel,
        subject: message.subject,
        receivedAt: message.receivedAt,
        priority: priorityFor(message, event, data.asOf),
        nextStep: message.nextStep,
        upcomingEvent: event
          ? {
              title: event.title,
              start: event.start,
            }
          : null,
        draft: draftFor(message, summaryStyle),
        sendStatus: 'blocked_pending_user_approval',
      }
    })
    .sort((a, b) => b.priority - a.priority || a.receivedAt.localeCompare(b.receivedAt))

  return {
    generatedAt: data.asOf,
    sourceMode: 'synthetic_read_only',
    summaryStyle,
    sendEnabled: false,
    queueCount: queue.length,
    queue,
  }
}

export function renderMarkdown(brief) {
  const lines = [
    '# Daily Follow-Up Brief',
    '',
    `- Generated: ${brief.generatedAt}`,
    `- Source mode: ${brief.sourceMode}`,
    `- Queue: ${brief.queueCount}`,
    `- Sends enabled: ${brief.sendEnabled ? 'yes' : 'no'}`,
    '',
  ]

  for (const item of brief.queue) {
    lines.push(
      `## ${item.contactLabel} — ${item.subject}`,
      '',
      `- Priority: ${item.priority}`,
      `- Next step: ${item.nextStep}`,
      `- Upcoming event: ${item.upcomingEvent ? `${item.upcomingEvent.title} at ${item.upcomingEvent.start}` : 'none'}`,
      `- Send status: ${item.sendStatus}`,
      '',
      '### Draft-only suggestion',
      '',
      item.draft,
      '',
    )
  }

  return `${lines.join('\n').trim()}\n`
}

export function renderDataScript(brief) {
  return `window.HOME_BASE_FOLLOW_UP_BRIEF = ${JSON.stringify(brief, null, 2)};\n`
}

function parseArgs(argv) {
  const result = {
    input: path.join(exampleDir, 'sample-data.json'),
    preferences: path.join(exampleDir, 'preferences.json'),
    output: null,
    summaryStyle: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') result.input = path.resolve(argv[index + 1])
    if (argv[index] === '--preferences') {
      result.preferences = path.resolve(argv[index + 1])
    }
    if (argv[index] === '--output') result.output = path.resolve(argv[index + 1])
    if (argv[index] === '--style') result.summaryStyle = argv[index + 1]
  }
  return result
}

export function loadPreferences(preferencesPath) {
  return JSON.parse(fs.readFileSync(preferencesPath, 'utf8'))
}

export function writeBuild(outputDir, brief) {
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(path.join(outputDir, 'brief.json'), `${JSON.stringify(brief, null, 2)}\n`)
  fs.writeFileSync(path.join(outputDir, 'BRIEF.md'), renderMarkdown(brief))
  fs.writeFileSync(path.join(outputDir, 'demo-data.js'), renderDataScript(brief))
}

export function buildFromFiles(options) {
  const data = JSON.parse(fs.readFileSync(options.input, 'utf8'))
  const savedPreferences = loadPreferences(options.preferences)
  const preferences = options.summaryStyle
    ? { ...savedPreferences, summaryStyle: options.summaryStyle }
    : savedPreferences
  const brief = buildBrief(data, preferences)
  if (options.output) writeBuild(options.output, brief)
  return brief
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2))
  if (!options.output) {
    console.error(
      'Usage: node build.mjs --output <directory> [--input <json>] [--preferences <json>] [--style detailed|concise]',
    )
    process.exitCode = 1
  } else {
    const brief = buildFromFiles(options)
    console.log(`Built Daily Follow-Up Brief with ${brief.queueCount} draft-only item(s).`)
  }
}
