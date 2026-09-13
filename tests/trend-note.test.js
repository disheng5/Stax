const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { createRequire } = require('module')
const {
  buildTrendNote,
  buildTrendSignals,
  TIP_COUNT
} = require('../miniprogram/utils/trend-note.js')
const cloudNotes = require('../cloudfunctions/getMyAnalytics/trend-note.js')
const { createNoteVisit } = require('../miniprogram/utils/trend-note-visit.js')
const { computeAnalytics } = require('../miniprogram/utils/analytics.js')
const { hasForbiddenWording } = require('../miniprogram/utils/wording.js')
const { createMockDb } = require('../miniprogram/utils/db-mock.js')
const loadHandler = require('./helpers/cloud-handler.js')

const makeGames = scores =>
  scores.map((score, i) => ({
    _id: `g${i}`,
    status: 'ended',
    startedAt: new Date(2026, 8, i + 1, 18),
    endedAt: new Date(2026, 8, i + 1, 22),
    scoreRatio: 2,
    players: [{ openid: 'me', seat: (i % 3) + 1, finalProfit: score * 2, buyInCount: 1 }]
  }))
const games = makeGames([9000, -10000, 1, 2, 3, 40, -10, 20, 0, -30])
const signals = buildTrendSignals(games, 'me')
assert.strictEqual(signals.recentSum, 20)
assert.strictEqual(signals.recentWins, 2)
assert.strictEqual(signals.recentLosses, 2)
assert.strictEqual(signals.recentBest, 40)
assert.strictEqual(signals.recentWorst, -30)
assert.strictEqual(signals.lossStreak, 1)
assert.deepStrictEqual(buildTrendSignals(games.slice().reverse(), 'me'), signals)
const excluded = makeGames([999, 999, 999, 999])
excluded[0].hiddenForOpenids = ['me']
excluded[1].deletedAt = new Date()
excluded[2].players[0].eliminatedAt = new Date()
excluded[3].status = 'ongoing'
assert.deepStrictEqual(buildTrendSignals([...games, ...excluded], 'me'), signals)

const actions = new Set(),
  perspectives = new Set(),
  observations = new Set()
for (let variation = 0; variation < TIP_COUNT; variation++) {
  const note = buildTrendNote(signals, { variation })
  assert.deepStrictEqual(note, cloudNotes.buildTrendNote(signals, { variation }))
  actions.add(note.action)
  perspectives.add(note.perspective)
  observations.add(note.observation)
  assert(!/9000|10000|还.*太少|水平|漏洞/.test(JSON.stringify(note)))
  for (const line of [note.observation, note.perspective, note.action]) {
    assert(!hasForbiddenWording(line), line)
    assert(line.length <= 90, 'each paragraph stays concise')
  }
}
assert.strictEqual(TIP_COUNT, 30)
assert.strictEqual(actions.size, TIP_COUNT, 'a full cycle does not repeat tips')
assert.strictEqual(perspectives.size, 4)
assert.strictEqual(observations.size, 3)
const streak = buildTrendSignals(makeGames([100, 100, -1, -2, -3]), 'me')
assert.strictEqual(streak.lossStreak, 3)
assert(buildTrendNote(streak).observation.includes('连续 3 场'))
assert(buildTrendNote(streak).perspective.includes('不必急着证明'))
assert.strictEqual(buildTrendSignals(makeGames([-1, -2, 0]), 'me').lossStreak, 0)
for (const count of [5, 6, 9]) {
  const partial = buildTrendSignals(makeGames(Array(count).fill(1)), 'me')
  for (let variation = 0; variation < 3; variation++) {
    assert(!buildTrendNote(partial, { variation }).observation.includes('前 5 场'))
  }
}
for (const variation of [-1, NaN, Infinity, 0.5, 'invalid']) {
  assert.deepStrictEqual(buildTrendNote(signals, { variation }), buildTrendNote(signals))
}
assert.strictEqual(
  fs.readFileSync(path.resolve(__dirname, '../miniprogram/utils/trend-note.js'), 'utf8'),
  fs.readFileSync(path.resolve(__dirname, '../cloudfunctions/getMyAnalytics/trend-note.js'), 'utf8')
)

const storage = new Map()
let storageWrites = 0,
  networkCalls = 0
global.wx = {
  getStorageSync: key => storage.get(key),
  setStorageSync(key, value) {
    storage.set(key, value)
    storageWrites++
  },
  cloud: {
    callFunction() {
      networkCalls++
      throw new Error('unexpected network call')
    }
  }
}
const unread = createNoteVisit('unread')
assert.strictEqual(createNoteVisit('unread').variation, unread.variation)
assert.strictEqual(storageWrites, 0, 'preparing a note must not consume it')
unread.markRead()
unread.markRead()
assert.strictEqual(storageWrites, 1)
assert.strictEqual(createNoteVisit('unread').variation, 1)
assert.strictEqual(createNoteVisit('other-account').variation, 0)

const file = path.resolve(__dirname, '../miniprogram/pages/history/history.js')
let definition
vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
  require: createRequire(file),
  Page: page => {
    definition = page
  },
  getApp: () => ({ globalData: { openid: 'me' } }),
  wx: global.wx,
  console
})
function makePage() {
  return {
    ...definition,
    data: structuredClone(definition.data),
    writes: 0,
    setData(patch, callback) {
      this.writes++
      Object.assign(this.data, patch)
      callback?.()
    }
  }
}
const first = makePage()
first._applyGames('me', games)
assert.strictEqual(first.writes, 1, 'all sections still share one initial render')
const displayed = Array.from(first.data.aiSummary)
const beforeRead = storageWrites
first._applyGames('me', games)
assert.strictEqual(first.writes, 1, 'unchanged source must not redraw')
assert.strictEqual(storageWrites, beforeRead)
first.onToggleAi()
assert.strictEqual(storageWrites, beforeRead + 1)
first._applyGames('me', games)
assert.strictEqual(first.writes, 2, 'background synchronization must not change the note')
first.onToggleAi()
first.onToggleAi()
assert.strictEqual(storageWrites, beforeRead + 1, 'folding and opening is still the same visit')
assert.deepStrictEqual(Array.from(first.data.aiSummary), displayed)
const second = makePage()
second._applyGames('me', games)
assert.notStrictEqual(second.data.aiSummary[2], displayed[2], 'a later visit gets another tip')
second.onDimChange({ currentTarget: { dataset: { k: 'position' } } })
assert.deepStrictEqual(
  JSON.parse(
    JSON.stringify(
      second.data.dimData.map(({ key, games, profit, wins }) => ({ key, games, profit, wins }))
    )
  ),
  computeAnalytics(games, 'me').dimensions.position
)
assert.strictEqual(networkCalls, 0)

const savedWrite = wx.setStorageSync
wx.setStorageSync = () => {
  throw new Error('storage unavailable')
}
const offline = createNoteVisit('storage-failure')
offline.markRead()
assert.strictEqual(createNoteVisit('storage-failure').variation, offline.variation + 1)
wx.setStorageSync = savedWrite

;(async () => {
  const handler = loadHandler('getMyAnalytics', createMockDb({ games }), { openid: 'me' })
  for (const noteVariation of [undefined, 1, 'legacy-value']) {
    const response = await handler({ noteVariation })
    assert(response.ok)
    assert.deepStrictEqual(response.note, buildTrendNote(signals, { variation: noteVariation }))
    assert.deepStrictEqual(
      response.dimensions.position,
      computeAnalytics(games, 'me').dimensions.position
    )
  }
  console.log('trend-note.test.js passed')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
