const assert = require('assert')
const {
  transactionDetailParts,
  transactionDetailText,
  transactionHandState,
  transactionTypeLabel,
  operatorSuffixPart
} = require('../miniprogram/utils/transaction-format.js')

// === 买入：+变化量 · 前→后手（Section 二 权威格式）===
const rebuy = {
  type: 'rebuy',
  amount: 1500,
  meta: { hands: 3 },
  beforeHands: 2,
  afterHands: 5
}
assert.strictEqual(transactionDetailText(rebuy, 3, 5), '+3手 · 2→5手')
// 最终手数(after)用最重字重 strong；变化量 +3手 用 delta 字重
assert.deepStrictEqual(
  transactionDetailParts(rebuy, 3, 5)
    .filter(p => p.weight === 'strong')
    .map(p => p.text),
  ['5']
)
assert.deepStrictEqual(
  transactionDetailParts(rebuy, 3, 5)
    .filter(p => p.weight === 'delta')
    .map(p => p.text),
  ['+3手']
)

// === 买入旧记录缺前后值：降级用累计口径 ===
const legacyRebuy = { type: 'rebuy', amount: 1500, meta: { hands: 3 } }
assert.strictEqual(transactionDetailText(legacyRebuy, 3, 11), '+3手 · 8→11手')

// === 撤销买入：-变化量 · 前→后手 ===
const revoked = {
  type: 'rebuy',
  amount: 500,
  meta: { hands: 1 },
  revoked: true,
  beforeHands: 6,
  afterHands: 5
}
assert.strictEqual(transactionDetailText(revoked, 1, 5), '-1手 · 6→5手')

// === 入场：最终手数 ===
assert.strictEqual(
  transactionDetailText({ type: 'buyIn', amount: 1000, beforeHands: 0, afterHands: 2 }, 2, 2),
  '2手'
)

// === 结算（无前后值）：最终积分 ===
assert.strictEqual(transactionDetailText({ type: 'settle', amount: 1875 }, 0, 0), '1875')

// === 修正（有前后值）：前→后 ===
assert.strictEqual(
  transactionDetailText({ type: 'settle', amount: 550, beforeValue: 580, afterValue: 550 }, 0, 0),
  '580→550'
)

// === 移出 ===
assert.strictEqual(
  transactionDetailText({ type: 'eliminate', amount: -1500, meta: {} }, 0, 0),
  '移出房间，扣除 1500 积分'
)

// === 类型标签推断 ===
assert.strictEqual(transactionTypeLabel({ type: 'buyIn' }), '入场')
assert.strictEqual(transactionTypeLabel({ type: 'rebuy' }), '买入')
assert.strictEqual(transactionTypeLabel({ type: 'rebuy', revoked: true }), '撤销买入')
assert.strictEqual(transactionTypeLabel({ type: 'settle' }), '结算')
assert.strictEqual(
  transactionTypeLabel({ type: 'settle', beforeValue: 580, afterValue: 550 }),
  '修正'
)
assert.strictEqual(transactionTypeLabel({ type: 'eliminate' }), '移出')

// === 操作人后缀：本人操作不显示，代操作显示 ===
assert.strictEqual(
  operatorSuffixPart({ type: 'rebuy', playerOpenid: 'p1', operatorOpenid: 'p1' }, () => 'X'),
  null
)
const proxyBuy = operatorSuffixPart(
  { type: 'rebuy', playerOpenid: 'p1', operatorOpenid: 'p2', operatorNicknameSnapshot: '茅人及' },
  null
)
assert.ok(proxyBuy && proxyBuy.text.includes('茅人及') && proxyBuy.text.includes('代记'))
const proxyRevoke = operatorSuffixPart(
  { type: 'rebuy', revoked: true, playerOpenid: 'p1', operatorOpenid: 'p2' },
  () => 'eter'
)
assert.ok(proxyRevoke && proxyRevoke.text.includes('eter') && proxyRevoke.text.includes('撤销'))

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
