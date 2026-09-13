const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { createRequire } = require('module')
const { createMockDb } = require('../miniprogram/utils/db-mock.js')
const loadHandler = require('./helpers/cloud-handler.js')

const fixture = () =>
  createMockDb({
    games: [],
    transactions: [],
    opReceipts: [],
    users: ['host', 'friend'].map(_openid => ({
      _id: _openid,
      _openid,
      nickname: _openid,
      avatar: ''
    }))
  })
const request = { name: '娱乐积分记录', buyIn: 500, operationId: 'create_test_001' }

async function backend() {
  const db = fixture()
  const call = loadHandler('createGame', db)
  const [first, replay] = await Promise.all([call(request), call(request)])
  assert(first.ok && replay.ok)
  assert.strictEqual(first.gameId, replay.gameId)
  assert(replay.idempotent)
  assert.strictEqual(db._raw.games.length, 1)
  assert.strictEqual(db._raw.transactions.length, 1)
  assert.strictEqual(first.transactions.length, 1)
  assert.strictEqual(first.transactions[0]._id, db._raw.transactions[0]._id)
  assert.strictEqual(first.transactions[0].operatorOpenid, 'host')
  assert.strictEqual(first.game.txSeq, first.transactions[0].operationSequence)
  assert.strictEqual(first.game.totalPot, first.transactions[0].amount)
  assert.strictEqual(replay.game, undefined, 'never replay an obsolete initial snapshot')
  const other = await loadHandler('createGame', db, { openid: 'friend' })(request)
  assert.notStrictEqual(other.gameId, first.gameId, 'operation ids are scoped to the creator')
  const legacy = await call({ name: '旧客户端记录' })
  assert(legacy.ok && legacy.game && legacy.inviteCode)
  assert.strictEqual(db._raw.games.length, 3)

  for (const method of ['get', 'set']) {
    const failing = fixture()
    const collection = failing.collection
    failing.collection = name => {
      const ref = collection(name)
      if (name === 'opReceipts')
        ref[method] = async () => {
          throw new Error('receipt offline')
        }
      return ref
    }
    const result = await loadHandler('createGame', failing)(request)
    assert.strictEqual(result.ok, false)
    assert.strictEqual(failing._raw.games.length, 0, `${method} failure must roll back`)
    assert.strictEqual(failing._raw.transactions.length, 0)
  }
}

async function frontend() {
  const db = fixture()
  const storage = { user_profile: { openid: 'host', nickname: 'Host' }, last_openid: 'host' }
  let refreshes = 0,
    loseResponse = false
  const calls = [],
    redirects = []
  const app = {
    globalData: { openid: 'host', openidReady: Promise.resolve() },
    refreshCurrentUser: async () => {
      refreshes++
    }
  }
  const call = loadHandler('createGame', db)
  global.wx = {
    getStorageSync: key => storage[key],
    setStorageSync: (key, value) => {
      storage[key] = value
    },
    removeStorageSync: key => {
      delete storage[key]
    },
    showToast() {},
    redirectTo: value => redirects.push(value),
    cloud: {
      database: () => db,
      callFunction: async ({ name, data }) => {
        assert.strictEqual(name, 'createGame')
        calls.push(data)
        const result = await call(data)
        if (loseResponse) {
          loseResponse = false
          throw new Error('response lost')
        }
        return { result }
      }
    }
  }
  function page() {
    const file = path.resolve(__dirname, '../miniprogram/pages/game-create/game-create.js')
    let definition
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      require: createRequire(file),
      getApp: () => app,
      wx: global.wx,
      console,
      Page: value => {
        definition = value
      }
    })
    const p = {
      ...definition,
      data: structuredClone(definition.data),
      setData(patch) {
        Object.assign(this.data, patch)
      }
    }
    p.onLoad()
    p.data.name = '自定义娱乐记录'
    return p
  }
  const p = page()
  loseResponse = true
  const attempt = p.onSubmit()
  await p.onSubmit()
  await attempt
  assert.strictEqual(calls.length, 1, 'lock before any identity/network await')
  assert.strictEqual(refreshes, 0, 'known users do not wait for redundant profile reads')
  assert.strictEqual(p.data.name, '自定义娱乐记录')
  assert.strictEqual(
    storage.stax_create_defaults_host,
    undefined,
    'do not save defaults on uncertain failure'
  )
  await p.onSubmit()
  assert.strictEqual(calls[1].operationId, calls[0].operationId)
  assert.strictEqual(db._raw.games.length, 1)
  assert(redirects[0].url.endsWith(db._raw.games[0]._id))
  await p.onSubmit()
  assert.strictEqual(calls.length, 2, 'navigation retry must not create another record')

  const fresh = page()
  fresh.data.buyIn = 1000
  fresh.data.smallBlind = 5
  fresh.data.bigBlind = 10
  await fresh.onSubmit()
  const { getCompleteGame, clearCompleteGames } = require('../miniprogram/utils/game-view.js')
  const gameId = db._raw.games[1]._id
  const complete = getCompleteGame(gameId)
  assert(
    complete && complete.transactions.length === 1,
    'complete response is cached before navigation'
  )
  assert.strictEqual(complete.game.totalPot, 1000)
  const next = page()
  assert.strictEqual(next.data.buyIn, 1000)
  assert.strictEqual(next.data.bigBlind, 10)

  delete storage.user_profile
  let resolveSheet
  next.selectComponent = () => ({
    request: options => {
      assert.strictEqual(options.showHands, false)
      return new Promise(resolve => {
        resolveSheet = resolve
      })
    }
  })
  const pending = next.onSubmit()
  await new Promise(resolve => setImmediate(resolve))
  resolveSheet(null)
  await pending
  assert.strictEqual(next.data.submitting, false)
  assert.strictEqual(next.data.buyIn, 1000)
  assert.strictEqual(db._raw.games.length, 2, 'cancelling profile does not create a record')
  clearCompleteGames()
}

backend()
  .then(frontend)
  .then(() =>
    console.log('create-flow: complete snapshot, retry, old clients and inline profile passed')
  )
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
