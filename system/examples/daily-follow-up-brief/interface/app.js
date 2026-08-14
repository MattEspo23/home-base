const brief = window.HOME_BASE_FOLLOW_UP_BRIEF
const queue = document.querySelector('#queue')

document.querySelector('#queue-count').textContent = String(brief.queueCount)
document.querySelector('#generated-at').textContent =
  `Generated ${new Date(brief.generatedAt).toLocaleString()}`

for (const item of brief.queue) {
  const card = document.createElement('article')
  card.className = 'follow-up-card'

  const event = item.upcomingEvent
    ? `${item.upcomingEvent.title} · ${new Date(item.upcomingEvent.start).toLocaleString()}`
    : 'No upcoming event'

  const summary = document.createElement('div')
  const kicker = document.createElement('span')
  kicker.className = 'card-kicker'
  kicker.textContent = `Priority ${item.priority} · ${item.contactLabel}`
  const title = document.createElement('h3')
  title.textContent = item.subject
  const nextStep = document.createElement('p')
  nextStep.className = 'next-step'
  nextStep.textContent = item.nextStep
  const eventLine = document.createElement('p')
  eventLine.className = 'event'
  eventLine.textContent = event
  summary.append(kicker, title, nextStep, eventLine)

  const draft = document.createElement('div')
  draft.className = 'draft'
  const draftLabel = document.createElement('p')
  draftLabel.className = 'draft-label'
  draftLabel.textContent = 'Draft-only suggestion'
  const draftText = document.createElement('p')
  draftText.textContent = item.draft
  draft.append(draftLabel, draftText)

  card.append(summary, draft)
  queue.append(card)
}

if (brief.queue.length === 0) {
  const empty = document.createElement('p')
  empty.className = 'subtitle'
  empty.textContent = 'Nothing needs review right now.'
  queue.append(empty)
}
