const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { createRequire } = require('module')
const { createMockDb } = require('../miniprogram/utils/db-mock.js')
const loadHandler = require('./helpers/cloud-handler.js')
const { safeShare } = require('../miniprogram/utils/share.js')
const cover = fs.readFileSync(path.resolve(__dirname, '../miniprogram' + safeShare().imageUrl))
assert.strictEqual(cover.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'share cover is a PNG')
assert.strictEqual(cover.readUInt32BE(8), 13, 'PNG starts with a complete IHDR')
assert.strictEqual(cover.toString('ascii', 12, 16), 'IHDR')
const coverWidth = cover.readUInt32BE(16)
const coverHeight = cover.readUInt32BE(20)
assert(coverWidth >= 1000 && coverHeight >= 800, 'share cover must not regress to a small app icon')
assert.strictEqual(coverWidth * 4, coverHeight * 5, 'share cover uses the 5:4 message-card ratio')
assert(cover.length <= 200 * 1024, 'keep the bundled cover within a 200 KiB asset budget')
const storage = {}
const app = {
  globalData: { openid: 'new-user', openidReady: Promise.resolve() },
  applyCurrentUser(openid, user) {
    storage.user_profile = { ...user, openid }
    storage.last_openid = openid
  }
}
const calls = [],
  toasts = []
let uploads = 0,
  failSave = false
const db = createMockDb({
  games: [
    { _id: 'g', inviteCode: 'ABCDEF', status: 'ongoing', buyIn: 500, players: [], totalPot: 0 }
  ],
  users: [],
  transactions: []
})
const join = loadHandler('joinGame', db, { openid: 'new-user' })
global.wx = {
  getStorageSync: key => storage[key],
  setStorageSync: (key, val) => {
    storage[key] = val
  },
  showToast: x => toasts.push(x),
  showLoading() {},
  hideLoading() {},
  redirectTo() {},
  cloud: {
    database: () => db,
    uploadFile: async () => {
      uploads++
      return { fileID: 'cloud://avatar' }
    },
    callFunction: async ({ name, data }) => {
      calls.push(name)
      if (name === 'recordTransaction') return { result: { ok: false } }
      if (name === 'joinGame') return { result: await join(data) }
      if (failSave) throw new Error('offline')
      assert.strictEqual(name, 'whoami')
      return {
        result: {
          ok: true,
          openid: 'new-user',
          user: { nickname: data.upsertNickname, avatar: data.upsertAvatar || '' }
        }
      }
    }
  }
}
function load(relative, component = false) {
  const file = path.resolve(__dirname, '../miniprogram', relative)
  let definition
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file),
    getApp: () => app,
    Page: x => {
      definition = x
    },
    Component: x => {
      definition = x
    },
    wx: global.wx,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  })
  return {
    ...(component ? definition.methods : definition),
    data: structuredClone(definition.data),
    setData(patch) {
      Object.assign(this.data, patch)
    }
  }
}
;(async () => {
  const sheet = load('components/profile-sheet/profile-sheet.js', true)
  let request = sheet.request({ hands: 2, buyIn: 500 })
  assert.strictEqual(request, sheet.request(), 'one sheet for double taps')
  sheet.onCancel()
  assert.strictEqual(await request, null)
  assert.strictEqual(calls.length, 0)

  request = sheet.request({ showHands: false, title: '完善资料', confirmText: '继续创建' })
  assert.strictEqual(sheet.data.showHands, false)
  await sheet.onSubmit({ detail: { value: { nickname: '新朋友' } } })
  assert.strictEqual((await request).profile.nickname, '新朋友')
  delete storage.user_profile
  calls.length = 0

  const page = load('pages/game-detail/game-detail.js')
  page.data.game = db._raw.games[0]
  page.data.gameId = 'g'
  page.selectComponent = () => sheet
  page._applyGame = game => {
    page.data.game = game
  }
  const pending = page.onJoinAsPlayer()
  await new Promise(resolve => setImmediate(resolve))
  assert.strictEqual(sheet.data.visible, true)
  sheet.onAvatar({ detail: { avatarUrl: 'wxfile://temp-avatar' } })
  failSave = true
  await sheet.onSubmit({ detail: { value: { nickname: '新朋友', hands: '2' } } })
  assert.strictEqual(sheet.data.visible, true, 'failed save keeps the form')
  assert.strictEqual(db._raw.games[0].players.length, 0)
  failSave = false
  await sheet.onSubmit({ detail: { value: { nickname: '新朋友', hands: '2' } } })
  await pending
  assert.strictEqual(uploads, 1, 'retry reuses successfully uploaded avatar')
  assert.strictEqual(db._raw.games[0].players.length, 1)
  assert.strictEqual(db._raw.games[0].players[0].nickname, '新朋友')
  assert.strictEqual(db._raw.games[0].players[0].avatar, 'cloud://avatar')
  assert.strictEqual(db._raw.games[0].players[0].totalBuyIn, 1000)
  assert.strictEqual(db._raw.transactions.length, 1)
  assert.strictEqual(page.data.viewerMode, false)
  storage.stax_pending_g = [
    { type: 'rebuy', playerOpenid: 'new-user', amount: 500, operationId: 'legacy_pending' }
  ]
  global.wx.showModal = opts => opts.success({ confirm: false })
  await page.onRecoverPending()
  assert.strictEqual(
    storage.stax_pending_g.length,
    1,
    'declining recovery preserves the legacy operation'
  )
  global.wx.showModal = opts => opts.success({ confirm: true })
  await page.onRecoverPending()
  assert.strictEqual(storage.stax_pending_g.length, 0)
  assert.strictEqual(
    storage['stax_pending_g_new-user'].length,
    1,
    'a failed retry remains bound to its confirmed owner'
  )

  for (const name of ['index', 'history', 'game-detail', 'circle-detail']) {
    const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../miniprogram/pages/${name}/${name}.json`), 'utf8'))
    assert.strictEqual(config.enableShareAppMessage, undefined, 'sharing uses the page handler, not an unsupported config key')
    const p = load(`pages/${name}/${name}.js`)
    Object.assign(p.data, {
      gameId: 'g',
      game: { name: '私密场次12345', totalPot: 98765, inviteCode: 'ABCDEF' },
      circle: { name: '私密群名', inviteCode: 'ABCDEFGH' },
      myStats: { totalGames: 8, totalProfit: -12345 },
      games: [{ myProfit: -12345 }]
    })
    const share = p.onShareAppMessage()
    assert(!/12345|98765|私密|胜率|盈利|亏损|累计/.test(share.title), name)
    assert.strictEqual(share.imageUrl, '/images/share-cover-v2.png')
    assert(fs.existsSync(path.resolve(__dirname, '../miniprogram' + share.imageUrl)))
    if (name === 'game-detail') {
      assert.strictEqual(share.path, '/pages/game-detail/game-detail?id=g&code=ABCDEF&mode=viewer')
    } else if (name === 'circle-detail') {
      assert.strictEqual(share.path, '/pages/circle-join/circle-join?code=ABCDEFGH')
    } else {
      assert.strictEqual(share.path, '/pages/index/index')
    }
  }
  const css = fs.readFileSync(path.resolve(__dirname, '../miniprogram/components/profile-sheet/profile-sheet.wxss'), 'utf8')
  for (const block of css.split('}')) {
    const selector = block.split('{')[0]
    assert(!/(^|[>,\s])(?:button|input|image|text|view)(?=::|\s|$)/.test(selector), 'component styles use class selectors')
  }
  console.log('share-profile.test.js passed')
})().catch(err => {
  console.error(err)
  process.exitCode = 1
})
