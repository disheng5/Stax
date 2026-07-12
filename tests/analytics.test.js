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
    { openid: 'me', nickname: 'Me', finalProfit: profit, profit, buyInCount: opts.rebuys || 1 },
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

console.log('analytics.test.js passed')
