const REPLAYABLE_TYPES = ['rebuy', 'addOn', 'checkout', 'expense']

function isReplayable(type) {
  return REPLAYABLE_TYPES.includes(type)
}

function createPendingQueue(adapter) {
  let flushing = null
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
    flush(sender) {
      if (flushing) return flushing
      flushing = (async () => {
        let sent = 0
        const items = _load().slice()
        for (const op of items) {
          try {
            const result = await sender(op)
            if (result && result.ok) {
              sent++
              // Remove only the acknowledged operation from the latest queue.
              _save(_load().filter(item => item.operationId !== op.operationId))
            }
          } catch (_) {}
        }
        return { sent, remaining: _load().length }
      })().finally(() => {
        flushing = null
      })
      return flushing
    }
  }
}

module.exports = { createPendingQueue, isReplayable, REPLAYABLE_TYPES }
