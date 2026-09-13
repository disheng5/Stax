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

const { buildLedgerEvents, transactionSentenceText } = require('../miniprogram/utils/transaction-format.js')
const endedGame = { _id: 'g', status: 'ended', endedAt: '2026-09-13T12:00:00Z' }
const closing = { _id: 'settled', type: 'settle', timestamp: endedGame.endedAt, operationSequence: 8 }
const corrected = { _id: 'corrected', type: 'settle', timestamp: '2026-09-13T12:20:00Z', operationSequence: 9, beforeValue: 2, afterValue: 3 }
const expense = { _id: 'expense', type: 'expense', timestamp: '2026-09-13T12:30:00Z', operationSequence: 10 }
const source = [closing, corrected, expense]
const ledger = buildLedgerEvents(source, endedGame)
assert.deepStrictEqual(ledger.map(t => t._id), ['expense', 'corrected', 'g:record-ended', 'settled'])
assert.strictEqual(transactionSentenceText(ledger[2]), '本次积分记录已结束')
assert.strictEqual(source.length, 3, 'synthetic events never mutate the cached source')
assert.deepStrictEqual(buildLedgerEvents(ledger, endedGame), ledger, 'do not duplicate existing end events')
assert.strictEqual(buildLedgerEvents(source, { ...endedGame, status: 'ongoing' }).length, 3)
assert.strictEqual(buildLedgerEvents(source, { ...endedGame, endedAt: undefined }).length, 3)
const sameTimeExpense = { ...expense, timestamp: endedGame.endedAt }
assert.deepStrictEqual(buildLedgerEvents([sameTimeExpense, closing], endedGame).map(t => t._id), ['expense', 'g:record-ended', 'settled'])
