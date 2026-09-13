const assert = require('assert')
const { observe } = require('../miniprogram/utils/live-view.js')
const handlers = []
let closed = 0,
  network,
  refreshes = 0
global.wx = {
  onNetworkStatusChange(fn) {
    network = fn
  },
  offNetworkStatusChange(fn) {
    assert.strictEqual(fn, network)
  }
}
const query = () => ({
  watch(h) {
    handlers.push(h)
    return {
      close() {
        closed++
      }
    }
  }
})
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
;(async () => {
  const stop = observe(
    [query],
    async () => {
      refreshes++
    },
    { fallbackMs: 100 }
  )
  handlers[0].onChange({ docs: [{ revision: 1 }] })
  await wait(100)
  assert.strictEqual(refreshes, 0, 'initial subscription does not duplicate page fetch')
  handlers[0].onChange({ docs: [{ revision: 2 }] })
  handlers[0].onChange({ docs: [{ revision: 3 }] })
  await wait(100)
  assert.strictEqual(refreshes, 1, 'coalesce a burst without intermediate repaint')
  handlers[0].onError(new Error('socket'))
  await wait(200)
  assert(refreshes >= 2, 'failed watch has a read fallback')
  network({ isConnected: true })
  handlers[1].onChange({ docs: [{ revision: 3 }] })
  const before = refreshes
  handlers[0].onChange({ docs: [{ revision: 100 }] })
  stop()
  await wait(200)
  assert.strictEqual(refreshes, before, 'hidden page and stale watch callbacks cannot refresh')
  assert(closed >= 2)
  console.log('live-view.test.js passed')
})().catch(err => {
  console.error(err)
  process.exitCode = 1
})
