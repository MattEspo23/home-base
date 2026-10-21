// Generated from src/sample.ts by system/dashboard/build.mjs. Do not edit.
// Fictional sample data for the Life domains previews. Every value comes from
// a seeded generator, so the same seed always gives the same numbers, and
// every object is marked fictional with a caption that says "sample".
// Nothing here describes a real person.

export const SAMPLE_SEED = 20261015
export const SAMPLE_NOTICE = 'Fictional sample data. Made up by a generator, not anyone’s real numbers.'

// mulberry32: a tiny deterministic generator. Returns values in [0, 1).
export function mulberry32(seed        )               {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function between(random              , low        , high        , step = 1)         {
  return Math.round((low + random() * (high - low)) / step) * step
}

export function formatNumber(value        )         {
  const [whole, fraction] = String(value).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction ? `${grouped}.${fraction}` : grouped
}

export const formatMoney = (value        )         => `$${formatNumber(Math.round(value))}`














const CATEGORY_RANGES                                  = [
  ['Groceries', 480, 760],
  ['Home and utilities', 380, 620],
  ['Hobbies', 160, 360],
  ['Getting around', 140, 300],
  ['Eating out', 80, 220],
  ['Fun', 60, 180],
]
const TREND_LABELS = ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']

export function sampleFinance(seed         = SAMPLE_SEED)                {
  const random = mulberry32(seed)
  const categories = CATEGORY_RANGES
    .map(([name, low, high]) => ({ name, amount: between(random, low, high, 5) }))
    .sort((a, b) => b.amount - a.amount)
  const total = categories.reduce((sum, item) => sum + item.amount, 0)
  const trend = TREND_LABELS.map((name, index) => ({
    name,
    amount: index === TREND_LABELS.length - 1 ? total : between(random, total * 0.82, total * 1.14, 5),
  }))
  const target = 3000
  const saved = between(random, 900, 2400, 10)
  return {
    fictional: true,
    seed,
    total,
    totalCaption: 'Sample spending this month',
    categories,
    categoriesCaption: 'Biggest sample categories',
    trend,
    trendCaption: 'Sample spending, six made-up months',
    goal: { name: 'Trip fund', saved, target, caption: `Sample goal: ${formatMoney(saved)} of ${formatMoney(target)}` },
  }
}

// A plain, made-up habit tracker for Sam, a fictional person: four everyday
// habits and round numbers. No named program and nothing about sleep, steps,
// weight, food, medical, or wearable data.
export const SAMPLE_PERSON = 'Sam'
export const SAMPLE_HABITS = ['Walk', 'Stretch', 'Read', 'Cook at home']





















const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function sampleHabits(seed         = SAMPLE_SEED)               {
  const random = mulberry32(seed ^ 0x5eed)
  const total = SAMPLE_HABITS.length
  const doneToday = between(random, 1, total, 1)
  // Leave a seeded choice of habits not done yet today.
  const order = SAMPLE_HABITS.map((_, index) => ({ index, rank: random() })).sort((a, b) => a.rank - b.rank)
  const notDone = new Set(order.slice(0, total - doneToday).map((item) => item.index))
  const today = SAMPLE_HABITS.map((name, index) => ({ name, done: !notDone.has(index) }))
  const week = DAY_LABELS.map((name, index) => ({ name, done: index === DAY_LABELS.length - 1 ? doneToday : between(random, 1, total, 1) }))
  const walkTarget = 30
  const walkMinutes = today[0].done ? walkTarget : between(random, 0, 20, 10)
  const fullDays = week.filter((day) => day.done === total).length
  return {
    fictional: true,
    seed,
    person: SAMPLE_PERSON,
    today,
    todayListCaption: `Sample habits for ${SAMPLE_PERSON}, a made-up person`,
    doneToday,
    habits: total,
    todayCaption: 'Sample habits done today',
    week,
    weekCaption: 'Sample habits done, one made-up week',
    walkMinutes,
    walkTarget,
    walkCaption: `Sample walk: ${walkMinutes} of ${walkTarget} minutes`,
    fullDays,
    fullDaysCaption: `Sample days with every habit done: ${fullDays} of 7`,
  }
}
