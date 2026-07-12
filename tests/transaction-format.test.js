const assert = require('assert')
const {
  transactionDetailParts,
  transactionDetailText,
  transactionHandState
} = require('../miniprogram/utils/transaction-format.js')

const rebuy = { type: 'rebuy', amount: 1500, meta: { hands: 3 } }
assert.strictEqual(transactionDetailText(rebuy, 3, 11), '当前 8 手，买入 3 手，共 11 手')
assert.deepStrictEqual(
  transactionDetailParts(rebuy, 3, 11)
    .filter(part => part.emphasis)
    .map(part => part.text),
  ['8', '3', '11']
)
assert.strictEqual(
  transactionDetailText({ type: 'buyIn', amount: 1000 }, 2, 2),
  '入场 2 手，共 2 手'
)
assert.strictEqual(
  transactionDetailText({ type: 'settle', amount: 1875 }, 0, 0),
  '剩余积分 1875'
)
assert.strictEqual(
  transactionDetailText({ type: 'eliminate', amount: -1500, meta: {} }, 0, 0),
  '移出房间，扣除 1500 积分'
)

const handState = transactionHandState(
  [
    { _id: 'new', type: 'rebuy', playerOpenid: 'p1', amount: 300, meta: { hands: 3 } },
    { _id: 'old', type: 'rebuy', playerOpenid: 'p1', amount: 200, meta: { hands: 2 } },
    {
      _id: 'revoked',
      type: 'rebuy',
      playerOpenid: 'p1',
      amount: 100,
      meta: { hands: 1 },
      revoked: true
    }
  ],
  [{ openid: 'p1', buyInCount: 11, totalBuyIn: 1100 }],
  100
)
assert.deepStrictEqual(handState.new, { hands: 3, accHands: 11 })
assert.deepStrictEqual(handState.old, { hands: 2, accHands: 8 })
assert.deepStrictEqual(handState.revoked, { hands: 1, accHands: 6 })

console.log('transaction-format tests passed')
