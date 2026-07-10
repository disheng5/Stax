const assert = require('assert')

const storage = {}
let response = {
  ok: true,
  profiles: {
    user_a: {
      nickname: '最新昵称',
      avatar: 'cloud://new-avatar',
      updatedAt: '2026-07-10T01:00:00.000Z'
    }
  }
}
let urlCalls = 0

global.wx = {
  getStorageSync(key) {
    return storage[key] || ''
  },
  setStorageSync(key, value) {
    storage[key] = value
  },
  removeStorageSync(key) {
    delete storage[key]
  },
  cloud: {
    async callFunction() {
      return { result: response }
    },
    async getTempFileURL({ fileList }) {
      urlCalls++
      return {
        fileList: fileList.map(fileID => ({
          fileID,
          tempFileURL: `https://avatar.test/${encodeURIComponent(fileID)}`,
          maxAge: 2 * 60 * 60 * 1000
        }))
      }
    }
  }
}

const cache = require('../miniprogram/utils/avatar.js')
const { readLocalProfile, writeLocalProfile } = require('../miniprogram/utils/user.js')

;(async () => {
  cache.putProfiles(
    [{ openid: 'user_a', nickname: '旧牌局昵称', avatar: 'cloud://old-avatar' }],
    { source: 'snapshot' }
  )
  await cache.resolve(['user_a'], { force: true })
  assert.strictEqual(cache.cached('user_a').nickname, '最新昵称')
  assert.strictEqual(cache.cached('user_a').avatar, 'cloud://new-avatar')

  const display = await cache.resolveDisplayUrls(['cloud://new-avatar'])
  assert.ok(display['cloud://new-avatar'].startsWith('https://avatar.test/'))
  await cache.resolveDisplayUrls(['cloud://new-avatar'])
  assert.strictEqual(urlCalls, 1, '有效期内重复进页不能再次换取头像 URL')

  cache.putProfiles(
    [{ openid: 'user_a', nickname: '玩家', avatar: 'cloud://old-avatar' }],
    { source: 'snapshot' }
  )
  assert.strictEqual(cache.cached('user_a').nickname, '最新昵称')
  assert.strictEqual(cache.cached('user_a').avatar, 'cloud://new-avatar')

  response = { ok: false, error: 'temporary failure' }
  cache.invalidate('user_a')
  const originalWarn = console.warn
  console.warn = () => {}
  try {
    await cache.resolve(['user_a'], { force: true })
  } finally {
    console.warn = originalWarn
  }
  assert.strictEqual(cache.cached('user_a').nickname, '最新昵称')
  assert.strictEqual(cache.cached('user_a').avatar, 'cloud://new-avatar')

  writeLocalProfile({ openid: 'user_a', nickname: '账号 A', avatar: 'cloud://a' })
  assert.strictEqual(readLocalProfile('user_a').nickname, '账号 A')
  assert.strictEqual(readLocalProfile('user_b').nickname, '', '本地资料不能跨 openid 复用')

  console.log('profile-cache tests passed')
})().catch(err => {
  console.error(err)
  process.exitCode = 1
})
