// utils/cloud-mock.js — 接管 wx.cloud.callFunction，本地实现所有云函数逻辑
//
// 用法：
//   require('./cloud-mock.js').install()
// 之后 wx.cloud.callFunction 全部走本地，不发出网络请求。

const { createMockDb } = require('./db-mock.js')
const { buildSeed, MY_OPENID } = require('./mock-data.js')
const { computeShares } = require('./aa.js')
const { generateInviteCode } = require('./invite-code.js')

const GENERIC_NICKNAMES = new Set(['玩家', '庄家', '微信用户', '未设置昵称'])
const meaningfulNickname = value => {
  const nickname = typeof value === 'string' ? value.trim() : ''
  return !!nickname && nickname.length <= 24 && !GENERIC_NICKNAMES.has(nickname)
}

const normalizeOperationId = value => {
  const id = typeof value === 'string' ? value.trim() : ''
  return /^[a-zA-Z0-9_-]{8,64}$/.test(id) ? id : ''
}

function operationUpdate(game, operationId) {
  if (!operationId) return {}
  const ids = (game.recentOperationIds || []).filter(id => id !== operationId)
  ids.push(operationId)
  return { recentOperationIds: ids.slice(-50) }
}

function normalizeExpenseMode(value) {
  if (['winner', 'winnerRatio', 'winnerByRatio'].includes(value)) return 'winner'
  if (['winnerEven', 'winnersEven'].includes(value)) return 'winnerEven'
  if (value === 'mvp') return 'mvp'
  return 'all'
}

// 与线上一致：结束后 3 小时内允许修改结算积分/费用
const EDIT_WINDOW_MS = 3 * 60 * 60 * 1000
function withinEditWindow(game, now) {
  if (!game.endedAt) return false
  const endedAt = +new Date(game.endedAt)
  return Number.isFinite(endedAt) && now - endedAt <= EDIT_WINDOW_MS
}

