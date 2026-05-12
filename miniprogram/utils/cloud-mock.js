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
      const created = await db.collection('users').add({ data: {
        nickname: upsertNickname || '玩家', avatar: upsertAvatar || '', createdAt: new Date(),
        stats: { totalGames: 0, totalProfit: 0, biggestWin: 0, biggestLoss: 0, wins: 0 }
      }})
      user = (await db.collection('users').doc(created._id).get()).data
    } else if ((upsertNickname && upsertNickname !== user.nickname) || (upsertAvatar && upsertAvatar !== user.avatar)) {
      await db.collection('users').doc(user._id).update({ data: {
        nickname: upsertNickname || user.nickname, avatar: upsertAvatar || user.avatar
      }})
      user = (await db.collection('users').doc(user._id).get()).data
    }
    return { ok: true, openid: MY_OPENID, user }
  },

  async createGame({ name, buyIn = 100, smallBlind = 10, bigBlind = 20, blindUpMinutes = 20, nickname = '庄家', avatar = '' }) {
    if (!name) return { ok: false, error: 'INVALID_NAME' }
    if (bigBlind < smallBlind * 2) return { ok: false, error: 'INVALID_BLIND_RATIO' }
    const db = getDb()
    const inviteCode = generateInviteCode()
    const now = new Date()
    const blindStructure = []
    let curSb = smallBlind, curBb = bigBlind
    for (let i = 0; i < 12; i++) {
      blindStructure.push({ sb: curSb, bb: curBb, ante: i >= 4 ? Math.floor(curBb / 4) : 0 })
      if (i % 2 === 1) { curSb *= 2; curBb *= 2 } else { curSb = Math.floor(curSb * 1.5); curBb = Math.floor(curBb * 1.5) }
    }
    const created = await db.collection('games').add({ data: {
      hostOpenid: MY_OPENID, name, status: 'ongoing', buyIn,
      smallBlind, bigBlind, blindUpMinutes, blindStructure,
      currentLevel: 0, levelStartedAt: now, paused: false, pausedAt: null, pausedAccumMs: 0,
      startedAt: now, endedAt: null, inviteCode,
      players: [{ openid: MY_OPENID, nickname, avatar, buyInCount: 1, totalBuyIn: buyIn, currentStack: buyIn, finalStack: null, profit: 0, joinedAt: now, eliminatedAt: null }],
      totalPot: buyIn
    }})
    await db.collection('transactions').add({ data: {
      gameId: created._id, type: 'buyIn', playerOpenid: MY_OPENID, amount: buyIn,
      operatorOpenid: MY_OPENID, byHost: true, revoked: false, timestamp: now
    }})
    return { ok: true, gameId: created._id, inviteCode }
  },

  async joinGame({ inviteCode, nickname = '玩家', avatar = '' }) {
    if (!/^[A-Z0-9]{6}$/.test(inviteCode || '')) return { ok: false, error: 'INVALID_CODE' }
    const db = getDb()
    const found = await db.collection('games').where({ inviteCode, status: 'ongoing' }).limit(1).get()
    if (!found.data.length) return { ok: false, error: 'GAME_NOT_FOUND' }
    const game = found.data[0]
    if (game.players.find(p => p.openid === MY_OPENID)) return { ok: true, gameId: game._id, alreadyJoined: true }
    const now = new Date()
    const player = { openid: MY_OPENID, nickname, avatar, buyInCount: 1, totalBuyIn: game.buyIn, currentStack: game.buyIn, finalStack: null, profit: 0, joinedAt: now, eliminatedAt: null }
    await db.collection('games').doc(game._id).update({ data: {
      players: [...game.players, player],
      totalPot: game.totalPot + game.buyIn
    }})
    await db.collection('transactions').add({ data: {
      gameId: game._id, type: 'buyIn', playerOpenid: MY_OPENID, amount: game.buyIn,
      operatorOpenid: MY_OPENID, byHost: false, revoked: false, timestamp: now
    }})
    return { ok: true, gameId: game._id }
  },

  async recordTransaction({ gameId, type, playerOpenid, amount = 0, txId }) {
    if (!gameId || !type) return { ok: false, error: 'INVALID_PARAMS' }
    const db = getDb()
    const got = await db.collection('games').doc(gameId).get().catch(() => null)
    if (!got || !got.data) return { ok: false, error: 'GAME_NOT_FOUND' }
    const game = got.data
    if (game.status !== 'ongoing') return { ok: false, error: 'GAME_ENDED' }
    const isHost = game.hostOpenid === MY_OPENID
    const now = new Date()
    const players = game.players.slice()

    if (type === 'rebuy' || type === 'addOn') {
      if (amount <= 0) return { ok: false, error: 'INVALID_AMOUNT' }
      const targetOpenid = playerOpenid || MY_OPENID
      if (!isHost && targetOpenid !== MY_OPENID) return { ok: false, error: 'CAN_ONLY_BUY_FOR_SELF' }
      const idx = players.findIndex(p => p.openid === targetOpenid)
      if (idx < 0) return { ok: false, error: 'PLAYER_NOT_FOUND' }
      players[idx] = { ...players[idx], buyInCount: players[idx].buyInCount + 1, totalBuyIn: players[idx].totalBuyIn + amount, currentStack: (players[idx].currentStack || 0) + amount, eliminatedAt: null }
      await db.collection('games').doc(gameId).update({ data: { players, totalPot: game.totalPot + amount } })
      const tx = await db.collection('transactions').add({ data: {
        gameId, type, playerOpenid: targetOpenid, amount,
        operatorOpenid: MY_OPENID, byHost: isHost, revoked: false, timestamp: now
      }})
      return { ok: true, txId: tx._id }
    }
    if (type === 'revoke') {
      if (!isHost) return { ok: false, error: 'NOT_HOST' }
      if (!txId) return { ok: false, error: 'TX_REQUIRED' }
      const txGot = await db.collection('transactions').doc(txId).get().catch(() => null)
      if (!txGot || !txGot.data) return { ok: false, error: 'TX_NOT_FOUND' }
      const tx = txGot.data
      if (tx.revoked) return { ok: false, error: 'ALREADY_REVOKED' }
      const idx = players.findIndex(p => p.openid === tx.playerOpenid)
      if (idx < 0) return { ok: false, error: 'PLAYER_NOT_FOUND' }
      players[idx] = { ...players[idx], buyInCount: Math.max(1, players[idx].buyInCount - 1), totalBuyIn: Math.max(0, players[idx].totalBuyIn - tx.amount), currentStack: Math.max(0, (players[idx].currentStack || 0) - tx.amount) }
      await db.collection('games').doc(gameId).update({ data: { players, totalPot: game.totalPot - tx.amount } })
      await db.collection('transactions').doc(txId).update({ data: { revoked: true, revokedAt: now, revokedBy: MY_OPENID } })
      return { ok: true }
    }
    if (type === 'eliminate') {
      if (!isHost) return { ok: false, error: 'NOT_HOST' }
      const idx = players.findIndex(p => p.openid === playerOpenid)
      if (idx < 0) return { ok: false, error: 'PLAYER_NOT_FOUND' }
      players[idx] = { ...players[idx], eliminatedAt: now, currentStack: 0 }
      await db.collection('games').doc(gameId).update({ data: { players } })
      await db.collection('transactions').add({ data: {
        gameId, type, playerOpenid, amount: 0,
        operatorOpenid: MY_OPENID, byHost: true, revoked: false, timestamp: now
      }})
      return { ok: true }
    }
    if (type === 'pauseToggle') {
      if (!isHost) return { ok: false, error: 'NOT_HOST' }
      const paused = !game.paused
      const update = { paused }
      if (paused) update.pausedAt = now
      else if (game.pausedAt) { update.pausedAccumMs = (game.pausedAccumMs || 0) + (now - new Date(game.pausedAt)); update.pausedAt = null }
      await db.collection('games').doc(gameId).update({ data: update })
      return { ok: true }
    }
    if (type === 'levelUp') {
      if (!isHost) return { ok: false, error: 'NOT_HOST' }
      const next = Math.min((game.currentLevel || 0) + 1, game.blindStructure.length - 1)
      await db.collection('games').doc(gameId).update({ data: { currentLevel: next, levelStartedAt: now, pausedAccumMs: 0 } })
      return { ok: true }
    }
    return { ok: false, error: 'UNKNOWN_TYPE' }
  },

  async settleGame({ gameId, finalStacks, extraCost = 0, aaMode = 'none', shares = [] }) {
    if (!gameId || !finalStacks) return { ok: false, error: 'INVALID_PARAMS' }
    const db = getDb()
    const got = await db.collection('games').doc(gameId).get().catch(() => null)
    if (!got || !got.data) return { ok: false, error: 'GAME_NOT_FOUND' }
    const game = got.data
    if (game.status === 'ended') return { ok: false, error: 'ALREADY_ENDED' }
    if (game.hostOpenid !== MY_OPENID) return { ok: false, error: 'NOT_HOST' }
    const now = new Date()
    const shareMap = {}
    shares.forEach(s => { shareMap[s.openid] = s.share || 0 })
    let sum = 0
    const players = game.players.map(p => {
      const finalStack = Number(finalStacks[p.openid] || 0)
      const profit = finalStack - p.totalBuyIn
      const share = Number(shareMap[p.openid] || 0)
      const finalProfit = profit - share
      sum += profit
      return { ...p, finalStack, profit, share, finalProfit, currentStack: finalStack }
    })
    if (sum !== 0) return { ok: false, error: 'PROFIT_NOT_ZERO', diff: sum }
    await db.collection('games').doc(gameId).update({ data: {
      players, status: 'ended', endedAt: now, extraCost, aaMode,
      shareTotal: shares.reduce((s, x) => s + (x.share || 0), 0)
    }})
    // 更新当前用户 stats
    const me = (await db.collection('users').where({ _openid: MY_OPENID }).limit(1).get()).data[0]
    if (me) {
      const myProfit = (players.find(p => p.openid === MY_OPENID) || {}).finalProfit || 0
      const s = me.stats || { totalGames: 0, totalProfit: 0, biggestWin: 0, biggestLoss: 0, wins: 0 }
      await db.collection('users').doc(me._id).update({ data: {
        'stats.totalGames':  s.totalGames + 1,
        'stats.totalProfit': s.totalProfit + myProfit,
        'stats.biggestWin':  Math.max(s.biggestWin || 0, myProfit),
        'stats.biggestLoss': Math.min(s.biggestLoss || 0, myProfit),
        'stats.wins':        (s.wins || 0) + (myProfit > 0 ? 1 : 0)
      }})
    }
    return { ok: true, players }
  },

  async aiReview({ gameId }) {
    const db = getDb()
    const got = await db.collection('games').doc(gameId).get().catch(() => null)
    if (!got || !got.data) return { ok: false, error: 'GAME_NOT_FOUND' }
    const game = got.data
    if (game.status !== 'ended') return { ok: false, error: 'GAME_NOT_ENDED' }
    const players = (game.players || []).slice()
    const me = players.find(p => p.openid === MY_OPENID)
    const winners = players.filter(p => (p.finalProfit ?? p.profit) > 0).sort((a, b) => (b.finalProfit ?? b.profit) - (a.finalProfit ?? a.profit))
    const losers  = players.filter(p => (p.finalProfit ?? p.profit) < 0).sort((a, b) => (a.finalProfit ?? a.profit) - (b.finalProfit ?? b.profit))
    const totalRebuys = players.reduce((s, p) => s + (p.buyInCount - 1), 0)
    const durationMin = game.endedAt && game.startedAt ? Math.round((new Date(game.endedAt) - new Date(game.startedAt)) / 60000) : 0
    const totalPot = (game.totalPot || players.reduce((s, p) => s + p.totalBuyIn, 0))
    const facts = {
      name: game.name, playerCount: players.length, durationMin, totalPot, totalRebuys,
      extraCost: game.extraCost || 0, aaMode: game.aaMode || 'none',
      me: me ? { nickname: me.nickname, profit: me.finalProfit ?? me.profit, buyInCount: me.buyInCount } : null,
      bigWinner: winners[0] || null, bigLoser: losers[0] || null,
      winners: winners.map(p => ({ nickname: p.nickname, profit: p.finalProfit ?? p.profit })),
      losers:  losers.map(p  => ({ nickname: p.nickname, profit: p.finalProfit ?? p.profit }))
    }
    const lines = []
    if (durationMin) lines.push(`聊了整整 ${durationMin} 分钟，${facts.playerCount} 个人围着桌子转了 ${Math.round(durationMin / 30)} 圈，确认过眼神，是有故事的人。`)
    else lines.push(`${facts.playerCount} 个人凑了一局，速战速决。`)
    if (facts.bigWinner) {
      const w = facts.bigWinner
      const wPct = totalPot ? Math.round((w.profit / totalPot) * 100) : 0
      lines.push(`今晚的 MVP 是 ${w.nickname}，独吞 ${w.profit}（约占总池 ${wPct}%），运气和算计都拿满分。`)
    }
    if (facts.bigLoser) lines.push(`心态最稳的是 ${facts.bigLoser.nickname}，${facts.bigLoser.profit} 也能笑着结账，下次可以少点儿冲动 all-in。`)
    if (totalRebuys >= facts.playerCount) lines.push(`全场补了 ${totalRebuys} 次码，几乎人均一次，看来今晚都打得相当"投入"。`)
    else if (totalRebuys === 0) lines.push(`全场零补码，不是太稳就是太怂，下次大胆点。`)
    if (me) {
      const v = me.finalProfit ?? me.profit
      if (v > 0) lines.push(`你今晚 +${v}，赢了这顿宵夜，明天继续保持耐心选位。`)
      else if (v < 0) lines.push(`你今晚 ${v}，先复盘一下哪几手 marginal 牌跟得太松——位置、人数、对手风格三件事，下次先想清楚再投筹码。`)
      else lines.push(`你今晚账面持平，全身而退也是一种胜利。`)
    }
    if (facts.extraCost > 0) lines.push(`额外 ${facts.extraCost} 块${facts.aaMode === 'winnerByRatio' ? '由赢家按比例担了' : '人均 AA 解决'}，结账清清爽爽。`)
    return { ok: true, facts, review: lines.join(' ').slice(0, 280), provider: 'template' }
  },

  async termAi({ termId, termEn }) {
    const db = getDb()
    let term
    if (termId) term = (await db.collection('terms').doc(termId).get().catch(() => ({ data: null }))).data
    else if (termEn) term = (await db.collection('terms').where({ termEn }).limit(1).get()).data[0]
    if (!term) return { ok: false, error: 'TERM_NOT_FOUND' }
    const scenarios = {
      rule:     `🎴 「${term.termEn} / ${term.termCn}」一句话懂：`,
      action:   `🃏 「${term.termEn} / ${term.termCn}」实战时机：`,
      position: `📍 「${term.termEn} / ${term.termCn}」位置体感：`,
      hand:     `🂠 「${term.termEn} / ${term.termCn}」拿到这手怎么打：`,
      concept:  `💡 「${term.termEn} / ${term.termCn}」内功心法：`
    }
    const insights = {
      rule:     `${term.definition}\n\n💬 通俗讲，这就是德州扑克的"游戏规则"，不懂这个根本玩不起来。${term.example ? `\n\n🎯 比如：${term.example}` : ''}`,
      action:   `${term.definition}\n\n💬 什么时候用？看场面、看对手、看位置——三件事齐活儿才能打出 +EV 的决定。${term.example ? `\n\n🎯 真实场景：${term.example}` : ''}`,
      position: `${term.definition}\n\n💬 位置就是德州的"金钱本身"——前位是地狱，后位是天堂，按钮位是 GOAT。${term.example ? `\n\n🎯 比如：${term.example}` : ''}`,
      hand:     `${term.definition}\n\n💬 拿到这手牌别上头——位置、人数、对手风格三件事先想清楚，再决定要不要投。${term.example ? `\n\n🎯 比如：${term.example}` : ''}`,
      concept:  `${term.definition}\n\n💬 这是高手和新手的分水岭，懂这个能让你少输一半的钱。${term.example ? `\n\n🎯 比如：${term.example}` : ''}`
    }
    return { ok: true, term, aiText: (scenarios[term.category] || '') + (insights[term.category] || term.definition), provider: 'template' }
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

  wx.cloud.database = function () { return getDb() }

  // 上传/存储简单忽略
  wx.cloud.uploadFile = async function ({ filePath }) { return { fileID: filePath } }

  console.log('[cloud-mock] installed — running in DEMO MODE')
}

module.exports = { install, reset, getDb, handlers, MY_OPENID }
