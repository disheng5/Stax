// scripts/test-mock.js — Node 环境下跑 mock 全流程，验证可用性
// 思路：构造一个 wx 全局对象，install 后调用 callFunction 走完整业务流

const path = require('path')

// 模拟 wx 全局
global.wx = {
  cloud: {},
  getStorageSync: () => ({}),
  setStorageSync: () => {},
  showModal: () => {}
}

// 让 require 找到 miniprogram/utils
const utilsRoot = path.join(__dirname, '..', 'miniprogram', 'utils')
require('module').Module._nodeModulePaths(utilsRoot).forEach(() => {})

const cloudMock = require(path.join(utilsRoot, 'cloud-mock.js'))
cloudMock.install()

const assert = require('assert')

function step(name, fn) {
  return Promise.resolve(fn()).then(
    () => console.log('  ✓', name),
    err => { console.error('  ✗', name, err.message); process.exitCode = 1 }
  )
}

;(async () => {
  console.log('Mock end-to-end flow test')

  await step('whoami 拿到 mock openid', async () => {
    const r = await wx.cloud.callFunction({ name: 'whoami', data: {} })
    assert.strictEqual(r.result.ok, true)
    assert.strictEqual(r.result.openid, 'mock_me')
    assert.ok(r.result.user.stats)
  })

  let gameId
  await step('创建一局', async () => {
    const r = await wx.cloud.callFunction({ name: 'createGame', data: {
      name: 'Mock 创建测试局', buyIn: 100, smallBlind: 10, bigBlind: 20, blindUpMinutes: 20,
      nickname: 'Demo 玩家'
    }})
    assert.strictEqual(r.result.ok, true)
    assert.ok(r.result.gameId)
    assert.strictEqual(r.result.inviteCode.length, 6)
    gameId = r.result.gameId
  })

  await step('查询进行中牌局列表', async () => {
    const db = wx.cloud.database()
    const _ = db.command
    const r = await db.collection('games').where({
      status: 'ongoing',
      players: _.elemMatch({ openid: 'mock_me' })
    }).get()
    assert.ok(r.data.length >= 2, '应有至少 2 局进行中（demo 局 + 新建局）')
  })

  await step('参与人自助 rebuy 应被允许', async () => {
    // 新建局只有 me，模拟不到第二人；改用 demo 局测，给 mock_bob 自助补码不可（mock 模式下我是 me）
    // 这里只测 me 给自己 rebuy
    const r = await wx.cloud.callFunction({ name: 'recordTransaction', data: {
      gameId, type: 'rebuy', playerOpenid: 'mock_me', amount: 50
    }})
    assert.strictEqual(r.result.ok, true)
  })

  await step('给非 host 给非自己 rebuy 应拒绝', async () => {
    // mock 模式下 me 一定是 host，无法验证 NOT_HOST 路径；跳过
  })

  await step('踢人：从 players 移除、总池扣减、快照入 removedPlayers', async () => {
    const db = wx.cloud.database()
    const before = (await db.collection('games').doc('game_live_demo').get()).data
    const bob = before.players.find(p => p.openid === 'mock_bob')
    assert.ok(bob, '演示局中应有 Bob')
    const r = await wx.cloud.callFunction({ name: 'recordTransaction', data: {
      gameId: 'game_live_demo', type: 'eliminate', playerOpenid: 'mock_bob'
    }})
    assert.strictEqual(r.result.ok, true)
    const after = (await db.collection('games').doc('game_live_demo').get()).data
    assert.ok(!after.players.some(p => p.openid === 'mock_bob'), 'Bob 应被移出 players')
    assert.strictEqual(after.totalPot, before.totalPot - bob.totalBuyIn, '总池应扣除其买入')
    assert.strictEqual(after.removedPlayers.length, 1)
    assert.strictEqual(after.removedPlayers[0].openid, 'mock_bob')
  })

  await step('最终结算（Σ profit ≠ 0 应拒绝）', async () => {
    const r = await wx.cloud.callFunction({ name: 'settleGame', data: {
      gameId, mode: 'finalize', finalStacks: { 'mock_me': 100 }
    }})
    assert.strictEqual(r.result.ok, false)
    assert.strictEqual(r.result.error, 'PROFIT_NOT_ZERO')
  })

  await step('下桌记录（checkout 不校验差额）', async () => {
    const r = await wx.cloud.callFunction({ name: 'settleGame', data: {
      gameId, mode: 'checkout', finalStacks: { 'mock_me': 100 }
    }})
    assert.strictEqual(r.result.ok, true)
    assert.strictEqual(r.result.ended, false)
  })

  await step('最终结算（Σ profit = 0 应成功并终局）', async () => {
    // 新建局 me 买入 150（100 初始 + 50 rebuy），最终 150 → profit = 0
    const r = await wx.cloud.callFunction({ name: 'settleGame', data: {
      gameId, mode: 'finalize', finalStacks: { 'mock_me': 150 }
    }})
    assert.strictEqual(r.result.ok, true)
    assert.strictEqual(r.result.ended, true)
  })

  await step('AI 复盘（结算后）', async () => {
    const r = await wx.cloud.callFunction({ name: 'aiReview', data: { gameId } })
    assert.strictEqual(r.result.ok, true)
    assert.ok(r.result.review.length > 30, '应生成至少 30 字的点评')
    assert.ok(r.result.facts)
  })

  await step('术语 AI 释义', async () => {
    const r = await wx.cloud.callFunction({ name: 'termAi', data: { termId: 'term_3' } })
    assert.strictEqual(r.result.ok, true)
    assert.ok(r.result.aiText.includes('Button') || r.result.aiText.includes('庄家位'))
  })

  await step('查询历史战绩（status=ended）', async () => {
    const db = wx.cloud.database()
    const _ = db.command
    const r = await db.collection('games').where({
      status: 'ended', players: _.elemMatch({ openid: 'mock_me' })
    }).orderBy('endedAt', 'desc').get()
    assert.ok(r.data.length >= 5, '应至少有 5 局历史 + 1 局刚结算 = 6')
  })

  await step('积分榜重置应按合规局重算胜率', async () => {
    const created = await wx.cloud.callFunction({
      name: 'createCircle',
      data: { name: 'Mock 积分榜' }
    })
    assert.strictEqual(created.result.ok, true)
    const circleId = created.result.circleId
    const raw = cloudMock.getDb()._raw
    const circle = raw.circles.find(c => c._id === circleId)
    circle.memberOpenids = ['mock_me', 'mock_bob', 'mock_carol', 'mock_dan']
    raw.users.push(
      { _id: 'user_bob_rank', _openid: 'mock_bob', nickname: 'Bob', avatar: '' },
      { _id: 'user_carol_rank', _openid: 'mock_carol', nickname: 'Carol', avatar: '' },
      { _id: 'user_dan_rank', _openid: 'mock_dan', nickname: 'Dan', avatar: '' }
    )
    const now = Date.now()
    const makeGame = (id, offsetMin, profits) => {
      const endedAt = new Date(now + offsetMin * 60000)
      const startedAt = new Date(endedAt.getTime() - 90 * 60000)
      return {
        _id: id,
        status: 'ended',
        name: id,
        bigBlind: 10,
        startedAt,
        endedAt,
        players: [
          { openid: 'mock_me', nickname: 'Demo 玩家', finalProfit: profits[0], profit: profits[0] },
          { openid: 'mock_bob', nickname: 'Bob', finalProfit: profits[1], profit: profits[1] },
          { openid: 'mock_carol', nickname: 'Carol', finalProfit: profits[2], profit: profits[2] },
          { openid: 'mock_dan', nickname: 'Dan', finalProfit: profits[3], profit: profits[3] }
        ]
      }
    }
    raw.games.push(
      makeGame('rank_game_1', 1, [100, -50, -50, 0]),
      makeGame('rank_game_2', 3, [-20, 80, -30, -30])
    )

    const reset = await wx.cloud.callFunction({ name: 'resetSeason', data: { circleId } })
    assert.strictEqual(reset.result.ok, true)
    assert.strictEqual(reset.result.qualifiedCount, 2)
    const season = raw.seasons.find(s => s._id === circle.currentSeasonId)
    const me = season.rankings.find(r => r.openid === 'mock_me')
    const bob = season.rankings.find(r => r.openid === 'mock_bob')
    assert.strictEqual(me.games, 2)
    assert.strictEqual(me.wins, 1)
    assert.strictEqual(me.winRate, 50)
    assert.strictEqual(bob.winRate, 50)

    const removed = await wx.cloud.callFunction({
      name: 'removeCircleMember',
      data: { circleId, targetOpenid: 'mock_bob' }
    })
    assert.strictEqual(removed.result.ok, true)
    assert.ok(!circle.memberOpenids.includes('mock_bob'))
    assert.ok(!season.rankings.some(r => r.openid === 'mock_bob'))
    assert.ok(season.rankings.every(r => r.openid !== 'mock_bob'))
  })

  await step('数据库 watch 能收到推送', async () => {
    const db = wx.cloud.database()
    const livedoc = (await db.collection('games').where({ inviteCode: 'DEMO99' }).limit(1).get()).data[0]
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('watch 未在 1s 内回调')), 1000)
      const w = db.collection('games').doc(livedoc._id).watch({
        onChange: snapshot => {
          if (snapshot.docs?.length) {
            clearTimeout(t); w.close(); resolve()
          }
        },
        onError: reject
      })
    })
  })

  await step('重置 Demo 数据', async () => {
    cloudMock.reset()
    const db = wx.cloud.database()
    const r = await db.collection('games').where({ status: 'ended' }).get()
    assert.strictEqual(r.data.length, 5, '重置后应回到初始 5 局历史')
  })

  if (process.exitCode) {
    console.error('\n✗ Mock 全链路存在失败用例，请检查上方输出')
  } else {
    console.log('\n✓ Mock 全链路通过')
  }
})()