async function currentProfile(fallbackNickname = '', fallbackAvatar = '') {
  const db = getDb()
  const result = await db.collection('users').where({ _openid: MY_OPENID }).limit(100).get()
  const users = result.data || []
  const server = users.find(user => meaningfulNickname(user.nickname)) || users[0] || {}
  return {
    nickname: meaningfulNickname(server.nickname)
      ? server.nickname.trim()
      : meaningfulNickname(fallbackNickname)
        ? fallbackNickname.trim()
        : '',
    avatar: server.avatar || fallbackAvatar || ''
  }
}

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
  async whoami({
    upsertNickname,
    upsertAvatar,
    bootstrapNickname,
    bootstrapAvatar,
    bootstrapOpenid
  }) {
    const db = getDb()
    const canBootstrap = bootstrapOpenid === MY_OPENID
    const q = await db.collection('users').where({ _openid: MY_OPENID }).limit(1).get()
    let user = q.data[0]
    if (!user) {
      const created = await db.collection('users').add({
        data: {
          nickname: upsertNickname || (canBootstrap && bootstrapNickname) || '玩家',
          avatar: upsertAvatar || (canBootstrap && bootstrapAvatar) || '',
          createdAt: new Date(),
          updatedAt: new Date(),
          stats: { totalGames: 0, totalProfit: 0, biggestWin: 0, biggestLoss: 0, wins: 0 }
        }
      })
      user = (await db.collection('users').doc(created._id).get()).data
    } else {
      const nickname =
        upsertNickname ||
        (canBootstrap &&
        !meaningfulNickname(user.nickname) && meaningfulNickname(bootstrapNickname)
          ? bootstrapNickname.trim()
          : user.nickname)
      const avatar =
        upsertAvatar || (canBootstrap && !user.avatar && bootstrapAvatar) || user.avatar
      if (nickname === user.nickname && avatar === user.avatar) {
        return { ok: true, openid: MY_OPENID, user }
      }
      await db
        .collection('users')
        .doc(user._id)
        .update({
          data: {
            nickname,
            avatar,
            updatedAt: new Date()
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
    playerOpsShared = true,
    scoreRatio = 1,
    nickname = '庄家',
    avatar = ''
  }) {
    if (!name) return { ok: false, error: 'INVALID_NAME' }
    const db = getDb()
    const profile = await currentProfile(nickname, avatar)
    if (!meaningfulNickname(profile.nickname)) return { ok: false, error: 'PROFILE_REQUIRED' }
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
        playerOpsShared: playerOpsShared !== false,
        scoreRatio: Number(scoreRatio) > 0 ? Number(scoreRatio) : 1,
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
            nickname: profile.nickname,
            avatar: profile.avatar,
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
        timestamp: now,
        meta: { hands: 1 }
      }
    })
    return { ok: true, gameId: created._id, inviteCode }
  },

  async joinGame({
    inviteCode,
    nickname = '玩家',
    avatar = '',
    mode = 'player',
    hands = 1
  }) {
    if (!/^[A-Z0-9]{6}$/.test(inviteCode || '')) return { ok: false, error: 'INVALID_CODE' }
    const db = getDb()
    const found = await db
      .collection('games')
      .where({ inviteCode, status: 'ongoing' })
      .limit(1)
      .get()
    if (!found.data.length) return { ok: false, error: 'GAME_NOT_FOUND' }
    const game = found.data[0]
    if (mode === 'viewer') return { ok: true, gameId: game._id, viewer: true }
    if (game.players.find(p => p.openid === MY_OPENID))
      return { ok: true, gameId: game._id, alreadyJoined: true }
    const profile = await currentProfile(nickname, avatar)
    if (!meaningfulNickname(profile.nickname)) return { ok: false, error: 'PROFILE_REQUIRED' }
    const now = new Date()
    const buyHands = Math.min(99, Math.max(1, Math.floor(Number(hands) || 1)))
    const amount = Number(game.buyIn) * buyHands
    const player = {
      openid: MY_OPENID,
      nickname: profile.nickname,
      avatar: profile.avatar,
      buyInCount: buyHands,
      totalBuyIn: amount,
      currentStack: amount,
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
          totalPot: game.totalPot + amount
        }
      })
    await db.collection('transactions').add({
      data: {
        gameId: game._id,
        type: 'buyIn',
        playerOpenid: MY_OPENID,
        amount,
        operatorOpenid: MY_OPENID,
        byHost: false,
        revoked: false,
        timestamp: now,
        meta: { hands: buyHands }
      }
    })
    return { ok: true, gameId: game._id }
  },

  async recordTransaction({
    gameId,
    type,
    playerOpenid,
    amount = 0,
    hands: handsInput,
    txId,
    operationId: rawOperationId
  }) {
    if (!gameId || !type) return { ok: false, error: 'INVALID_PARAMS' }
    const db = getDb()
    const got = await db
      .collection('games')
      .doc(gameId)
      .get()
      .catch(() => null)
    if (!got || !got.data) return { ok: false, error: 'GAME_NOT_FOUND' }
    const game = got.data
    const operationId = normalizeOperationId(rawOperationId)
    if (operationId && (game.recentOperationIds || []).includes(operationId)) {
      return { ok: true, idempotent: true, operationId }
    }
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
        .update({
          data: {
            players,
            totalPot: game.totalPot + amount,
            ...operationUpdate(game, operationId)
          }
        })
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
          meta: { hands },
          ...(operationId ? { operationId } : {})
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
        .update({
          data: {
            players,
            totalPot: game.totalPot - tx.amount,
            ...operationUpdate(game, operationId)
          }
        })
      await db
        .collection('transactions')
        .doc(txId)
        .update({
          data: {
            revoked: true,
            revokedAt: now,
            revokedBy: MY_OPENID,
            ...(operationId ? { revokeOperationId: operationId } : {})
          }
        })
      return { ok: true }
    }
    if (type === 'eliminate') {
      // 与线上一致：踢出 = 彻底移除玩家，买入从总池扣除，快照入 removedPlayers
      if (!isHost) return { ok: false, error: 'NOT_HOST' }
      if (playerOpenid === game.hostOpenid) return { ok: false, error: 'CANT_ELIMINATE_HOST' }
      const idx = players.findIndex(p => p.openid === playerOpenid)
      if (idx < 0) return { ok: false, error: 'PLAYER_NOT_FOUND' }
      const removed = players[idx]
      players.splice(idx, 1)
      const removedBuyIn = Number(removed.totalBuyIn) || 0
      await db
        .collection('games')
        .doc(gameId)
        .update({
          data: {
            players,
            totalPot: Math.max(0, (game.totalPot || 0) - removedBuyIn),
            removedPlayers: [
              ...(game.removedPlayers || []),
              { ...removed, removedAt: now, removedBy: MY_OPENID }
            ],
            ...operationUpdate(game, operationId)
          }
        })
      await db.collection('transactions').add({
        data: {
          gameId,
          type,
          playerOpenid,
          amount: -removedBuyIn,
          operatorOpenid: MY_OPENID,
          byHost: true,
          revoked: false,
          timestamp: now,
          meta: { nickname: removed.nickname || '', removedBuyIn },
          ...(operationId ? { operationId } : {})
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
      Object.assign(update, operationUpdate(game, operationId))
      await db.collection('games').doc(gameId).update({ data: update })
      return { ok: true }
    }
    if (type === 'levelUp') {
      if (!isHost) return { ok: false, error: 'NOT_HOST' }
      const next = Math.min((game.currentLevel || 0) + 1, game.blindStructure.length - 1)
      await db
        .collection('games')
        .doc(gameId)
        .update({
          data: {
            currentLevel: next,
            levelStartedAt: now,
            pausedAccumMs: 0,
            ...operationUpdate(game, operationId)
          }
        })
      return { ok: true }
    }
    return { ok: false, error: 'UNKNOWN_TYPE' }
  },

  async settleGame(event = {}) {
    const { gameId, finalStacks, mode = 'checkout' } = event
    const hasExtraCost = event.extraCost !== undefined && event.extraCost !== null
    const hasExpenseMode = !!(event.expenseMode || event.aaMode)
    const extraCost = hasExtraCost ? Number(event.extraCost) : 0
    const expenseMode = hasExpenseMode ? normalizeExpenseMode(event.expenseMode || event.aaMode) : 'all'
    if (!gameId) return { ok: false, error: 'INVALID_PARAMS' }
    if (!['checkout', 'finalize', 'expense'].includes(mode))
      return { ok: false, error: 'INVALID_MODE' }
    if (hasExtraCost && (!Number.isFinite(extraCost) || extraCost < 0))
      return { ok: false, error: 'INVALID_EXTRA_COST' }
    let submittedOpenids = []
    const normalizedStacks = {}
    if (mode !== 'expense') {
      if (!finalStacks) return { ok: false, error: 'INVALID_PARAMS' }
      submittedOpenids = Object.keys(finalStacks).filter(
        openid =>
          finalStacks[openid] !== '' &&
          finalStacks[openid] !== null &&
          finalStacks[openid] !== undefined
      )
      if (!submittedOpenids.length) return { ok: false, error: 'NO_STACKS_SUBMITTED' }
      for (const openid of submittedOpenids) {
        const stack = Number(finalStacks[openid])
        if (!Number.isFinite(stack) || stack < 0) return { ok: false, error: 'INVALID_STACK' }
        normalizedStacks[openid] = stack
      }
    } else if (!hasExtraCost) {
      return { ok: false, error: 'INVALID_EXTRA_COST' }
    }
    const db = getDb()
    const got = await db
      .collection('games')
      .doc(gameId)
      .get()
      .catch(() => null)
    if (!got || !got.data) return { ok: false, error: 'GAME_NOT_FOUND' }
    const game = got.data
    const isHost = game.hostOpenid === MY_OPENID
    const isPlayer = (game.players || []).some(p => p.openid === MY_OPENID)
    if (!isPlayer) return { ok: false, error: 'NOT_PLAYER' }
    if (mode === 'finalize' && !isHost) return { ok: false, error: 'NOT_HOST' }
    const playerOpenids = new Set((game.players || []).map(p => p.openid))
    if (submittedOpenids.some(openid => !playerOpenids.has(openid))) {
      return { ok: false, error: 'PLAYER_NOT_FOUND' }
    }
    // 与线上一致：参赛成员可代提任意玩家结算积分；关闭权限共享时仅房主
    if (!isHost && game.playerOpsShared === false) {
      return { ok: false, error: 'PLAYER_OPS_DISABLED' }
    }
    const operationId = normalizeOperationId(event.operationId)
    if (operationId && (game.recentOperationIds || []).includes(operationId)) {
      return {
        ok: true,
        idempotent: true,
        operationId,
        ended: game.status === 'ended',
        diff: 0,
        players: game.players || [],
        game
      }
    }
    const now = new Date()
    const wasEnded = game.status === 'ended'
    if (wasEnded && !withinEditWindow(game, +now)) return { ok: false, error: 'ALREADY_ENDED' }
    if (mode === 'finalize' && wasEnded) return { ok: false, error: 'ALREADY_ENDED' }

    const effExtraCost = hasExtraCost ? extraCost : Number(game.extraCost) || 0
    const effExpenseMode = hasExpenseMode
      ? expenseMode
      : normalizeExpenseMode(game.expenseMode || game.aaMode || 'all')

    let players = game.players.map(p => {
      if (!submittedOpenids.includes(p.openid)) return p
      const finalStack = normalizedStacks[p.openid]
      const profit = finalStack - p.totalBuyIn
      return {
        ...p,
        finalStack,
        profit,
        currentStack: finalStack,
        checkedOutAt: p.checkedOutAt || now
      }
    })
    // 与线上一致：被淘汰/踢出的玩家不参与结算计算
    const active = players.filter(p => !p.eliminatedAt)
    const allSettled =
      active.length > 0 && active.every(p => p.finalStack !== null && p.finalStack !== undefined)
    const diff = allSettled ? active.reduce((s, p) => s + p.profit, 0) : 0
    if (mode === 'finalize') {
      if (!allSettled) return { ok: false, error: 'NOT_ALL_CHECKED_OUT' }
      if (diff !== 0) return { ok: false, error: 'PROFIT_NOT_ZERO', diff }
    }
    const ended = wasEnded || mode === 'finalize' || (mode === 'checkout' && allSettled)
    const justEnded = ended && !wasEnded
    const edited = wasEnded && mode === 'checkout'
    let shares = active.map(p => ({ openid: p.openid, nickname: p.nickname, share: 0 }))
    if (ended) {
      if (effExtraCost > 0) shares = computeShares(active, effExtraCost, effExpenseMode)
      const shareMap = {}
      shares.forEach(s => {
        shareMap[s.openid] = s.share || 0
      })
      players = players.map(p =>
        p.eliminatedAt
          ? p
          : {
            ...p,
            share: shareMap[p.openid] || 0,
            finalProfit: p.profit
          }
      )
    }
    const settledAll = players.filter(
      p => p.finalStack !== null && p.finalStack !== undefined
    ).length
    const update = {
      players,
      extraCost: effExtraCost,
      expenseMode: effExpenseMode,
      aaMode: effExpenseMode,
      shareTotal: shares.reduce((s, x) => s + (x.share || 0), 0),
      checkedOutCount: settledAll,
      settledCount: settledAll,
      ...operationUpdate(game, operationId)
    }
    if (justEnded) {
      update.status = 'ended'
      update.endedAt = now
    }
    await db.collection('games').doc(gameId).update({ data: update })
    for (const openid of submittedOpenids) {
      await db.collection('transactions').add({
        data: {
          gameId,
          type: ended ? 'settle' : 'settlePartial',
          playerOpenid: openid,
          amount: normalizedStacks[openid],
          operatorOpenid: MY_OPENID,
          byHost: game.hostOpenid === MY_OPENID,
          revoked: false,
          timestamp: now,
          meta: { mode, expenseMode: effExpenseMode, extraCost: effExtraCost, edited },
          ...(operationId ? { operationId } : {})
        }
      })
    }
    return { ok: true, ended, justEnded, edited, diff, players, game: { ...game, ...update, players } }
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
      expenseMode: normalizeExpenseMode(game.expenseMode || game.aaMode),
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
    else if (totalRebuys === 0) lines.push('全场零补码，要么紧得像保险柜，要么牌不肯给力。')
    if (me) {
      const v = me.finalProfit ?? me.profit
      if (v > 0) lines.push(`你今晚 +${v}，宵夜随便点，"兵贵胜，不贵久"，及时收手最帅。`)
      else if (v < 0) lines.push(`你今晚 ${v}，没事，"多算胜，少算不胜"，下次先算完再下注。`)
      else lines.push('你今晚账面持平，不输就是赢，回家睡个好觉。')
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
  },

  async createCircle({ name }) {
    if (!name || String(name).trim().length > 12) return { ok: false, error: 'INVALID_NAME' }
    const db = getDb()
    const now = new Date()
    const inviteCode = generateInviteCode(8)
    const res = await db.collection('circles').add({
      data: {
        name: String(name).trim(),
        ownerOpenid: MY_OPENID,
        inviteCode,
        memberOpenids: [MY_OPENID],
        memberJoinedAt: { [MY_OPENID]: now },
        currentSeasonId: null,
        status: 'active',
        createdAt: now
      }
    })
    return { ok: true, circleId: res._id, inviteCode }
  },

  async calcSeasonScore({ circleId }) {
    if (!circleId) return { ok: false, error: 'INVALID_PARAMS' }
    const db = getDb()
    const raw = db._raw
    const circle = (raw.circles || []).find(c => c._id === circleId)
    if (!circle || circle.status !== 'active') return { ok: false, error: 'CIRCLE_NOT_ACTIVE' }

    let season = circle.currentSeasonId
      ? (raw.seasons || []).find(s => s._id === circle.currentSeasonId)
      : null
    if (!season) {
      const now = new Date()
      const created = await db.collection('seasons').add({
        data: {
          circleId,
          seasonNo: 1,
          seasonName: `${now.getFullYear()} · 测试赛季 · 第1回`,
          startAt: now,
          endAt: new Date(now.getTime() + 42 * 24 * 3600 * 1000),
          status: 'ongoing',
          rankings: []
        }
      })
      circle.currentSeasonId = created._id
      season = (raw.seasons || []).find(s => s._id === created._id)
    }

    const members = circle.memberOpenids || []
    const memberSet = {}
    members.forEach(o => {
      memberSet[o] = true
    })
    const seasonStart = new Date(season.startAt)
    const seasonEnd = new Date(season.endAt)
    const circleCreatedAt = circle.createdAt ? new Date(circle.createdAt) : seasonStart
    const queryStart =
      Number(season.seasonNo) <= 1 && circleCreatedAt < seasonStart ? circleCreatedAt : seasonStart
    const activePlayers = g => (g.players || []).filter(p => !p.eliminatedAt)
    const qualifiedGames = (raw.games || [])
      .filter(g => g.status === 'ended')
      .filter(g => new Date(g.endedAt || g.startedAt) >= queryStart)
      .filter(g => new Date(g.endedAt || g.startedAt) < seasonEnd)
      .filter(g => !g.excludeFromSeason)
      .filter(g => activePlayers(g).length >= 4)
      .filter(g => new Date(g.endedAt) - new Date(g.startedAt) >= 20 * 60 * 1000)
      .filter(g => activePlayers(g).some(p => memberSet[p.openid]))

    const stats = {}
    members.forEach(openid => {
      stats[openid] = { profitBB: 0, rawProfit: 0, games: 0, wins: 0 }
    })
    qualifiedGames.forEach(g => {
      const bb = Math.max(1, Number(g.bigBlind) || 1)
      activePlayers(g).forEach(p => {
        if (!memberSet[p.openid]) return
        const profit = p.finalProfit ?? p.profit ?? 0
        stats[p.openid].profitBB += Math.round(profit / bb)
        stats[p.openid].rawProfit += Number(profit) || 0
        stats[p.openid].games++
        if (profit > 0) stats[p.openid].wins++
      })
    })

    const users = {}
    ;(raw.users || []).forEach(u => {
      if (!users[u._openid]) users[u._openid] = { nickname: '', avatar: '' }
      if (meaningfulNickname(u.nickname)) users[u._openid].nickname = u.nickname
      if (u.avatar) users[u._openid].avatar = u.avatar
    })
    qualifiedGames.forEach(game => {
      activePlayers(game).forEach(player => {
        if (!memberSet[player.openid]) return
        if (!users[player.openid]) users[player.openid] = { nickname: '', avatar: '' }
        if (!users[player.openid].nickname && meaningfulNickname(player.nickname)) {
          users[player.openid].nickname = player.nickname
        }
        if (!users[player.openid].avatar && player.avatar) {
          users[player.openid].avatar = player.avatar
        }
      })
    })
    const rankedEntries = Object.entries(stats)
      .filter(([, s]) => s.games > 0)
      .sort(([, a], [, b]) => b.profitBB - a.profitBB)
    const rankedSet = {}
    const rankings = rankedEntries.map(([openid, s], i) => {
      rankedSet[openid] = true
      const u = users[openid] || {}
      return {
        openid,
        nickname: u.nickname || openid,
        avatar: u.avatar || '',
        profitBB: s.profitBB,
        rawProfit: s.rawProfit,
        games: s.games,
        wins: s.wins,
        winRate: s.games ? Math.round((s.wins * 1000) / s.games) / 10 : 0,
        rank: i + 1,
        title: null
      }
    })
    members
      .filter(openid => !rankedSet[openid])
      .forEach(openid => {
        const s = stats[openid] || { profitBB: 0, rawProfit: 0, games: 0, wins: 0 }
        const u = users[openid] || {}
        rankings.push({
          openid,
          nickname: u.nickname || openid,
          avatar: u.avatar || '',
          profitBB: s.profitBB,
          rawProfit: s.rawProfit,
          games: s.games,
          wins: s.wins,
          winRate: s.games ? Math.round((s.wins * 1000) / s.games) / 10 : 0,
          rank: 0,
          title: null
        })
      })

    season.rankings = rankings
    season.gameSummaries = qualifiedGames
      .slice(-50)
      .reverse()
      .map(g => ({
        _id: g._id,
        name: g.name || '',
        playerCount: activePlayers(g).length,
        startedAt: g.startedAt,
        endedAt: g.endedAt
      }))
    season.calculatedAt = new Date()
    season.calculationMeta = { algorithmVersion: 4, qualifiedCount: qualifiedGames.length }
    db._notify('seasons', season._id)
    return {
      ok: true,
      seasonId: season._id,
      rankedCount: rankings.filter(r => r.rank > 0).length,
      qualifiedCount: qualifiedGames.length,
      algorithmVersion: 4
    }
  },

  async resetSeason({ circleId }) {
    return handlers.calcSeasonScore({ circleId })
  },

  async removeCircleMember({ circleId, targetOpenid }) {
    if (!circleId || !targetOpenid) return { ok: false, error: 'INVALID_PARAMS' }
    const db = getDb()
    const circle = (db._raw.circles || []).find(c => c._id === circleId)
    if (!circle || circle.status !== 'active') return { ok: false, error: 'NOT_FOUND' }
    if (circle.ownerOpenid !== MY_OPENID) return { ok: false, error: 'NOT_OWNER' }
    if (targetOpenid === circle.ownerOpenid) return { ok: false, error: 'OWNER_CANNOT_REMOVE' }
    if (!(circle.memberOpenids || []).includes(targetOpenid)) return { ok: false, error: 'NOT_MEMBER' }
    circle.memberOpenids = circle.memberOpenids.filter(o => o !== targetOpenid)
    if (circle.memberJoinedAt) delete circle.memberJoinedAt[targetOpenid]
    db._notify('circles', circleId)
    const calc = await handlers.calcSeasonScore({ circleId })
    return { ok: true, ...calc }
  },

  async getAvatars({ openids = [] }) {
    const db = getDb()
    const avatars = {}
    const nicknames = {}
    const profiles = {}
    for (const openid of [...new Set(openids)].filter(Boolean)) {
      const r = await db.collection('users').where({ _openid: openid }).limit(1).get()
      const u = r.data && r.data[0]
      if (u) {
        if (u.avatar) avatars[openid] = u.avatar
        if (meaningfulNickname(u.nickname)) nicknames[openid] = u.nickname
        profiles[openid] = {
          avatar: u.avatar || '',
          nickname: meaningfulNickname(u.nickname) ? u.nickname : '',
          updatedAt: u.updatedAt || u.createdAt || ''
        }
      }
    }
    return { ok: true, profiles, avatars, nicknames }
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

  wx.cloud.getTempFileURL = async function ({ fileList = [] }) {
    return {
      fileList: fileList.map(item => {
        const fileID = typeof item === 'string' ? item : item.fileID
        return { fileID, tempFileURL: fileID }
      })
    }
  }

  console.log('[cloud-mock] installed — running in DEMO MODE')
}

module.exports = { install, reset, getDb, handlers, MY_OPENID }
