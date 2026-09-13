const assert = require('assert')
const { createMockDb } = require('../miniprogram/utils/db-mock.js')
const loadHandler = require('./helpers/cloud-handler.js')

function fixture(shared = true) {
  return createMockDb({
    games: [
      {
        _id: 'g',
        hostOpenid: 'host',
        status: 'ongoing',
        playerOpsShared: shared,
        buyIn: 500,
        totalPot: 1500,
        settledCount: 1,
        checkedOutCount: 1,
        players: [
          { openid: 'host', nickname: 'Host', totalBuyIn: 500, buyInCount: 1, currentStack: 500 },
          {
            openid: 'member',
            nickname: 'Member',
            totalBuyIn: 500,
            buyInCount: 1,
            currentStack: 500
          },
          {
            openid: 'friend',
            nickname: 'Friend',
            totalBuyIn: 500,
            buyInCount: 1,
            currentStack: 700,
            finalStack: 700,
            profit: 200,
            finalProfit: 200,
            checkedOutAt: new Date(0)
          }
        ]
      }
    ],
    transactions: []
  })
}

async function run() {
  for (const type of ['rebuy', 'addOn']) {
    for (const shared of [true, undefined]) {
      const db = fixture(shared)
      if (shared === undefined) delete db._raw.games[0].playerOpsShared
      const call = loadHandler('recordTransaction', db, { openid: 'member' })
      const request = {
        gameId: 'g',
        type,
        playerOpenid: 'friend',
        amount: 1500,
        hands: 3,
        operationId: 'proxy_buy_001'
      }
      const first = await call(request)
      assert(first.ok, `member proxy ${type}: ${JSON.stringify(first)}`)
      const replay = await call(request)
      assert(replay.idempotent)
      const game = db._raw.games[0]
      const friend = game.players[2]
      assert.strictEqual(friend.buyInCount, 4)
      assert.strictEqual(friend.totalBuyIn, 2000)
      assert.strictEqual(friend.currentStack, 2200)
      assert.strictEqual(friend.finalStack, null)
      assert.strictEqual(friend.finalProfit, null)
      assert.strictEqual(friend.checkedOutAt, null)
      assert.strictEqual(game.totalPot, 3000)
      assert.strictEqual(game.checkedOutCount, 0)
      assert.strictEqual(game.settledCount, 0)
      assert.strictEqual(game.players[1].totalBuyIn, 500)
      assert.strictEqual(db._raw.transactions.length, 1)
      const tx = db._raw.transactions[0]
      assert.strictEqual(tx.operatorOpenid, 'member')
      assert.strictEqual(tx.operatorNicknameSnapshot, 'Member')
      assert.strictEqual(tx.playerOpenid, 'friend')
      assert.strictEqual(tx.beforeHands, 1)
      assert.strictEqual(tx.afterHands, 4)
      assert.strictEqual(tx.byHost, false)
      assert.strictEqual(
        (await call({ gameId: 'g', type: 'revoke', txId: tx._id })).error,
        'NOT_HOST'
      )
      assert.strictEqual(
        (await call({ gameId: 'g', type: 'eliminate', playerOpenid: 'friend' })).error,
        'NOT_HOST'
      )
    }
  }
  for (const target of ['member', 'friend']) {
    const db = fixture(false)
    const request = { gameId: 'g', type: 'rebuy', playerOpenid: target, amount: 500 }
    const denied = await loadHandler('recordTransaction', db, { openid: 'member' })(request)
    assert.strictEqual(denied.error, 'NOT_HOST')
    assert.strictEqual(db._raw.transactions.length, 0)
    assert((await loadHandler('recordTransaction', db)(request)).ok)
  }
  for (const scenario of ['outsider', 'missingTarget', 'removedActor', 'removedTarget', 'ended']) {
    const db = fixture()
    if (scenario === 'removedActor') db._raw.games[0].players[1].eliminatedAt = new Date()
    if (scenario === 'removedTarget') db._raw.games[0].players[2].eliminatedAt = new Date()
    if (scenario === 'ended') db._raw.games[0].status = 'ended'
    const result = await loadHandler('recordTransaction', db, {
      openid: scenario === 'outsider' ? 'outsider' : 'member'
    })({
      gameId: 'g',
      type: 'rebuy',
      playerOpenid: scenario === 'missingTarget' ? 'missing' : 'friend',
      amount: 500
    })
    assert.strictEqual(result.ok, false, scenario)
    assert.strictEqual(db._raw.games[0].totalPot, 1500)
    assert.strictEqual(db._raw.transactions.length, 0)
  }
  console.log('proxy-buy: permissions, operator audit, legacy sharing and replay passed')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
