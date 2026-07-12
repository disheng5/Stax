const REPLAYABLE_TYPES = ['rebuy', 'addOn', 'checkout', 'expense']

function isReplayable(type) {
  return REPLAYABLE_TYPES.includes(type)
}

function createPendingQueue(adapter) {
  function _load() {
    return adapter.load() || []
  }
  function _save(items) {
    adapter.save(items)
  }

  return {
    enqueue(op) {
      const items = _load()
      if (items.some(item => item.operationId === op.operationId)) return false
      items.push(op)
      _save(items)
      return true
    },
    list() {
      return _load()
    },
    remove(operationId) {
      const items = _load().filter(item => item.operationId !== operationId)
      _save(items)
    },
    async flush(sender) {
      let sent = 0
      const remaining = []
      const items = _load()
      for (const op of items) {
        try {
          const result = await sender(op)
          if (result && result.ok) {
            sent++
          } else {
            remaining.push(op)
          }
        } catch (_) {
          remaining.push(op)
        }
      }
      _save(remaining)
      return { sent, remaining: remaining.length }
    }
  }
}

module.exports = { createPendingQueue, isReplayable, REPLAYABLE_TYPES }
