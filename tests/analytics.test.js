const assert = require('assert')
const {
  computeAnalytics,
  buildTrendNote,
  ANALYTICS_VERSION,
  MIN_NOTE_SAMPLE
} = require('../miniprogram/utils/analytics.js')

const makeGame = (profit, opts = {}) => ({
  _id: 'g_' + Math.random().toString(36).slice(2),
  status: 'ended',
  bigBlind: opts.bigBlind || 10,
  scoreRatio: opts.scoreRatio || 1,
  endedAt: opts.endedAt || new Date().toISOString(),
  startedAt: opts.startedAt || new Date(Date.now() - 3600000).toISOString(),
  players: [
    { openid: 'me', nickname: 'Me', finalProfit: profit, profit, buyInCount: opts.rebuys || 1, seat: opts.seat },
    { openid: 'opp1', nickname: 'Alice', finalProfit: -profit, profit: -profit, buyInCount: 1 },
    ...(opts.extraPlayers || [])
  ]
})

// === computeAnalytics 必须可重算 ===
const games = [
  makeGame(100, { rebuys: 2 }),
  makeGame(-50, { rebuys: 1 }),
  makeGame(200, { rebuys: 3 }),
  makeGame(-30),
  makeGame(80)
]
const result = computeAnalytics(games, 'me')
const excluded = [makeGame(999), makeGame(999), makeGame(999)]
excluded[0].deletedAt = new Date()
excluded[1].hiddenForOpenids = ['me']
excluded[2].players[0].eliminatedAt = new Date()
assert.strictEqual(computeAnalytics([...games, ...excluded], 'me').stats.totalGames, 5)
assert.strictEqual(computeAnalytics([...games, ...excluded], 'me').stats.totalProfit, 300)
assert.strictEqual(result.stats.totalGames, 5)
assert.strictEqual(result.stats.totalProfit, 300)
assert.strictEqual(result.stats.biggestWin, 200)
assert.strictEqual(result.stats.biggestLoss, -50)
assert.strictEqual(result.stats.wins, 3)
assert.strictEqual(result.stats.winRate, 60)
assert.strictEqual(result.meta.algorithmVersion, ANALYTICS_VERSION)
assert.strictEqual(result.meta.sourceGameCount, 5)

// dimensions.opponents 不得含对手盈亏
const oppRow = result.dimensions.opponents.find(r => r.key === 'Alice')
assert.ok(oppRow, 'Alice 应出现在对手维度')
assert.strictEqual(oppRow.profit, undefined, '不得暴露对手盈亏')
assert.strictEqual(oppRow.profitBB, undefined)
assert.ok(typeof oppRow.games === 'number')

const positioned = [
  makeGame(100, { seat: 10, scoreRatio: 2 }),
  makeGame(-30, { seat: 2 }),
  makeGame(80, { seat: '2' }),
  makeGame(20, { seat: 1 }),
  makeGame(-10),
  makeGame(0, { seat: 0 })
]
const positionRows = computeAnalytics(positioned, 'me').dimensions.position
assert.deepStrictEqual(positionRows, [
  { key: '1 号', games: 1, profit: 20, wins: 1 },
  { key: '2 号', games: 2, profit: 50, wins: 1 },
  { key: '10 号', games: 1, profit: 50, wins: 1 },
  { key: '未记录', games: 2, profit: -10, wins: 0 }
])
assert.strictEqual(positionRows.reduce((sum, row) => sum + row.games, 0), positioned.length)
assert.deepStrictEqual(
  computeAnalytics([...positioned, ...excluded], 'me'),
  require('../cloudfunctions/getMyAnalytics/analytics.js').computeAnalytics([...positioned, ...excluded], 'me')
)
const { positionKey } = require('../miniprogram/utils/stats.js')
for (const seat of [undefined, null, '', 'bad', false, true, 0, -1, 2.5, Infinity]) {
  assert.strictEqual(positionKey({ seat }), '未记录')
}

// === buildTrendNote 样本不足 ===
const noteInsufficient = buildTrendNote({
  sampleCount: 2,
  recentSum: 0,
  prevSum: 0,
  best: 0,
  worst: 0
})
assert.strictEqual(noteInsufficient.enough, false)
assert.strictEqual(noteInsufficient.observation, undefined)

// === buildTrendNote 样本充足 ===
const noteSufficient = buildTrendNote({
  sampleCount: 10,
  recentSum: 300,
  prevSum: -100,
  best: 200,
  worst: -80
})
assert.strictEqual(noteSufficient.enough, true)
assert.ok(typeof noteSufficient.observation === 'string' && noteSufficient.observation.length > 0)
assert.ok(typeof noteSufficient.perspective === 'string' && noteSufficient.perspective.length > 0)
assert.ok(typeof noteSufficient.action === 'string' && noteSufficient.action.length > 0)

// 措辞不触发守卫
const { hasForbiddenWording } = require('../miniprogram/utils/wording.js')
;[noteSufficient.observation, noteSufficient.perspective, noteSufficient.action].forEach(line => {
  assert.strictEqual(hasForbiddenWording(line), false, `札记不得包含禁用措辞：${line}`)
})

for (const sampleCount of [5, 7, 9, 10, 100]) {
  const signals = { sampleCount, recentSum: -50, prevSum: -50, best: 9000, worst: -10000 }
  const note = buildTrendNote(signals)
  assert(!/稳定|漏洞|还太少|9000|10000/.test(JSON.stringify(note)))
  if (sampleCount < 10) assert(!/前 5 场|前一段/.test(note.observation))
  assert.deepStrictEqual(note, require('../cloudfunctions/getMyAnalytics/analytics.js').buildTrendNote(signals))
}
const { errorMessage } = require('../miniprogram/utils/errors.js')
assert.strictEqual(errorMessage('UNEXPECTED_INTERNAL_CODE'), '操作失败，请稍后重试')
assert(!errorMessage('SEASON_NOT_FOUND').includes('SEASON_NOT_FOUND'))
console.log('analytics.test.js passed')
