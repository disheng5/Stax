const assert = require('assert')
const {
  createPendingQueue,
  isReplayable,
  REPLAYABLE_TYPES
} = require('../miniprogram/utils/pending-ops.js')

;(async () => {
  // === isReplayable ===
  assert.strictEqual(isReplayable('rebuy'), true)
  assert.strictEqual(isReplayable('addOn'), true)
  assert.strictEqual(isReplayable('checkout'), true)
  assert.strictEqual(isReplayable('expense'), true)
  assert.strictEqual(isReplayable('eliminate'), false, '破坏性操作不可重放')
  assert.strictEqual(isReplayable('excludeGame'), false)
  assert.strictEqual(isReplayable('dissolveCircle'), false)

  // === 队列去重 ===
  let store = []
  const queue = createPendingQueue({
    load: () => store,
    save: data => {
      store = data
    }
  })

  const op1 = { operationId: 'op_001', type: 'rebuy', gameId: 'g1', amount: 100 }
  assert.strictEqual(queue.enqueue(op1), true)
  assert.strictEqual(queue.enqueue(op1), false, '相同 operationId 不得重复入队')
  assert.strictEqual(queue.list().length, 1)

  const op2 = { operationId: 'op_002', type: 'checkout', gameId: 'g1', finalStacks: { me: 200 } }
  queue.enqueue(op2)
  assert.strictEqual(queue.list().length, 2)
  assert.strictEqual(store.length, 2, '应调用 save 持久化')

  // === flush 发送 + 成功后移除 ===
  let sendCount = 0
  const flushResult = await queue.flush(async op => {
    sendCount++
    return { ok: true }
  })
  assert.strictEqual(sendCount, 2)
  assert.strictEqual(flushResult.sent, 2)
  assert.strictEqual(flushResult.remaining, 0)
  assert.strictEqual(queue.list().length, 0)

  // === flush 部分失败保留队列 ===
  queue.enqueue({ operationId: 'op_003', type: 'rebuy', gameId: 'g2', amount: 50 })
  queue.enqueue({ operationId: 'op_004', type: 'rebuy', gameId: 'g2', amount: 60 })
  const flushPartial = await queue.flush(async op => {
    if (op.operationId === 'op_003') return { ok: true }
    return { ok: false, error: 'CONFLICT_RETRY' }
  })
  assert.strictEqual(flushPartial.sent, 1)
  assert.strictEqual(flushPartial.remaining, 1)
  assert.strictEqual(queue.list()[0].operationId, 'op_004')

  // === remove 手动移除 ===
  queue.remove('op_004')
  assert.strictEqual(queue.list().length, 0)

  console.log('pending-ops.test.js passed')
})()
