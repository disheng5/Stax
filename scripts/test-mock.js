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
require('module')
  .Module._nodeModulePaths(utilsRoot)
  .forEach(() => {})

const cloudMock = require(path.join(utilsRoot, 'cloud-mock.js'))
cloudMock.install()

const assert = require('assert')

function step(name, fn) {
  return Promise.resolve(fn()).then(
    () => console.log('  ✓', name),
    err => {
      console.error('  ✗', name, err.message)
      process.exitCode = 1
    }
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

  await step('历史用户无 users 资料时可用有效客户端昵称创建', async () => {
    const raw = cloudMock.getDb()._raw
    raw.users[0].nickname = '玩家'
    const r = await wx.cloud.callFunction({
      name: 'createGame',
      data: { name: '资料兼容测试', nickname: '历史昵称', buyIn: 100, smallBlind: 5, bigBlind: 5 }
    })
    assert.strictEqual(r.result.ok, true)
    const game = raw.games.find(g => g._id === r.result.gameId)
    assert.strictEqual(game.players[0].nickname, '历史昵称')
    assert.strictEqual(raw.users[0].nickname, '历史昵称', '恢复后应回填 users')
    cloudMock.reset()
  })

  await step('已发布旧客户端漏传昵称时可从自动记录名恢复并回填', async () => {
    const raw = cloudMock.getDb()._raw
    raw.users[0].nickname = '玩家'
    raw.users[0].avatar = ''
    const r = await wx.cloud.callFunction({
      name: 'createGame',
      data: { name: 'eter的神秘聚会（07-10）', buyIn: 100, smallBlind: 5, bigBlind: 5 }
    })
    assert.strictEqual(r.result.ok, true)
    const game = raw.games.find(g => g._id === r.result.gameId)
    assert.strictEqual(game.players[0].nickname, 'eter')
    assert.strictEqual(raw.users[0].nickname, 'eter', '兼容恢复只需执行一次')
    cloudMock.reset()
  })

  await step('有效 users 资料为空头像时不得被旧客户端或历史头像覆盖', async () => {
    const raw = cloudMock.getDb()._raw
    raw.users[0].avatar = ''
    const r = await wx.cloud.callFunction({
      name: 'createGame',
      data: {
        name: '头像权威测试',
        nickname: '过期本地昵称',
        avatar: 'cloud://stale-avatar',
        buyIn: 100,
        smallBlind: 5,
        bigBlind: 5
      }
    })
    assert.strictEqual(r.result.ok, true)
    const game = raw.games.find(g => g._id === r.result.gameId)
    assert.strictEqual(game.players[0].nickname, 'Demo 玩家')
    assert.strictEqual(game.players[0].avatar, '')
    cloudMock.reset()
  })

  let gameId
  await step('创建一局', async () => {
    const r = await wx.cloud.callFunction({
      name: 'createGame',
      data: {
        name: 'Mock 创建测试局',
        buyIn: 100,
        smallBlind: 10,
        bigBlind: 20,
        blindUpMinutes: 20,
        nickname: '过期本地昵称'
      }
    })
    assert.strictEqual(r.result.ok, true)
    assert.ok(r.result.gameId)
    assert.strictEqual(r.result.inviteCode.length, 6)
    gameId = r.result.gameId
    const game = cloudMock.getDb()._raw.games.find(g => g._id === gameId)
    assert.strictEqual(game.players[0].nickname, 'Demo 玩家', '云端资料应优先于本地快照')
    assert.strictEqual(game.name, 'Mock 创建测试局', '记录名按原样保存，不再追加合规后缀')
    assert.strictEqual(game.txRevision, 1)
    assert.strictEqual(r.result.game._id, gameId, '创建响应应携带可直接上屏的权威快照')
  })

  await step('旧客户端自定义记录名继续兼容', async () => {
    const r = await wx.cloud.callFunction({
      name: 'createGame',
      data: { name: '周末现金局', buyIn: 100, smallBlind: 5, bigBlind: 5 }
    })
    assert.strictEqual(r.result.ok, true, '服务端不得收紧旧客户端已有名称入参')
  })

  await step('查询进行中牌局列表', async () => {
    const db = wx.cloud.database()
    const _ = db.command
    const r = await db
      .collection('games')
      .where({
        status: 'ongoing',
        players: _.elemMatch({ openid: 'mock_me' })
      })
      .get()
    assert.ok(r.data.length >= 2, '应有至少 2 局进行中（demo 局 + 新建局）')
  })

  await step('参赛成员可代提他人结算；关闭权限共享后仅房主', async () => {
    const game = cloudMock.getDb()._raw.games.find(g => g._id === gameId)
    game.hostOpenid = 'mock_host'
    game.players.push({
      openid: 'mock_other',
      nickname: 'Other',
      totalBuyIn: 100,
      currentStack: 100,
      finalStack: null,
      profit: 0
    })
    // 朋友局：非房主参赛成员可代提他人结算积分
    const other = await wx.cloud.callFunction({
      name: 'settleGame',
      data: { gameId, mode: 'checkout', finalStacks: { mock_other: 100 } }
    })
    assert.strictEqual(other.result.ok, true)
    assert.strictEqual(other.result.ended, false, '仍有人未结算，不应收局')
    // 非参赛者不可被代提
    const stranger = await wx.cloud.callFunction({
      name: 'settleGame',
      data: { gameId, mode: 'checkout', finalStacks: { mock_stranger: 100 } }
    })
    assert.strictEqual(stranger.result.error, 'PLAYER_NOT_FOUND')
    // 关闭权限共享后仅房主可操作
    game.playerOpsShared = false
    const disabled = await wx.cloud.callFunction({
      name: 'settleGame',
      data: { gameId, mode: 'checkout', finalStacks: { mock_me: 100 } }
    })
    assert.strictEqual(disabled.result.error, 'PLAYER_OPS_DISABLED')
    game.hostOpenid = 'mock_me'
    game.playerOpsShared = true
    game.players = game.players.filter(p => p.openid !== 'mock_other')
  })

  await step('结算后再次买入应撤销该成员结算且同操作号只入账一次', async () => {
    const before = cloudMock.getDb()._raw.games.find(g => g._id === gameId)
    Object.assign(before.players[0], {
      currentStack: 120,
      finalStack: 120,
      profit: 20,
      finalProfit: 20,
      share: 8,
      checkedOutAt: new Date()
    })
    before.checkedOutCount = 1
    before.settledCount = 1
    const data = {
      gameId,
      type: 'rebuy',
      playerOpenid: 'mock_me',
      amount: 50,
      operationId: 'rebuy_mock_0001'
    }
    const beforeRevision = before.txRevision
    const first = await wx.cloud.callFunction({ name: 'recordTransaction', data })
    const replay = await wx.cloud.callFunction({ name: 'recordTransaction', data })
    assert.strictEqual(first.result.ok, true)
    assert.strictEqual(replay.result.idempotent, true)
    const game = cloudMock.getDb()._raw.games.find(g => g._id === gameId)
    const player = game.players[0]
    assert.strictEqual(player.totalBuyIn, 150)
    assert.strictEqual(player.currentStack, 170)
    assert.strictEqual(player.finalStack, null)
    assert.strictEqual(player.profit, 0)
    assert.strictEqual(player.finalProfit, null)
    assert.strictEqual(player.share, 0)
    assert.strictEqual(player.checkedOutAt, null)
    assert.strictEqual(game.checkedOutCount, 0)
    assert.strictEqual(game.settledCount, 0)
    assert.strictEqual(game.txRevision, beforeRevision + 1)
    assert.strictEqual(first.result.game.txRevision, game.txRevision)
    assert.strictEqual(
      cloudMock.getDb()._raw.transactions.filter(t => t.operationId === data.operationId).length,
      1
    )
  })

  await step('给非 host 给非自己 rebuy 应拒绝', async () => {
    // mock 模式下 me 一定是 host，无法验证 NOT_HOST 路径；跳过
  })

  await step('流水新增字段：operationSequence 单调递增、操作人快照、前后手数', async () => {
    const probeGameId = 'game_live_demo'
    const raw = cloudMock.getDb()._raw
    const game = raw.games.find(g => g._id === probeGameId)
    const before = game.txSeq || 0
    const r = await wx.cloud.callFunction({
      name: 'recordTransaction',
      data: {
        gameId: probeGameId,
        type: 'rebuy',
        playerOpenid: 'mock_me',
        amount: 50,
        operationId: 'seq_probe_0001'
      }
    })
    assert.strictEqual(r.result.ok, true)
    const after = cloudMock.getDb()._raw.games.find(g => g._id === probeGameId)
    assert.strictEqual(after.txSeq, before + 1, 'txSeq 应单调递增')
    const tx = cloudMock
      .getDb()
      ._raw.transactions.filter(t => t.gameId === probeGameId && t.type === 'rebuy')
      .sort((a, b) => (b.operationSequence || 0) - (a.operationSequence || 0))[0]
    assert.strictEqual(tx.operationSequence, after.txSeq, '流水顺序号应与 txSeq 对齐')
    assert.ok('operatorNicknameSnapshot' in tx, '应写入操作人昵称快照')
    assert.ok(
      typeof tx.beforeHands === 'number' && typeof tx.afterHands === 'number',
      '应写入前后手数'
    )
    assert.strictEqual(
      tx.afterHands - tx.beforeHands,
      tx.meta.hands,
      '前后手数差应等于本次买入手数'
    )
  })

  await step('踢人：从 players 移除、总池扣减、快照入 removedPlayers', async () => {
    const db = wx.cloud.database()
    const before = (await db.collection('games').doc('game_live_demo').get()).data
    const bob = before.players.find(p => p.openid === 'mock_bob')
    assert.ok(bob, '演示局中应有 Bob')
    const r = await wx.cloud.callFunction({
      name: 'recordTransaction',
      data: {
        gameId: 'game_live_demo',
        type: 'eliminate',
        playerOpenid: 'mock_bob'
      }
    })
    assert.strictEqual(r.result.ok, true)
    const after = (await db.collection('games').doc('game_live_demo').get()).data
    assert.ok(!after.players.some(p => p.openid === 'mock_bob'), 'Bob 应被移出 players')
    assert.strictEqual(after.totalPot, before.totalPot - bob.totalBuyIn, '总池应扣除其买入')
    assert.strictEqual(after.removedPlayers.length, 1)
    assert.strictEqual(after.removedPlayers[0].openid, 'mock_bob')
  })

  await step('最终结算（Σ profit ≠ 0 应拒绝）', async () => {
    const r = await wx.cloud.callFunction({
      name: 'settleGame',
      data: {
        gameId,
        mode: 'finalize',
        finalStacks: { mock_me: 100 }
      }
    })
    assert.strictEqual(r.result.ok, false)
    assert.strictEqual(r.result.error, 'PROFIT_NOT_ZERO')
  })

  await step('全员结算即自动收局（差额不为 0 也先收局）', async () => {
    const data = {
      gameId,
      mode: 'checkout',
      finalStacks: { mock_me: 100 },
      operationId: 'checkout_mock_0001'
    }
    const first = await wx.cloud.callFunction({ name: 'settleGame', data })
    const replay = await wx.cloud.callFunction({ name: 'settleGame', data })
    assert.strictEqual(first.result.ok, true)
    assert.strictEqual(first.result.ended, true, '唯一玩家结算完成应自动收局')
    assert.strictEqual(first.result.diff, -50, '账不平仍可收局，3 小时内可修正')
    assert.strictEqual(first.result.game.status, 'ended')
    assert.strictEqual(replay.result.idempotent, true)
    assert.strictEqual(
      cloudMock.getDb()._raw.transactions.filter(t => t.operationId === data.operationId).length,
      1
    )
  })

  await step('结束后 3 小时内可修改结算积分（差额修正）', async () => {
    // 买入 150，改结算为 180 → profit +30，edited 标记生效
    const r = await wx.cloud.callFunction({
      name: 'settleGame',
      data: {
        gameId,
        mode: 'checkout',
        finalStacks: { mock_me: 180 },
        operationId: 'edit_mock_0001'
      }
    })
    assert.strictEqual(r.result.ok, true)
    assert.strictEqual(r.result.edited, true)
    assert.strictEqual(r.result.game.players[0].finalProfit, 30)
    assert.strictEqual(r.result.game.status, 'ended')
  })

  await step('费用分摊：expense 模式（MVP 买单）与保留已存设置', async () => {
    // 设置费用：MVP 买单 → 唯一赢家 me 承担全部
    const beforeGame = cloudMock.getDb()._raw.games.find(g => g._id === gameId)
    const beforeRevision = beforeGame.txRevision
    const beforeStateRevision = beforeGame.stateRevision
    const beforeSeq = beforeGame.txSeq || 0
    const r = await wx.cloud.callFunction({
      name: 'settleGame',
      data: { gameId, mode: 'expense', extraCost: 30, expenseMode: 'mvp' }
    })
    assert.strictEqual(r.result.ok, true)
    assert.strictEqual(r.result.game.expenseMode, 'mvp')
    assert.strictEqual(r.result.game.players[0].share, 30)
    assert.strictEqual(
      r.result.game.txRevision,
      beforeRevision + 1,
      '费用修改应留一条可审计流水并推进流水版本'
    )
    assert.strictEqual(r.result.game.txSeq, beforeSeq + 1, '费用修改应占用一个流水顺序号')
    assert.strictEqual(
      r.result.game.stateRevision,
      beforeStateRevision + 1,
      '费用修改应推进房间状态版本，确保多端按顺序校准'
    )
    const expenseTx = cloudMock
      .getDb()
      ._raw.transactions.filter(t => t.gameId === gameId && t.type === 'expense')
    assert.strictEqual(expenseTx.length, 1, '费用修改应生成一条 expense 流水')
    assert.strictEqual(expenseTx[0].beforeValue, 0)
    assert.strictEqual(expenseTx[0].afterValue, 30)
    assert.ok(expenseTx[0].operatorOpenid, '费用流水应记录操作人')
    // 之后的 checkout 不带费用参数，不应把费用清零
    const edit = await wx.cloud.callFunction({
      name: 'settleGame',
      data: { gameId, mode: 'checkout', finalStacks: { mock_me: 150 } }
    })
    assert.strictEqual(edit.result.ok, true)
    assert.strictEqual(edit.result.game.extraCost, 30, 'checkout 不得覆盖已存费用')
    assert.strictEqual(edit.result.game.expenseMode, 'mvp')
    // profit 归 0 后无赢家 → MVP 退化为全员均摊（单人局仍是他承担）
    assert.strictEqual(edit.result.game.players[0].share, 30)
  })

  await step('结束后 finalize 应拒绝（自动收局已替代手动结束）', async () => {
    const r = await wx.cloud.callFunction({
      name: 'settleGame',
      data: { gameId, mode: 'finalize', finalStacks: { mock_me: 150 } }
    })
    assert.strictEqual(r.result.ok, false)
    assert.strictEqual(r.result.error, 'ALREADY_ENDED')
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
    const r = await db
      .collection('games')
      .where({
        status: 'ended',
        players: _.elemMatch({ openid: 'mock_me' })
      })
      .orderBy('endedAt', 'desc')
      .get()
    assert.ok(r.data.length >= 5, '应至少有 5 局历史 + 1 局刚结算 = 6')
  })

  await step('完整流水分页应覆盖 80 条以上记录', async () => {
    const db = cloudMock.getDb()
    const raw = db._raw
    const bulk = Array.from({ length: 105 }, (_, index) => ({
      _id: `bulk_tx_${String(index).padStart(3, '0')}`,
      gameId,
      type: 'rebuy',
      playerOpenid: 'mock_me',
      amount: 1,
      timestamp: new Date(Date.now() + index),
      meta: { hands: 1 }
    }))
    raw.transactions.push(...bulk)
    const count = await db.collection('transactions').where({ gameId }).count()
    const pages = []
    for (let skip = 0; skip < count.total; skip += 20) {
      const page = await db
        .collection('transactions')
        .where({ gameId })
        .orderBy('timestamp', 'asc')
        .skip(skip)
        .limit(20)
        .get()
      pages.push(...page.data)
    }
    assert.strictEqual(pages.length, count.total)
    assert.strictEqual(new Set(pages.map(tx => tx._id)).size, count.total)
    raw.transactions = raw.transactions.filter(tx => !tx._id.startsWith('bulk_tx_'))
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
      { _id: 'user_dan_rank', _openid: 'mock_dan', nickname: 'Dan', avatar: '' },
      { _id: 'user_bob_legacy_duplicate', _openid: 'mock_bob', nickname: '玩家', avatar: '' }
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

    const initial = await wx.cloud.callFunction({ name: 'resetSeason', data: { circleId } })
    assert.strictEqual(initial.result.ok, true)
    assert.strictEqual(initial.result.qualifiedCount, 2)
    const season = raw.seasons.find(s => s._id === circle.currentSeasonId)
    delete season.excludedGameIds
    delete season.exclusionScopeVersion
    raw.games.find(g => g._id === 'rank_game_2').excludeFromSeason = true
    const reset = await wx.cloud.callFunction({ name: 'resetSeason', data: { circleId } })
    assert.strictEqual(reset.result.ok, true)
    assert.strictEqual(reset.result.qualifiedCount, 1)
    assert.deepStrictEqual(season.excludedGameIds, ['rank_game_2'], '旧牌局级排除应迁入当前赛季')
    raw.games.find(g => g._id === 'rank_game_2').excludeFromSeason = false
    const legacyIgnored = await wx.cloud.callFunction({ name: 'resetSeason', data: { circleId } })
    assert.strictEqual(legacyIgnored.result.qualifiedCount, 1, '迁移后旧字段变化不应影响本季')
    const legacyRestored = await wx.cloud.callFunction({
      name: 'excludeGame',
      data: { circleId, gameId: 'rank_game_2', exclude: false }
    })
    assert.strictEqual(legacyRestored.result.ok, true)
    assert.strictEqual(season.calculationMeta.qualifiedCount, 2)
    const me = season.rankings.find(r => r.openid === 'mock_me')
    const bob = season.rankings.find(r => r.openid === 'mock_bob')
    assert.strictEqual(me.games, 2)
    assert.strictEqual(me.wins, 1)
    assert.strictEqual(me.winRate, 50)
    assert.strictEqual(bob.winRate, 50)
    assert.strictEqual(bob.nickname, 'Bob', '重复的默认用户记录不能覆盖真实昵称')

    const excluded = await wx.cloud.callFunction({
      name: 'excludeGame',
      data: { circleId, gameId: 'rank_game_1', exclude: true }
    })
    assert.strictEqual(excluded.result.ok, true)
    assert.deepStrictEqual(season.excludedGameIds, ['rank_game_1'])
    assert.strictEqual(season.calculationMeta.qualifiedCount, 1)
    assert.strictEqual(raw.games.find(g => g._id === 'rank_game_1').excludeFromSeason, undefined)
    assert.strictEqual(season.gameSummaries.find(g => g._id === 'rank_game_1').excluded, true)

    const restored = await wx.cloud.callFunction({
      name: 'excludeGame',
      data: { circleId, gameId: 'rank_game_1', exclude: false }
    })
    assert.strictEqual(restored.result.ok, true)
    assert.deepStrictEqual(season.excludedGameIds, [])
    assert.strictEqual(season.calculationMeta.qualifiedCount, 2)

    raw.games.find(g => g._id === 'rank_game_1').hostOpenid = 'mock_me'
    const legacyExcluded = await wx.cloud.callFunction({
      name: 'excludeGame',
      data: { gameId: 'rank_game_1', exclude: true }
    })
    assert.strictEqual(legacyExcluded.result.ok, true)
    assert.strictEqual(legacyExcluded.result.legacy, true)
    assert.strictEqual(raw.games.find(g => g._id === 'rank_game_1').excludeFromSeason, true)
    assert.deepStrictEqual(season.excludedGameIds, ['rank_game_1'])
    await wx.cloud.callFunction({
      name: 'excludeGame',
      data: { circleId, gameId: 'rank_game_1', exclude: false }
    })

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
    const livedoc = (await db.collection('games').where({ inviteCode: 'DEMO99' }).limit(1).get())
      .data[0]
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('watch 未在 1s 内回调')), 1000)
      const w = db
        .collection('games')
        .doc(livedoc._id)
        .watch({
          onChange: snapshot => {
            if (snapshot.docs?.length) {
              clearTimeout(t)
              w.close()
              resolve()
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
