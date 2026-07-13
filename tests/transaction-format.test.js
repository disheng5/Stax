const assert = require('assert')
const {
  buildTransactionSentence,
  transactionSentenceText,
  normalizeTransactionKind,
  transactionHandState
} = require('../miniprogram/utils/transaction-format.js')

const resolveName = openid => {
  const map = { p1: 'L美美', p2: 'eter', p3: '万木春', p4: '虫子' }
  return map[openid] || ''
}

// === 入场：自己（短句） ===
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
  'L美美入场3手'
)

// === 自己补买（短句 + 共X手） ===
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

// === 自己结算（短句） ===
assert.strictEqual(
  transactionSentenceText({ type: 'settle', playerOpenid: 'p1', amount: 1750 }, 0, 11, resolveName),
  'L美美结算，共11手，剩1750积分'
)

// === 代结算 ===
assert.strictEqual(
  transactionSentenceText(
    { type: 'settle', playerOpenid: 'p3', operatorOpenid: 'p2', amount: 1485 },
    0,
    4,
    resolveName
  ),
  'eter帮万木春结算，共4手，剩1485积分'
)

// === 修改结算积分：只突出修改后的值 ===
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
  'eter将L美美结算从1800改为1750'
)
// 修改结算：修改前值弱化(dim)，修改后值突出(result)
const modifyParts = buildTransactionSentence(
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
)
assert.strictEqual(modifyParts.find(p => p.text === '1800').role, 'dim')
assert.strictEqual(modifyParts.find(p => p.text === '1750').role, 'result')

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
  'eter撤销L美美补买3手，共8手'
)

// === 移出 ===
assert.strictEqual(
  transactionSentenceText(
    { type: 'eliminate', playerOpenid: 'p1', operatorOpenid: 'p2', amount: -1500, meta: {} },
    0,
    0,
    resolveName
  ),
  'eter移出L美美，扣1500积分'
)

// ===== 第九节兼容测试（7条）=====

// (1) settle → rebuy → settle：第二次结算不再显示"记录"
const settleAgain = transactionSentenceText(
  { type: 'settle', playerOpenid: 'p1', amount: 1600, meta: { mode: 'finalize' } },
  0,
  12,
  resolveName
)
assert.ok(!/^记录$/.test(settleAgain) && settleAgain.includes('结算'), settleAgain)

// (2) 旧 settlePartial 无 beforeValue/afterValue 仍正常显示结算
assert.strictEqual(
  transactionSentenceText(
    { type: 'settlePartial', playerOpenid: 'p1', amount: 1750 },
    0,
    11,
    resolveName
  ),
  'L美美结算，共11手，剩1750积分'
)

// (3) 历史 checkout / finalize 按结算呈现（未知 type，按载荷/mode 推断）
assert.strictEqual(
  normalizeTransactionKind({ type: 'checkout', playerOpenid: 'p1', amount: 1500 }),
  'settle'
)
assert.strictEqual(
  normalizeTransactionKind({ type: 'record', meta: { mode: 'checkout' }, playerOpenid: 'p1' }),
  'settle'
)
assert.strictEqual(
  normalizeTransactionKind({ type: 'record', meta: { mode: 'finalize' }, playerOpenid: 'p1' }),
  'settle'
)
assert.strictEqual(
  normalizeTransactionKind({
    type: 'record',
    beforeValue: 1800,
    afterValue: 1750,
    playerOpenid: 'p1'
  }),
  'settle'
)
const historyCheckout = transactionSentenceText(
  { type: 'checkout', playerOpenid: 'p1', amount: 1500 },
  0,
  10,
  resolveName
)
assert.ok(historyCheckout.includes('结算'), historyCheckout)

// (4) 旧补买无 afterHands，用 accHands 回退显示"共N手"
assert.strictEqual(
  transactionSentenceText(
    { type: 'rebuy', playerOpenid: 'p1', amount: 1500, meta: { hands: 3 } },
    3,
    11,
    resolveName
  ),
  'L美美补买3手，共11手'
)

// (5) 修改结算只突出修改后值（见上 modifyParts 断言）

// (6) 所有文案都不等于孤立的"记录"
const samples = [
  { type: 'buyIn', playerOpenid: 'p1', amount: 1500, meta: { hands: 3 } },
  { type: 'rebuy', playerOpenid: 'p1', amount: 1500, meta: { hands: 2 } },
  { type: 'settle', playerOpenid: 'p1', amount: 1750 },
  { type: 'checkout', playerOpenid: 'p1', amount: 1500 },
  { type: 'unknownfuturetype', playerOpenid: 'p1', amount: 500 },
  { type: 'unknownfuturetype', playerOpenid: 'p1' }
]
samples.forEach(tx => {
  const text = transactionSentenceText(tx, 1, 3, resolveName)
  assert.notStrictEqual(text, '记录', `孤立"记录"文案泄漏: ${JSON.stringify(tx)}`)
  assert.ok(text.length > 0)
})

// (7) 兜底：未知类型带数值→记录N积分；无数值→有一条历史流水（均非孤立"记录"）
assert.strictEqual(
  transactionSentenceText(
    { type: 'weirdtype', playerOpenid: 'p1', amount: 500 },
    0,
    0,
    resolveName
  ),
  'L美美记录500积分'
)
assert.strictEqual(
  transactionSentenceText({ type: 'weirdtype', playerOpenid: 'p1' }, 0, 0, resolveName),
  'L美美有一条历史流水'
)

// === buildTransactionSentence 返回 parts 的 role 体系 ===
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
assert.strictEqual(parts[1].role, 'player')
assert.strictEqual(parts[2].role, 'action')
assert.strictEqual(parts[parts.length - 1].role, 'result')

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
