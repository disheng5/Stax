const assert = require('assert')
const { createMockDb } = require('../miniprogram/utils/db-mock.js')
const loadHandler = require('./helpers/cloud-handler.js')
const {
  expandRevocations,
  transactionHandState,
  transactionSentenceText
} = require('../miniprogram/utils/transaction-format.js')

async function revokedSettlement() {
  const game = {
    _id: 'g',
    hostOpenid: 'host',
    status: 'ongoing',
    buyIn: 500,
    totalPot: 2000,
    players: [
      {
        openid: 'host',
        nickname: 'Host',
        totalBuyIn: 500,
        buyInCount: 1,
        finalStack: null,
        profit: 0
      },
      {
        openid: 'p',
        nickname: 'Player',
        totalBuyIn: 1500,
        buyInCount: 3,
        currentStack: 1800,
        finalStack: 1800,
        profit: 300
      }
    ]
  }
  const tx = {
    _id: 't',
    gameId: 'g',
    type: 'rebuy',
    playerOpenid: 'p',
    operatorOpenid: 'p',
    amount: 500,
    beforeHands: 2,
    afterHands: 3,
    meta: { hands: 1 },
    timestamp: new Date(0)
  }
  const db = createMockDb({ games: [game], transactions: [tx] })
  const result = await loadHandler(
    'recordTransaction',
    db
  )({ gameId: 'g', type: 'revoke', txId: 't', operationId: 'revoke_test' })
  assert(result.ok)
  const p = db._raw.games[0].players[1]
  assert.strictEqual(p.totalBuyIn, 1000)
  assert.strictEqual(p.currentStack, 1800)
  assert.strictEqual(p.profit, 800)
  const events = expandRevocations(db._raw.transactions)
  assert.strictEqual(events.length, 2)
  assert.strictEqual(events[0].operatorOpenid, 'host')
  assert.strictEqual(events[1].timestamp.getTime(), 0)
  const state = transactionHandState(events, db._raw.games[0].players, 500)
  assert.strictEqual(state.t.accHands, 3)
  assert.strictEqual(
    transactionSentenceText(events[0], 1, 2, id => (id === 'p' ? 'Player' : 'Host')),
    'Host撤销Player的1手补买，共2手'
  )
  const ended = await loadHandler(
    'settleGame',
    db
  )({ gameId: 'g', mode: 'checkout', finalStacks: { host: 0 }, operationId: 'settle_test' })
  assert(ended.ok)
  assert.strictEqual(db._raw.games[0].players[1].finalProfit, 800)
}

async function analyticsFailure() {
  const games = Array.from({ length: 101 }, (_, i) => ({
    _id: `g${i}`,
    status: 'ended',
    hiddenForOpenids: i === 100 ? ['host'] : [],
    endedAt: new Date(i),
    players: [{ openid: 'host', finalProfit: 10, buyInCount: 1 }]
  }))
  const db = createMockDb({ games })
  const collection = db.collection
  let fail = true
  db.collection = name => {
    const q = collection(name)
    const get = q.get.bind(q)
    q.get = async () => {
      if (name === 'games' && q._skip === 100 && fail) {
        fail = false
        throw new Error('page unavailable')
      }
      return get()
    }
    return q
  }
  const call = loadHandler('getMyAnalytics', db)
  await assert.rejects(call(), /page unavailable/)
  const result = await call()
  assert.strictEqual(result.stats.totalGames, 100)
  assert.strictEqual(result.stats.totalProfit, 1000)
}

async function seasonIsolationAndConcurrency() {
  const season = {
    _id: 's',
    circleId: 'c',
    status: 'ongoing',
    seasonNo: 2,
    startAt: new Date('2020-01-01'),
    endAt: new Date('2100-01-01'),
    exclusionScopeVersion: 1,
    exclusionRevision: 0
  }
  const game = {
    _id: 'g',
    name: 'Game',
    status: 'ended',
    bigBlind: 5,
    startedAt: new Date('2026-01-01T10:00:00Z'),
    endedAt: new Date('2026-01-01T14:00:00Z'),
    players: ['host', 'a', 'b', 'c'].map(openid => ({ openid, nickname: openid, finalProfit: 100 }))
  }
  const db = createMockDb({
    games: [game],
    seasons: [season, { ...season, _id: 'foreign', circleId: 'foreign' }],
    circles: [
      {
        _id: 'c',
        status: 'active',
        memberOpenids: ['host'],
        ownerOpenid: 'host',
        currentSeasonId: 's'
      }
    ]
  })
  const denied = await loadHandler('getSeasonView', db)({ circleId: 'c', seasonId: 'foreign' })
  assert.strictEqual(denied.ok, false)
  const collection = db.collection
  let release,
    reached,
    block = true
  const ready = new Promise(resolve => {
    reached = resolve
  })
  const gate = new Promise(resolve => {
    release = resolve
  })
  db.collection = name => {
    const q = collection(name)
    const get = q.get.bind(q)
    q.get = async () => {
      if (name === 'users' && block) {
        block = false
        reached()
        await gate
      }
      return get()
    }
    return q
  }
  const calc = loadHandler('calcSeasonScore', db)
  const old = calc({ circleId: 'c' })
  await ready
  db._raw.games[0].players[0].finalProfit = 200
  assert((await calc({ circleId: 'c' })).ok)
  release()
  await old
  assert.strictEqual(db._raw.seasons[0].rankings[0].rawProfit, 200)
}

;(async () => {
  await revokedSettlement()
  await analyticsFailure()
  await seasonIsolationAndConcurrency()
  console.log('trust-regressions.test.js passed')
})().catch(err => {
  console.error(err)
  process.exitCode = 1
})
