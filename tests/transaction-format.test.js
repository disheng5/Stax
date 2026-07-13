const assert = require('assert')
const {
  buildTransactionSentence,
  transactionSentenceText,
  transactionHandState
} = require('../miniprogram/utils/transaction-format.js')

const resolveName = openid => {
  const map = { p1: 'L美美', p2: 'eter', p3: '万木春', p4: '虫子' }
  return map[openid] || ''
}

// === 入场：自己 ===
assert.strictEqual(
  transactionSentenceText(
    {
      type: 'buyIn',
      playerOpenid: 'p1',
      amount: 1500,
      meta: { hands: 3 },
      beforeHands: 0,
      afterHands: 3
    },
    3,
    3,
    resolveName
  ),
  'L美美入场，买入3手'
)

// === 自己补买 ===
assert.strictEqual(
  transactionSentenceText(
    {
      type: 'rebuy',
      playerOpenid: 'p1',
      amount: 1500,
      meta: { hands: 3 },
      beforeHands: 8,
      afterHands: 11
    },
    3,
    11,
    resolveName
  ),
  'L美美补买3手，共11手'
)

// === 代补买 ===
assert.strictEqual(
  transactionSentenceText(
    {
      type: 'rebuy',
      playerOpenid: 'p1',
      operatorOpenid: 'p2',
      amount: 1500,
      meta: { hands: 3 },
      beforeHands: 8,
      afterHands: 11
    },
    3,
    11,
    resolveName
  ),
  'eter帮L美美补买3手，共11手'
)

// === 自己结算 ===
assert.strictEqual(
  transactionSentenceText({ type: 'settle', playerOpenid: 'p1', amount: 1750 }, 0, 11, resolveName),
  'L美美结算，共买入11手，剩余1750积分'
)

// === 代结算 ===
assert.strictEqual(
  transactionSentenceText(
    { type: 'settle', playerOpenid: 'p3', operatorOpenid: 'p2', amount: 1485 },
    0,
    4,
    resolveName
  ),
  'eter帮万木春结算，共买入4手，剩余1485积分'
)

// === 修改结算积分 ===
assert.strictEqual(
  transactionSentenceText(
    {
      type: 'settle',
      playerOpenid: 'p1',
      operatorOpenid: 'p2',
      amount: 1750,
      beforeValue: 1800,
      afterValue: 1750
    },
    0,
    11,
    resolveName
  ),
  'eter将L美美的结算积分从1800调整为1750'
)

// === 撤销 ===
assert.strictEqual(
  transactionSentenceText(
    {
      type: 'rebuy',
      playerOpenid: 'p1',
      operatorOpenid: 'p2',
      amount: 1500,
      meta: { hands: 3 },
      revoked: true,
      beforeHands: 11,
      afterHands: 8
    },
    3,
    8,
    resolveName
  ),
  'eter撤销L美美的3手补买，共8手'
)

// === 移出 ===
assert.strictEqual(
  transactionSentenceText(
    { type: 'eliminate', playerOpenid: 'p1', operatorOpenid: 'p2', amount: -1500, meta: {} },
    0,
    0,
    resolveName
  ),
  'eter将L美美移出记录，扣除1500积分'
)

// === 旧记录（无 before/after）补买无"共X手" ===
assert.strictEqual(
  transactionSentenceText(
    { type: 'rebuy', playerOpenid: 'p1', amount: 1500, meta: { hands: 3 } },
    3,
    11,
    resolveName
  ),
  'L美美补买3手'
)

// === buildTransactionSentence 返回 parts 的 role ===
const parts = buildTransactionSentence(
  {
    type: 'rebuy',
    playerOpenid: 'p1',
    operatorOpenid: 'p2',
    amount: 1500,
    meta: { hands: 3 },
    beforeHands: 8,
    afterHands: 11
  },
  3,
  11,
  resolveName
)
assert.strictEqual(parts[0].role, 'operator')
assert.strictEqual(parts[2].role, 'player')
assert.strictEqual(parts[4].role, 'result')

// === handState 累计口径保持不变 ===
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
