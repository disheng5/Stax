const assert = require('assert')
const {
  sortTransactions,
  mergeTransactions
} = require('../miniprogram/utils/transaction-format.js')

// === 排序契约 ===
// 按 timestamp 降序、同 timestamp 按 operationSequence 降序、缺 operationSequence 按 _id 降序
const txs = [
  { _id: 'tx_a', timestamp: new Date('2025-07-01T22:00:00Z'), operationSequence: 1 },
  { _id: 'tx_b', timestamp: new Date('2025-07-01T22:00:00Z'), operationSequence: 3 },
  { _id: 'tx_c', timestamp: new Date('2025-07-01T22:00:00Z'), operationSequence: 2 },
  { _id: 'tx_d', timestamp: new Date('2025-07-01T22:01:00Z'), operationSequence: 4 },
  { _id: 'tx_e', timestamp: new Date('2025-07-01T21:59:00Z') }, // 旧记录无 operationSequence
  { _id: 'tx_f', timestamp: new Date('2025-07-01T21:59:00Z') }
]

const sorted = sortTransactions(txs)
assert.deepStrictEqual(
  sorted.map(t => t._id),
  ['tx_d', 'tx_b', 'tx_c', 'tx_a', 'tx_f', 'tx_e']
)
// tx_d 最新；同时间 tx_b>tx_c>tx_a（operationSequence 降序）；旧记录 tx_f>tx_e（_id 降序）

// === 合并去重契约 ===
const existing = [
  { _id: 'tx_1', timestamp: new Date('2025-07-01T22:00:00Z'), operationSequence: 1 },
  { _id: 'tx_2', timestamp: new Date('2025-07-01T22:01:00Z'), operationSequence: 2 }
]
const incoming = [
  { _id: 'tx_2', timestamp: new Date('2025-07-01T22:01:00Z'), operationSequence: 2, revoked: true },
  { _id: 'tx_3', timestamp: new Date('2025-07-01T22:02:00Z'), operationSequence: 3 }
]
const merged = mergeTransactions(existing, incoming)
assert.strictEqual(merged.length, 3)
assert.strictEqual(merged.find(t => t._id === 'tx_2').revoked, true, '相同 _id 应取 incoming 版本')
assert.strictEqual(merged[0]._id, 'tx_3', '合并后仍按稳定倒序')

console.log('transaction-order.test.js passed')
