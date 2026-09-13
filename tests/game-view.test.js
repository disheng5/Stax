const assert = require('assert')
const fs = require('fs')
const vm = require('vm')
const path = require('path')
const { createRequire } = require('module')
const { createMockDb } = require('../miniprogram/utils/db-mock.js')
const game = { _id: 'g', status: 'ongoing', hostOpenid: 'host', stateRevision: 1, txRevision: 1,
  totalPot: 500, buyIn: 500, players: [{ openid: 'host', nickname: 'Host', buyInCount: 1, totalBuyIn: 500, finalStack: null }] }
const db = createMockDb({ games: [game], transactions: Array.from({ length: 45 }, (_, i) => ({
  _id: `t${i}`, gameId: 'g', type: 'rebuy', playerOpenid: 'host', amount: 500, timestamp: new Date(i), meta: { hands: 1 }
})) })
const storage = {}
global.wx = { cloud: { database: () => db }, getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value }, removeStorageSync: key => { delete storage[key] } }
const views = require('../miniprogram/utils/game-view.js')
const file = path.resolve(__dirname, '../miniprogram/pages/game-detail/game-detail.js')
let definition
vm.runInNewContext(fs.readFileSync(file, 'utf8'), { require: createRequire(file), Page: page => { definition = page },
  getApp: () => ({ globalData: { openid: 'host' } }), wx: global.wx, console, setTimeout, clearTimeout, setInterval, clearInterval })

;(async () => {
  const a = views.fetchCompleteGame('g')
  assert.strictEqual(views.fetchCompleteGame('g'), a, 'in-flight reads must be shared')
  const snapshot = await a
  assert.strictEqual(snapshot.transactions.length, 45)
  let writes = 0
  const page = { ...definition, data: { ...structuredClone(definition.data), gameId: 'g' },
    _resolveAvatars() {}, _resolveDisplayAvatars() {},
    setData(patch) { writes++; for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.'); const last = parts.pop(); let parent = this.data
      for (const part of parts) parent = parent[part] ||= {}
      parent[last] = value
    } } }
  page._applyCompleteGame(snapshot)
  assert.strictEqual(writes, 1, 'room and complete ledger share one render')
  assert.strictEqual(page.data.recentTx.length, 45)
  page._applyCompleteGame(snapshot)
  assert.strictEqual(writes, 1, 'same snapshot must not redraw')
  const collection = db.collection
  let fail = true
  db._raw.games[0].txRevision = 2
  db._raw.games[0].stateRevision = 2
  db.collection = name => {
    const query = collection(name), get = query.get.bind(query)
    query.get = async () => {
      if (name === 'transactions' && query._skip === 20 && fail) throw new Error('page unavailable')
      return get()
    }
    return query
  }
  await assert.rejects(views.fetchCompleteGame('g'), /page unavailable/)
  assert.strictEqual(views.getCompleteGame('g').game.txRevision, 1)
  assert.strictEqual(views.getCompleteGame('g').transactions.length, 45)
  fail = false
  const recovered = await views.fetchCompleteGame('g')
  assert.strictEqual(recovered.game.txRevision, 2)
  assert.strictEqual(recovered.transactions.length, 45)
  views.clearCompleteGames()
  console.log('game-view.test.js passed')
})().catch(err => { console.error(err); process.exitCode = 1 })
