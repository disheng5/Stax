const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { createRequire } = require('module')
const { createMockDb } = require('../miniprogram/utils/db-mock.js')
const loadHandler = require('./helpers/cloud-handler.js')
const storage = {}
const app = { globalData: { openid: 'new-user', openidReady: Promise.resolve() },
  applyCurrentUser(openid, user) {
    storage.user_profile = { ...user, openid }
    storage.last_openid = openid
  } }
const calls = [], toasts = []
let uploads = 0, failSave = false
const db = createMockDb({ games: [{ _id: 'g', inviteCode: 'ABCDEF', status: 'ongoing', buyIn: 500, players: [], totalPot: 0 }], users: [], transactions: [] })
const join = loadHandler('joinGame', db, { openid: 'new-user' })
global.wx = {
  getStorageSync: key => storage[key], setStorageSync: (key, val) => { storage[key] = val },
  showToast: x => toasts.push(x), showLoading() {}, hideLoading() {}, redirectTo() {},
  cloud: { database: () => db, uploadFile: async () => { uploads++; return { fileID: 'cloud://avatar' } },
    callFunction: async ({ name, data }) => {
      calls.push(name)
      if (name === 'joinGame') return { result: await join(data) }
      if (failSave) throw new Error('offline')
      assert.strictEqual(name, 'whoami')
      return { result: { ok: true, openid: 'new-user', user: { nickname: data.upsertNickname, avatar: data.upsertAvatar || '' } } }
    } }
}
function load(relative, component = false) {
  const file = path.resolve(__dirname, '../miniprogram', relative)
  let definition
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { require: createRequire(file), getApp: () => app,
    Page: x => { definition = x }, Component: x => { definition = x }, wx: global.wx, console, setTimeout, clearTimeout, setInterval, clearInterval })
  return { ...(component ? definition.methods : definition), data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch) } }
}
;(async () => {
  const sheet = load('components/profile-sheet/profile-sheet.js', true)
  let request = sheet.request({ hands: 2, buyIn: 500 })
  assert.strictEqual(request, sheet.request(), 'one sheet for double taps')
  sheet.onCancel()
  assert.strictEqual(await request, null)
  assert.strictEqual(calls.length, 0)

  const page = load('pages/game-detail/game-detail.js')
  page.data.game = db._raw.games[0]
  page.data.gameId = 'g'
  page.selectComponent = () => sheet
  page._applyGame = game => { page.data.game = game }
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

  for (const name of ['index', 'history', 'game-detail', 'circle-detail']) {
    const p = load(`pages/${name}/${name}.js`)
    Object.assign(p.data, { gameId: 'g', game: { name: '私密场次12345', totalPot: 98765, inviteCode: 'ABCDEF' },
      circle: { name: '私密群名', inviteCode: 'ABCDEFGH' }, myStats: { totalGames: 8, totalProfit: -12345 }, games: [{ myProfit: -12345 }] })
    const share = p.onShareAppMessage()
    assert(!/12345|98765|私密|胜率|盈利|亏损|累计/.test(share.title), name)
    assert.strictEqual(share.imageUrl, '/images/share-cover.png')
    assert(fs.existsSync(path.resolve(__dirname, '../miniprogram' + share.imageUrl)))
    if (name === 'game-detail') assert(share.path.includes('code=ABCDEF'))
  }
  console.log('share-profile.test.js passed')
})().catch(err => { console.error(err); process.exitCode = 1 })
