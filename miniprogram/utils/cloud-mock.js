// utils/cloud-mock.js — 接管 wx.cloud.callFunction，本地实现所有云函数逻辑
//
// 用法：
//   require('./cloud-mock.js').install()
// 之后 wx.cloud.callFunction 全部走本地，不发出网络请求。

const { createMockDb } = require('./db-mock.js')
const { buildSeed, MY_OPENID } = require('./mock-data.js')
const { settle } = require('./settle.js')
const { aaEven, aaWinnerByRatio, applyShares } = require('./aa.js')
const { generateInviteCode } = require('./invite-code.js')

let MOCK_DB = null
let installed = false

function getDb() {
  if (!MOCK_DB) MOCK_DB = createMockDb(buildSeed())
  return MOCK_DB
}

function reset() {
  MOCK_DB = createMockDb(buildSeed())
  console.log('[cloud-mock] data reset')
}

// ===== 云函数本地实现 =====
const handlers = {
  async whoami({ upsertNickname, upsertAvatar }) {
    const db = getDb()
    const q = await db.collection('users').where({ _openid: MY_OPENID }).limit(1).get()
    let user = q.data[0]
    if (!user) {
      const created = await db.collection('users').add({
        data: {
          nickname: upsertNickname || '玩家',
          avatar: upsertAvatar || '',
          createdAt: new Date(),
          stats: { totalGames: 0, totalProfit: 0, biggestWin: 0, biggestLoss: 0, wins: 0 }
        }
      })
      user = (await db.collection('users').doc(created._id).get()).data
    } else if (
      (upsertNickname && upsertNickname !== user.nickname) ||
      (upsertAvatar && upsertAvatar !== user.avatar)
    ) {
      await db
        .collection('users')
        .doc(user._id)
        .update({
          data: {
            nickname: upsertNickname || user.nickname,
            avatar: upsertAvatar || user.avatar
          }
        })
      user = (await db.collection('users').doc(user._id).get()).data
    }
    return { ok: true, openid: MY_OPENID, user }
  },

  async createGame({
    name,
    buyIn = 500,
    smallBlind = 5,
    bigBlind = 5,
    blindUpMinutes = 20,
    nickname = '庄家',
    avatar = ''
  }) {
    if (!name) return { ok: false, error: 'INVALID_NAME' }
    const db = getDb()
    const inviteCode = generateInviteCode()
    const now = new Date()
    const blindStructure = []
    let curSb = smallBlind,
      curBb = bigBlind
    for (let i = 0; i < 12; i++) {
      blindStructure.push({ sb: curSb, bb: curBb, ante: i >= 4 ? Math.floor(curBb / 4) : 0 })
      if (i % 2 === 1) {
        curSb *= 2
        curBb *= 2
      } else {
        curSb = Math.floor(curSb * 1.5)
        curBb = Math.floor(curBb * 1.5)
      }
    }
    const created = await db.collection('games').add({
      data: {
        hostOpenid: MY_OPENID,
        name,
        status: 'ongoing',
        buyIn,
        smallBlind,
        bigBlind,
        blindUpMinutes,
        blindStructure,
        currentLevel: 0,
        levelStartedAt: now,
        paused: false,
        pausedAt: null,
        pausedAccumMs: 0,
        startedAt: now,
        endedAt: null,
        inviteCode,
        players: [
          {
            openid: MY_OPENID,
            nickname,
            avatar,
            buyInCount: 1,
            totalBuyIn: buyIn,
            currentStack: buyIn,
            finalStack: null,
            profit: 0,
            joinedAt: now,
            eliminatedAt: null
          }
        ],
        totalPot: buyIn
      }
    })
    await db.collection('transactions').add({
      data: {
        gameId: created._id,
        type: 'buyIn',
        playerOpenid: MY_OPENID,
        amount: buyIn,
        operatorOpenid: MY_OPENID,
        byHost: true,
        revoked: false,
        timestamp: now
      }
    })
    return { ok: true, gameId: created._id, inviteCode }
  },

  async joinGame({ inviteCode, nickname = '玩家', avatar = '' }) {
    if (!/^[A-Z0-9]{6}$/.test(inviteCode || '')) return { ok: false, error: 'INVALID_CODE' }
    const db = getDb()
    const found = await db
      .collection('games')
      .where({ inviteCode, status: 'ongoing' })
      .limit(1)
      .get()
    if (!found.data.length) return { ok: false, error: 'GAME_NOT_FOUND' }
    const game = found.data[0]
    if (game.players.find(p => p.openid === MY_OPENID))
      return { ok: true, gameId: game._id, alreadyJoined: true }
    const now = new Date()
    const player = {
      openid: MY_OPENID,
      nickname,
      avatar,
      buyInCount: 1,
      totalBuyIn: game.buyIn,
      currentStack: game.buyIn,
      finalStack: null,
      profit: 0,
      joinedAt: now,
      eliminatedAt: null
    }
    await db
      .collection('games')
      .doc(game._id)
      .update({
        data: {
          players: [...game.players, player],
          totalPot: game.totalPot + game.buyIn
        }
      })
    await db.collection('transactions').add({
      data: {
        gameId: game._id,
        type: 'buyIn',
        playerOpenid: MY_OPENID,
        amount: game.buyIn,
        operatorOpenid: MY_OPENID,
        byHost: false,
        revoked: false,
        timestamp: now
      }
    })
    return { ok: true, gameId: game._id }
  },

  async recordTransaction({ gameId, type, playerOpenid, amount = 0, hands: handsInput, txId }) {
    if (!gameId || !type) return { ok: false, error: 'INVALID_PARAMS' }
    const db = getDb()
    const got = await db
      .collection('games')
      .doc(gameId)
      .get()
      .catch(() => null)
    if (!got || !got.data) return { ok: false, error: 'GAME_NOT_FOUND' }
    const game = got.data
    if (game.status !== 'ongoing') return { ok: false, error: 'GAME_ENDED' }
    const isHost = game.hostOpenid === MY_OPENID
    const now = new Date()
    const players = game.players.slice()

    if (type === 'rebuy' || type === 'addOn') {
      if (amount <= 0) return { ok: false, error: 'INVALID_AMOUNT' }
      const targetOpenid = playerOpenid || MY_OPENID
      if (!isHost && targetOpenid !== MY_OPENID)
        return { ok: false, error: 'CAN_ONLY_BUY_FOR_SELF' }
      const idx = players.findIndex(p => p.openid === targetOpenid)
      if (idx < 0) return { ok: false, error: 'PLAYER_NOT_FOUND' }
      const buyIn = Number(game.buyIn) || 0
      const hands =
        Number(handsInput) > 0
          ? Math.floor(Number(handsInput))
          : buyIn > 0
            ? Math.max(1, Math.round(amount / buyIn))
            : 1
      players[idx] = {
        ...players[idx],
        buyInCount: players[idx].buyInCount + hands,
        totalBuyIn: players[idx].totalBuyIn + amount,
        currentStack: (players[idx].currentStack || 0) + amount,
        eliminatedAt: null
      }
      await db
        .collection('games')
        .doc(gameId)
        .update({ data: { players, totalPot: game.totalPot + amount } })
      const tx = await db.collection('transactions').add({
        data: {
          gameId,
          type,
          playerOpenid: targetOpenid,
          amount,
          operatorOpenid: MY_OPENID,
          byHost: isHost,
          revoked: false,
          timestamp: now,
          meta: { hands }
        }
      })
      return { ok: true, txId: tx._id }
    }
    if (type === 'revoke') {
      if (!isHost) return { ok: false, error: 'NOT_HOST' }
      if (!txId) return { ok: false, error: 'TX_REQUIRED' }
      const txGot = await db
        .collection('transactions')
        .doc(txId)
        .get()
        .catch(() => null)
      if (!txGot || !txGot.data) return { ok: false, error: 'TX_NOT_FOUND' }
      const tx = txGot.data
      if (tx.revoked) return { ok: false, error: 'ALREADY_REVOKED' }
      const idx = players.findIndex(p => p.openid === tx.playerOpenid)
      if (idx < 0) return { ok: false, error: 'PLAYER_NOT_FOUND' }
      const hands = Math.max(1, tx.meta?.hands || Math.round(tx.amount / (game.buyIn || tx.amount)))
      players[idx] = {
        ...players[idx],
        buyInCount: Math.max(1, players[idx].buyInCount - hands),
        totalBuyIn: Math.max(0, players[idx].totalBuyIn - tx.amount),
        currentStack: Math.max(0, (players[idx].currentStack || 0) - tx.amount)
      }
      await db
        .collection('games')
        .doc(gameId)
        .update({ data: { players, totalPot: game.totalPot - tx.amount } })
      await db
        .collection('transactions')
        .doc(txId)
        .update({ data: { revoked: true, revokedAt: now, revokedBy: MY_OPENID } })
      return { ok: true }
    }
    if (type === 'eliminate') {
      if (!isHost) return { ok: false, error: 'NOT_HOST' }
      const idx = players.findIndex(p => p.openid === playerOpenid)
      if (idx < 0) return { ok: false, error: 'PLAYER_NOT_FOUND' }
      players[idx] = { ...players[idx], eliminatedAt: now, currentStack: 0 }
      await db.collection('games').doc(gameId).update({ data: { players } })
      await db.collection('transactions').add({
        data: {
          gameId,
          type,
          playerOpenid,
          amount: 0,
          operatorOpenid: MY_OPENID,
          byHost: true,
          revoked: false,
          timestamp: now
        }
      })
      return { ok: true }
    }
    if (type === 'pauseToggle') {
      if (!isHost) return { ok: false, error: 'NOT_HOST' }
      const paused = !game.paused
      const update = { paused }
      if (paused) update.pausedAt = now
      else if (game.pausedAt) {
        update.pausedAccumMs = (game.pausedAccumMs || 0) + (now - new Date(game.pausedAt))
        update.pausedAt = null
      }
      await db.collection('games').doc(gameId).update({ data: update })
      return { ok: true }
    }
    if (type === 'levelUp') {
      if (!isHost) return { ok: false, error: 'NOT_HOST' }
      const next = Math.min((game.currentLevel || 0) + 1, game.blindStructure.length - 1)
      await db
        .collection('games')
        .doc(gameId)
        .update({ data: { currentLevel: next, levelStartedAt: now, pausedAccumMs: 0 } })
      return { ok: true }
    }
    return { ok: false, error: 'UNKNOWN_TYPE' }
  },

  async settleGame({ gameId, finalStacks, extraCost = 0, expenseMode = 'all', mode = 'checkout' }) {
    if (!gameId || !finalStacks) return { ok: false, error: 'INVALID_PARAMS' }
    const db = getDb()
    const got = await db
      .collection('games')
      .doc(gameId)
      .get()
      .catch(() => null)
    if (!got || !got.data) return { ok: false, error: 'GAME_NOT_FOUND' }
    const game = got.data
    if (game.status === 'ended') return { ok: false, error: 'ALREADY_ENDED' }
    const now = new Date()
    const submittedOpenids = Object.keys(finalStacks)
    let players = game.players.map(p => {
      if (!submittedOpenids.includes(p.openid)) return p
      const finalStack = Number(finalStacks[p.openid] || 0)
      const profit = finalStack - p.totalBuyIn
      return {
        ...p,
        finalStack,
        profit,
        currentStack: finalStack,
        checkedOutAt: p.checkedOutAt || now
      }
    })
    const allSettled = players.every(p => p.finalStack !== null && p.finalStack !== undefined)
    let ended = false
    let diff = 0
    if (mode === 'finalize') {
      if (!allSettled) return { ok: false, error: 'NOT_ALL_CHECKED_OUT' }
      diff = players.reduce((s, p) => s + p.profit, 0)
      if (diff !== 0) return { ok: false, error: 'PROFIT_NOT_ZERO', diff }
      {
        let shares = players.map(p => ({ openid: p.openid, nickname: p.nickname, share: 0 }))
        if (extraCost > 0 && expenseMode === 'all') shares = aaEven(players, extraCost)
        else if (extraCost > 0 && expenseMode === 'winner')
          shares = aaWinnerByRatio(players, extraCost)
        const shareMap = {}
        shares.forEach(s => {
          shareMap[s.openid] = s.share || 0
        })
        players = players.map(p => ({
          ...p,
          share: shareMap[p.openid] || 0,
          finalProfit: p.profit
        }))
        ended = true
      }
    }
    const update = {
      players,
      extraCost,
      expenseMode,
      aaMode: expenseMode,
      checkedOutCount: players.filter(p => p.finalStack !== null && p.finalStack !== undefined)
        .length,
      settledCount: players.filter(p => p.finalStack !== null && p.finalStack !== undefined).length
    }
    if (ended) {
      update.status = 'ended'
      update.endedAt = now
    }
    await db.collection('games').doc(gameId).update({ data: update })
    return { ok: true, ended, diff, players, game: { ...game, ...update, players } }
  },

  async aiReview({ gameId }) {
    const db = getDb()
    const got = await db
      .collection('games')
      .doc(gameId)
      .get()
      .catch(() => null)
    if (!got || !got.data) return { ok: false, error: 'GAME_NOT_FOUND' }
    const game = got.data
    if (game.status !== 'ended') return { ok: false, error: 'GAME_NOT_ENDED' }
    const players = (game.players || []).slice()
    const me = players.find(p => p.openid === MY_OPENID)
    const winners = players
      .filter(p => (p.finalProfit ?? p.profit) > 0)
      .sort((a, b) => (b.finalProfit ?? b.profit) - (a.finalProfit ?? a.profit))
    const losers = players
      .filter(p => (p.finalProfit ?? p.profit) < 0)
      .sort((a, b) => (a.finalProfit ?? a.profit) - (b.finalProfit ?? b.profit))
    const totalRebuys = players.reduce((s, p) => s + (p.buyInCount - 1), 0)
    const durationMin =
      game.endedAt && game.startedAt
        ? Math.round((new Date(game.endedAt) - new Date(game.startedAt)) / 60000)
        : 0
    const totalPot = game.totalPot || players.reduce((s, p) => s + p.totalBuyIn, 0)
    const facts = {
      name: game.name,
      playerCount: players.length,
      durationMin,
      totalPot,
      totalRebuys,
      extraCost: game.extraCost || 0,
      expenseMode: game.expenseMode || game.aaMode || 'none',
      me: me
        ? { nickname: me.nickname, profit: me.finalProfit ?? me.profit, buyInCount: me.buyInCount }
        : null,
      bigWinner: winners[0] || null,
      bigLoser: losers[0] || null,
      winners: winners.map(p => ({ nickname: p.nickname, profit: p.finalProfit ?? p.profit })),
      losers: losers.map(p => ({ nickname: p.nickname, profit: p.finalProfit ?? p.profit }))
    }
    const pick = a => a[Math.floor(Math.random() * a.length)]
    const lines = []
    if (durationMin)
      lines.push(
        pick([
          `${durationMin} 分钟，${facts.playerCount} 个人，桌上发生的事比《孙子兵法》还精彩。`,
          `${durationMin} 分钟一场，${facts.playerCount} 人围炉夜话，话题只有一个：「为什么是我」。`
        ])
      )
    else lines.push(`${facts.playerCount} 人闪击战，一杯茶还没凉，账已经算完。`)
    if (facts.bigWinner) {
      const w = facts.bigWinner
      const wPct = totalPot ? Math.round((w.profit / totalPot) * 100) : 0
      lines.push(
        pick([
          `今晚 MVP：${w.nickname}，独吞 ${w.profit}（约 ${wPct}% 总池），孙子说"善战者，致人而不致于人"，说的就是他。`,
          `${w.nickname} +${w.profit}，赢得不像兵法，倒像玄学，下次记得带上他。`
        ])
      )
    }
    if (facts.bigLoser)
      lines.push(
        pick([
          `${facts.bigLoser.nickname} ${facts.bigLoser.profit}，输得最稳的人往往是下次最稳的赢家。`,
          `心态奖颁给 ${facts.bigLoser.nickname}：${facts.bigLoser.profit}，下次记住"小敌之坚，大敌之擒也"，别硬刚。`
        ])
      )
    if (totalRebuys >= facts.playerCount * 2)
      lines.push(`全场补了 ${totalRebuys} 次码，人均两轮起步，今晚的 ATM 不是机器，是你们。`)
    else if (totalRebuys >= facts.playerCount)
      lines.push(`全场 ${totalRebuys} 次补码，谁也不肯先认怂。`)
    else if (totalRebuys === 0) lines.push(`全场零补码，要么紧得像保险柜，要么牌不肯给力。`)
    if (me) {
      const v = me.finalProfit ?? me.profit
      if (v > 0) lines.push(`你今晚 +${v}，宵夜随便点，"兵贵胜，不贵久"，及时收手最帅。`)
      else if (v < 0) lines.push(`你今晚 ${v}，没事，"多算胜，少算不胜"，下次先算完再下注。`)
      else lines.push(`你今晚账面持平，不输就是赢，回家睡个好觉。`)
    }
    if (facts.extraCost > 0) {
      const label = facts.expenseMode === 'winner' ? '水上 AA' : '全员 AA'
      lines.push(`其他费用 ${facts.extraCost} 按「${label}」记账，不进盈亏，结账请坦坦荡荡。`)
    }
    return { ok: true, facts, review: lines.join(' ').slice(0, 320), provider: 'template' }
  },

  async deleteGameRecord({ gameId }) {
    if (!gameId) return { ok: false, error: 'INVALID_PARAMS' }
    const db = getDb()
    const got = await db
      .collection('games')
      .doc(gameId)
      .get()
      .catch(() => null)
    if (!got || !got.data) return { ok: false, error: 'GAME_NOT_FOUND' }
    const game = got.data
    const hidden = Array.isArray(game.hiddenForOpenids) ? game.hiddenForOpenids.slice() : []
    if (!hidden.includes(MY_OPENID)) hidden.push(MY_OPENID)
    await db
      .collection('games')
      .doc(gameId)
      .update({ data: { hiddenForOpenids: hidden } })
    return { ok: true }
  },

  async termAi({ termId, termEn }) {
    const db = getDb()
    let term
    if (termId)
      term = (
        await db
          .collection('terms')
          .doc(termId)
          .get()
          .catch(() => ({ data: null }))
      ).data
    else if (termEn) term = (await db.collection('terms').where({ termEn }).limit(1).get()).data[0]
    if (!term) return { ok: false, error: 'TERM_NOT_FOUND' }
    const scenarios = {
      rule: `🎴 「${term.termEn} / ${term.termCn}」一句话懂：`,
      action: `🃏 「${term.termEn} / ${term.termCn}」实战时机：`,
      position: `📍 「${term.termEn} / ${term.termCn}」位置体感：`,
      hand: `🂠 「${term.termEn} / ${term.termCn}」拿到这手怎么打：`,
      concept: `💡 「${term.termEn} / ${term.termCn}」内功心法：`
    }
    const insights = {
      rule: `${term.definition}\n\n💬 通俗讲，这就是德州扑克的"游戏规则"，不懂这个根本玩不起来。${term.example ? `\n\n🎯 比如：${term.example}` : ''}`,
      action: `${term.definition}\n\n💬 什么时候用？看场面、看对手、看位置——三件事齐活儿才能打出 +EV 的决定。${term.example ? `\n\n🎯 真实场景：${term.example}` : ''}`,
      position: `${term.definition}\n\n💬 位置就是德州的"金钱本身"——前位是地狱，后位是天堂，按钮位是 GOAT。${term.example ? `\n\n🎯 比如：${term.example}` : ''}`,
      hand: `${term.definition}\n\n💬 拿到这手牌别上头——位置、人数、对手风格三件事先想清楚，再决定要不要投。${term.example ? `\n\n🎯 比如：${term.example}` : ''}`,
      concept: `${term.definition}\n\n💬 这是高手和新手的分水岭，懂这个能让你少输一半的钱。${term.example ? `\n\n🎯 比如：${term.example}` : ''}`
    }
    return {
      ok: true,
      term,
      aiText: (scenarios[term.category] || '') + (insights[term.category] || term.definition),
      provider: 'template'
    }
  },

  async seedTerms() {
    return { ok: true, termsInserted: 10, handRanksInserted: 169, note: 'mock 模式数据已内置' }
  }
}

// ===== 安装到 wx.cloud =====
function install() {
  if (installed) return
  if (typeof wx === 'undefined') return
  installed = true

  // 假装初始化成功
  wx.cloud = wx.cloud || {}
  wx.cloud.init = function () {}

  wx.cloud.callFunction = async function ({ name, data = {} }) {
    const fn = handlers[name]
    if (!fn) {
      console.warn('[cloud-mock] no handler for', name)
      return { result: { ok: false, error: 'NO_MOCK_HANDLER' } }
    }
    try {
      const result = await fn(data)
      return { result }
    } catch (err) {
      console.error('[cloud-mock]', name, 'error', err)
      return { result: { ok: false, error: err.message } }
    }
  }

  wx.cloud.database = function () {
    return getDb()
  }

  // 上传/存储简单忽略
  wx.cloud.uploadFile = async function ({ filePath }) {
    return { fileID: filePath }
  }

  console.log('[cloud-mock] installed — running in DEMO MODE')
}

module.exports = { install, reset, getDb, handlers, MY_OPENID }
