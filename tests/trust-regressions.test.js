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

;(async () => {
  await revokedSettlement()
  console.log('trust-regressions.test.js passed')
})().catch(err => {
  console.error(err)
  process.exitCode = 1
})
