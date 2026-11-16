const assert = require('assert')
const fs = require('fs')
const path = require('path')
const loadHandler = require('./helpers/cloud-handler.js')
const { createMockDb } = require('../miniprogram/utils/db-mock.js')
const { createDerivedSync } = require('../cloudfunctions/settleGame/derived-stats.js')
const game = {
  _id: 'g',
  status: 'ongoing',
  hostOpenid: 'host',
  startedAt: new Date(Date.now() - 3600000),
  buyIn: 500,
  totalPot: 500,
  players: [
    {
      openid: 'host',
      nickname: 'Host',
      totalBuyIn: 500,
      buyInCount: 1,
      finalStack: null,
      profit: 0
    }
  ]
}
;(async () => {
  const db = createMockDb({
    games: [game],
    users: [
      {
        _id: 'u',
        _openid: 'host',
        nickname: 'Host',
        stats: { totalGames: 0, totalProfit: 0, wins: 0, biggestWin: 0, biggestLoss: 0 }
      }
    ],
    circles: [{ _id: 'c', status: 'active', memberOpenids: ['host'] }],
    transactions: []
  })
  const collection = db.collection
  let failUsers = true,
    failSeason = true
  db.collection = name => {
    const q = collection(name),
      get = q.get.bind(q)
    q.get = async () => {
      if (name === 'users' && !q._docId && failUsers) throw new Error('profile query offline')
      return get()
    }
    return q
  }
  const callFunction = async () => ({ result: { ok: !failSeason } })
  const settle = loadHandler('settleGame', db, { callFunction })
  const event = { gameId: 'g', finalStacks: { host: 700 }, operationId: 'settle_outbox' }
  const first = await settle(event)
  assert(first.ok && first.derivedPending)
  assert.strictEqual(db._raw.users.length, 1, 'query failure must not create another user')
  assert.strictEqual(db._raw.games[0].derivedPending, true)
  assert.strictEqual(db._raw.transactions.length, 1)
  failUsers = false
  const retry = await settle(event)
  assert(retry.ok && retry.idempotent && retry.derivedPending)
  assert.strictEqual(db._raw.users[0].stats.totalGames, 1)
  assert.strictEqual(db._raw.users[0].stats.totalProfit, 200)
  failSeason = false
  const recovered = await settle(event)
  assert(recovered.ok && !recovered.derivedPending)
  assert.strictEqual(db._raw.games[0].derivedPending, false)
  assert.strictEqual(db._raw.transactions.length, 1, 'retry never appends settlement again')
  assert.strictEqual(db._raw.users[0].stats.totalProfit, 200, 'retry never increments twice')
  const edited = await settle({
    gameId: 'g',
    finalStacks: { host: 400 },
    operationId: 'edit_outbox',
    deferDerived: true
  })
  assert(edited.ok && edited.derivedPending)
  assert.strictEqual(
    db._raw.users[0].stats.totalProfit,
    200,
    'deferred response does not wait for aggregation'
  )
  const sync = await settle({ gameId: 'g', syncDerived: true })
  assert(sync.ok && !sync.derivedPending)
  assert.strictEqual(db._raw.users[0].stats.totalProfit, -100)
  assert.strictEqual(db._raw.users[0].stats.biggestWin, 0, 'corrected maxima must decrease too')
  assert.strictEqual(db._raw.users[0].stats.biggestLoss, -100)
  assert.strictEqual(db._raw.users[0].stats.wins, 0)
  assert.strictEqual(
    (
      await loadHandler('settleGame', db, { openid: 'stranger' })({
        gameId: 'g',
        syncDerived: true
      })
    ).ok,
    false
  )
  await settle({
    gameId: 'g',
    finalStacks: { host: 500 },
    operationId: 'timer_outbox',
    deferDerived: true
  })
  const timer = await loadHandler('settleGame', db, { openid: '', callFunction })({ Type: 'Timer' })
  assert.strictEqual(timer.processed, 1)
  assert.strictEqual(db._raw.users[0].stats.totalProfit, 0)
  const worker = createDerivedSync(db, async () => ({ ok: true }))
  assert.strictEqual((await worker.drain()).processed, 0)

  // 超过结算修正窗口后，费用仍可补录；费用不重开房间，也不改变已确认的积分。
  const endedGame = db._raw.games[0]
  endedGame.endedAt = new Date(Date.now() - 3 * 60 * 60 * 1000 - 1)
  const endedAt = +new Date(endedGame.endedAt)
  const finalStack = endedGame.players[0].finalStack
  const finalProfit = endedGame.players[0].finalProfit
  const expenseAfterWindow = await settle({
    gameId: 'g',
    mode: 'expense',
    extraCost: 75,
    expenseMode: 'all',
    operationId: 'expense_after_window_0001',
    deferDerived: true
  })
  assert(expenseAfterWindow.ok)
  assert.strictEqual(expenseAfterWindow.game.status, 'ended')
  assert.strictEqual(+new Date(expenseAfterWindow.game.endedAt), endedAt)
  assert.strictEqual(expenseAfterWindow.game.players[0].finalStack, finalStack)
  assert.strictEqual(expenseAfterWindow.game.players[0].finalProfit, finalProfit)
  assert.strictEqual(expenseAfterWindow.game.extraCost, 75)
  assert.strictEqual(expenseAfterWindow.game.players[0].share, 75)
  assert.strictEqual(db._raw.transactions.at(-1).type, 'expense')
  const lateSettlement = await settle({
    gameId: 'g',
    finalStacks: { host: 500 },
    operationId: 'late_settlement_0001',
    deferDerived: true
  })
  assert.strictEqual(lateSettlement.ok, false)
  assert.strictEqual(lateSettlement.error, 'ALREADY_ENDED')

  // A slow rebuild must not replace a newer settlement's statistics.
  const raceDb = createMockDb({
    games: [
      {
        ...game,
        status: 'ended',
        derivedPending: true,
        derivedVersion: 1,
        players: [{ ...game.players[0], finalProfit: 200 }]
      }
    ],
    users: [{ _id: 'u', _openid: 'host', nickname: 'Host' }],
    circles: []
  })
  const raceCollection = raceDb.collection
  let releaseOld,
    markRead,
    delayFirst = true
  const oldRead = new Promise(resolve => {
    markRead = resolve
  })
  const paused = new Promise(resolve => {
    releaseOld = resolve
  })
  raceDb.collection = name => {
    const query = raceCollection(name),
      get = query.get.bind(query)
    query.get = async () => {
      const result = await get()
      if (name === 'games' && query._where.status === 'ended' && delayFirst) {
        delayFirst = false
        markRead()
        await paused
      }
      return result
    }
    return query
  }
  const raceWorker = createDerivedSync(raceDb, async () => ({ ok: true }))
  const oldSync = raceWorker.sync('g')
  await oldRead
  raceDb._raw.games[0].players[0].finalProfit = -100
  raceDb._raw.games[0].derivedVersion = 2
  assert.strictEqual((await raceWorker.sync('g')).pending, false)
  releaseOld()
  assert.strictEqual((await oldSync).pending, true)
  assert.strictEqual(raceDb._raw.users[0].stats.totalProfit, -100)
  assert.strictEqual(raceDb._raw.games[0].derivedPending, false)
  assert.strictEqual(
    fs.readFileSync(
      path.resolve(__dirname, '../cloudfunctions/settleGame/derived-stats.js'),
      'utf8'
    ),
    fs.readFileSync(path.resolve(__dirname, '../miniprogram/utils/derived-stats.js'), 'utf8')
  )
  console.log('derived-stats.test.js passed')
})().catch(err => {
  console.error(err)
  process.exitCode = 1
})
