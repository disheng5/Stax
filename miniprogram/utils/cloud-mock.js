// utils/cloud-mock.js — 接管 wx.cloud.callFunction，本地实现所有云函数逻辑
//
// 用法：
//   require('./cloud-mock.js').install()
// 之后 wx.cloud.callFunction 全部走本地，不发出网络请求。

const { createMockDb } = require('./db-mock.js')
const { buildSeed, MY_OPENID } = require('./mock-data.js')
const { computeShares } = require('./aa.js')
const { generateInviteCode } = require('./invite-code.js')
const { recoverLegacyNickname } = require('./game-name.js')
const { buildSeasonView } = require('./season-view.js')
const { computeAnalytics, buildTrendNote } = require('./analytics.js')

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

function nextTxRevision(game) {
  return Math.max(0, Number(game.txRevision) || 0) + 1
}

function nextStateRevision(game) {
  return Math.max(0, Number(game.stateRevision ?? game.txRevision) || 0) + 1
}

function nextTxSeq(game) {
  return Math.max(0, Number(game.txSeq) || 0) + 1
}

function receiptId(gameId, operationId) {
  return `${gameId}:${operationId}`
}

function receiptResult(result) {
  if (!result || typeof result !== 'object') return result
  const clone = { ...result }
  delete clone.game
  return clone
}

// 持久幂等回执：有 operationId 时先查回执命中即返回；成功后写回执。
async function readReceipt(db, gameId, operationId) {
  if (!operationId) return null
  const snap = await db
    .collection('opReceipts')
    .doc(receiptId(gameId, operationId))
    .get()
    .catch(() => null)
  if (snap && snap.data && snap.data.result) {
    return { ...snap.data.result, idempotent: true, operationId }
  }
  return null
}

async function writeReceipt(db, gameId, operationId, result) {
  if (!operationId || !result || !result.ok) return
  await db
    .collection('opReceipts')
    .doc(receiptId(gameId, operationId))
    .set({
      data: {
        gameId,
        operationId,
        result: receiptResult(result),
        createdAt: new Date()
      }
    })
    .catch(() => null)
}

function mockNickname(game, openid) {
  return (game.players || []).find(p => p.openid === openid)?.nickname || ''
}

function normalizeExpenseMode(value) {
  if (['winner', 'winnerRatio', 'winnerByRatio'].includes(value)) return 'winner'
  if (['winnerEven', 'winnersEven'].includes(value)) return 'winnerEven'
  if (value === 'mvp') return 'mvp'
  if (['all', 'even'].includes(value)) return 'all'
  // 与线上一致：未知取值回退产品默认「水上比例」
  return 'winner'
}

// 与线上一致：结束后 3 小时内允许修改结算积分/费用
const EDIT_WINDOW_MS = 3 * 60 * 60 * 1000
function withinEditWindow(game, now) {
  if (!game.endedAt) return false
  const endedAt = +new Date(game.endedAt)
  return Number.isFinite(endedAt) && now - endedAt <= EDIT_WINDOW_MS
}

function profileTime(value) {
  const n = +new Date(value || 0)
  return Number.isFinite(n) ? n : 0
}

function latestGameProfile(games) {
  const profiles = (games || [])
    .map(game => {
      const player = (game.players || []).find(item => item.openid === MY_OPENID)
      if (!player) return null
      return {
        nickname: player.nickname,
        avatar: player.avatar || '',
        updatedAt:
          player.profileUpdatedAt || game.profileUpdatedAt || game.endedAt || game.startedAt || ''
      }
    })
    .filter(Boolean)
    .sort((a, b) => profileTime(b.updatedAt) - profileTime(a.updatedAt))
  return {
    nickname: (profiles.find(item => meaningfulNickname(item.nickname)) || {}).nickname || '',
    avatar: (profiles.find(item => item.avatar) || {}).avatar || ''
  }
}

async function currentProfile(fallbackNickname = '', fallbackAvatar = '', rawName = '') {
  const db = getDb()
  const result = await db.collection('users').where({ _openid: MY_OPENID }).limit(100).get()
  const users = result.data || []
  const server = users.find(user => meaningfulNickname(user.nickname)) || users[0] || {}
  const hasStoredIdentity = meaningfulNickname(server.nickname)
  let nickname = hasStoredIdentity ? server.nickname.trim() : ''
  let avatar = hasStoredIdentity ? server.avatar || '' : server.avatar || fallbackAvatar || ''
  let recovered = false

  if (!nickname && meaningfulNickname(fallbackNickname)) {
    nickname = fallbackNickname.trim()
    recovered = true
  }
  if (!nickname) {
    const legacyNickname = recoverLegacyNickname(rawName)
    if (meaningfulNickname(legacyNickname)) {
      nickname = legacyNickname
      recovered = true
    }
  }
  if (!hasStoredIdentity && (!nickname || !avatar)) {
    const history = latestGameProfile(db._raw.games)
    if (!nickname && meaningfulNickname(history.nickname)) {
      nickname = history.nickname.trim()
      recovered = true
    }
    if (!avatar && history.avatar) avatar = history.avatar
  }

  if (recovered && meaningfulNickname(nickname)) {
    const data = { nickname, avatar, updatedAt: new Date(), profileVersion: 2 }
    if (users.length) {
      await Promise.all(users.map(user => db.collection('users').doc(user._id).update({ data })))
    } else {
      await db.collection('users').add({
        data: {
          ...data,
          createdAt: new Date(),
          stats: { totalGames: 0, totalProfit: 0, biggestWin: 0, biggestLoss: 0, wins: 0 }
        }
      })
    }
  }
  return { nickname, avatar }
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
        (canBootstrap && !meaningfulNickname(user.nickname) && meaningfulNickname(bootstrapNickname)
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
    const rawName = typeof name === 'string' ? name.trim() : ''
    if (!rawName) return { ok: false, error: 'INVALID_NAME' }
    const normalizedName = rawName
    const db = getDb()
    const profile = await currentProfile(nickname, avatar, rawName)
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
    const game = {
      hostOpenid: MY_OPENID,
      name: normalizedName,
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
      txRevision: 1,
      stateRevision: 1,
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
    const created = await db.collection('games').add({ data: game })
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
    return { ok: true, gameId: created._id, inviteCode, game: { ...game, _id: created._id } }
  },

  async joinGame({ inviteCode, nickname = '玩家', avatar = '', mode = 'player', hands = 1 }) {
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
      return { ok: true, gameId: game._id, alreadyJoined: true, game }
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
    const seq = nextTxSeq(game)
    const update = {
      players: [...game.players, player],
      totalPot: game.totalPot + amount,
      txSeq: seq,
      txRevision: nextTxRevision(game),
      stateRevision: nextStateRevision(game)
    }
    await db.collection('games').doc(game._id).update({ data: update })
    await db.collection('transactions').add({
      data: {
        gameId: game._id,
        type: 'buyIn',
        playerOpenid: MY_OPENID,
        amount,
        operatorOpenid: MY_OPENID,
        operatorNicknameSnapshot: player.nickname || '',
        byHost: false,
        revoked: false,
        timestamp: now,
        operationSequence: seq,
        beforeHands: 0,
        afterHands: buyHands,
        meta: { hands: buyHands }
      }
    })
    return { ok: true, gameId: game._id, game: { ...game, ...update } }
  },

  async recordTransaction(event = {}) {
    const { gameId, operationId: rawOperationId } = event
    const operationId = normalizeOperationId(rawOperationId)
    const db = getDb()
    const cached = await readReceipt(db, gameId, operationId)
    if (cached) return cached
    const result = await this._recordTransactionCore(event)
    await writeReceipt(db, gameId, operationId, result)
    return result
  },

  async _recordTransactionCore({
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
      return { ok: true, idempotent: true, operationId, game }
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
      const previous = players[idx]
      players[idx] = {
        ...previous,
        buyInCount: (Number(previous.buyInCount) || 0) + hands,
        totalBuyIn: (Number(previous.totalBuyIn) || 0) + amount,
        currentStack: (Number(previous.currentStack) || 0) + amount,
        finalStack: null,
        profit: 0,
        finalProfit: null,
        share: 0,
        checkedOutAt: null,
        eliminatedAt: null
      }
      const settledCount = players.filter(
        player => player.finalStack !== null && player.finalStack !== undefined
      ).length
      const seq = nextTxSeq(game)
      const update = {
        players,
        totalPot: game.totalPot + amount,
        checkedOutCount: settledCount,
        settledCount,
        txSeq: seq,
        txRevision: nextTxRevision(game),
        stateRevision: nextStateRevision(game),
        ...operationUpdate(game, operationId)
      }
      await db.collection('games').doc(gameId).update({ data: update })
      const tx = await db.collection('transactions').add({
        data: {
          gameId,
          type,
          playerOpenid: targetOpenid,
          amount,
          operatorOpenid: MY_OPENID,
          operatorNicknameSnapshot: mockNickname(game, MY_OPENID),
          byHost: isHost,
          revoked: false,
          timestamp: now,
          operationSequence: seq,
          beforeHands: Number(previous.buyInCount) || 0,
          afterHands: (Number(previous.buyInCount) || 0) + hands,
          meta: { hands },
          ...(operationId ? { operationId } : {})
        }
      })
      return { ok: true, txId: tx._id, game: { ...game, ...update } }
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
      const update = {
        players,
        totalPot: game.totalPot - tx.amount,
        txSeq: nextTxSeq(game),
        txRevision: nextTxRevision(game),
        stateRevision: nextStateRevision(game),
        ...operationUpdate(game, operationId)
      }
      await db.collection('games').doc(gameId).update({ data: update })
      await db
        .collection('transactions')
        .doc(txId)
        .update({
          data: {
            revoked: true,
            revokedAt: now,
            revokedBy: MY_OPENID,
            revokedByNicknameSnapshot: mockNickname(game, MY_OPENID),
            ...(operationId ? { revokeOperationId: operationId } : {})
          }
        })
      return { ok: true, game: { ...game, ...update } }
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
      const seq = nextTxSeq(game)
      const update = {
        players,
        totalPot: Math.max(0, (game.totalPot || 0) - removedBuyIn),
        removedPlayers: [
          ...(game.removedPlayers || []),
          { ...removed, removedAt: now, removedBy: MY_OPENID }
        ],
        txSeq: seq,
        txRevision: nextTxRevision(game),
        stateRevision: nextStateRevision(game),
        ...operationUpdate(game, operationId)
      }
      await db.collection('games').doc(gameId).update({ data: update })
      await db.collection('transactions').add({
        data: {
          gameId,
          type,
          playerOpenid,
          amount: -removedBuyIn,
          operatorOpenid: MY_OPENID,
          operatorNicknameSnapshot: mockNickname(game, MY_OPENID),
          byHost: true,
          revoked: false,
          timestamp: now,
          operationSequence: seq,
          meta: { nickname: removed.nickname || '', removedBuyIn },
          ...(operationId ? { operationId } : {})
        }
      })
      return { ok: true, game: { ...game, ...update } }
    }
    if (type === 'pauseToggle') {
      if (!isHost) return { ok: false, error: 'NOT_HOST' }
      const paused = !game.paused
      const update = { paused, stateRevision: nextStateRevision(game) }
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
            stateRevision: nextStateRevision(game),
            ...operationUpdate(game, operationId)
          }
        })
      return { ok: true }
    }
    return { ok: false, error: 'UNKNOWN_TYPE' }
  },

  async settleGame(event = {}) {
    const operationId = normalizeOperationId(event.operationId)
    const db = getDb()
    const cached = await readReceipt(db, event.gameId, operationId)
    if (cached) return cached
    const result = await this._settleGameCore(event)
    await writeReceipt(db, event.gameId, operationId, result)
    return result
  },

  async _settleGameCore(event = {}) {
    const { gameId, finalStacks } = event
    // 与线上一致：按载荷形状推断意图，绝不按 mode 名称拒绝（契约红线）
    const hasExtraCost = event.extraCost !== undefined && event.extraCost !== null
    const hasExpenseMode = !!(event.expenseMode || event.aaMode)
    const extraCost = hasExtraCost ? Number(event.extraCost) : 0
    const expenseMode = hasExpenseMode
      ? normalizeExpenseMode(event.expenseMode || event.aaMode)
      : 'all'
    if (!gameId) return { ok: false, error: 'INVALID_PARAMS' }
    if (hasExtraCost && (!Number.isFinite(extraCost) || extraCost < 0))
      return { ok: false, error: 'INVALID_EXTRA_COST' }
    const submittedOpenids = []
    const normalizedStacks = {}
    if (finalStacks && typeof finalStacks === 'object') {
      for (const openid of Object.keys(finalStacks)) {
        const v = finalStacks[openid]
        if (v === '' || v === null || v === undefined) continue
        const stack = Number(v)
        if (!Number.isFinite(stack) || stack < 0) return { ok: false, error: 'INVALID_STACK' }
        submittedOpenids.push(openid)
        normalizedStacks[openid] = stack
      }
    }
    let mode
    if (event.mode === 'finalize') {
      mode = 'finalize'
      if (!submittedOpenids.length) return { ok: false, error: 'NO_STACKS_SUBMITTED' }
    } else if (submittedOpenids.length) {
      mode = 'checkout'
    } else if (hasExtraCost) {
      mode = 'expense'
    } else {
      return { ok: false, error: 'NO_STACKS_SUBMITTED' }
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
      : game.expenseMode || game.aaMode
        ? normalizeExpenseMode(game.expenseMode || game.aaMode)
        : 'winner'

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
      players = players.map(p => {
        if (p.eliminatedAt) return p
        return {
          ...p,
          share: shareMap[p.openid] || 0,
          finalProfit: p.profit
        }
      })
    }
    const settledAll = players.filter(
      p => p.finalStack !== null && p.finalStack !== undefined
    ).length
    const writesTransactions = submittedOpenids.length > 0
    const emitsTransactions = writesTransactions
    const prevPlayers = game.players || []
    const seqBase = Math.max(0, Number(game.txSeq) || 0)
    let seqCursor = seqBase
    const operatorNickname = mockNickname(game, MY_OPENID)
    const txCount = submittedOpenids.length
    const update = {
      players,
      extraCost: effExtraCost,
      expenseMode: effExpenseMode,
      aaMode: effExpenseMode,
      shareTotal: shares.reduce((s, x) => s + (x.share || 0), 0),
      checkedOutCount: settledAll,
      settledCount: settledAll,
      stateRevision: nextStateRevision(game),
      ...(emitsTransactions ? { txSeq: seqBase + txCount, txRevision: nextTxRevision(game) } : {}),
      ...operationUpdate(game, operationId)
    }
    if (justEnded) {
      update.status = 'ended'
      update.endedAt = now
    }
    await db.collection('games').doc(gameId).update({ data: update })
    for (const openid of submittedOpenids) {
      const prevPlayer = prevPlayers.find(p => p.openid === openid)
      const beforeValue =
        prevPlayer && prevPlayer.finalStack !== null && prevPlayer.finalStack !== undefined
          ? prevPlayer.finalStack
          : null
      seqCursor++
      await db.collection('transactions').add({
        data: {
          gameId,
          type: ended ? 'settle' : 'settlePartial',
          playerOpenid: openid,
          amount: normalizedStacks[openid],
          operatorOpenid: MY_OPENID,
          operatorNicknameSnapshot: operatorNickname,
          byHost: game.hostOpenid === MY_OPENID,
          revoked: false,
          timestamp: now,
          operationSequence: seqCursor,
          beforeValue,
          afterValue: normalizedStacks[openid],
          meta: { mode, expenseMode: effExpenseMode, extraCost: effExtraCost, edited },
          ...(operationId ? { operationId } : {})
        }
      })
    }
    // 费用分摊只在费用块呈现，不在流水另记一条（与线上一致）。
    return {
      ok: true,
      ended,
      justEnded,
      edited,
      diff,
      players,
      game: { ...game, ...update, players }
    }
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
          `${durationMin} 分钟，${facts.playerCount} 个人，一起把一个晚上认真地过完了。`,
          `${durationMin} 分钟一局，${facts.playerCount} 人同桌，牌是媒介，人才是主角。`
        ])
      )
    else lines.push(`${facts.playerCount} 人小聚，节奏不快，重在同桌。`)
    if (facts.bigWinner) {
      const w = facts.bigWinner
      const wPct = totalPot ? Math.round((w.profit / totalPot) * 100) : 0
      lines.push(
        pick([
          `今晚状态最好的是 ${w.nickname}（约占总池 ${wPct}%）。顺手的时候，节奏往往比运气更值得留意。`,
          `${w.nickname} 今晚发挥出色。结果在短期里很响，决策质量通常更安静。`
        ])
      )
    }
    if (totalRebuys >= facts.playerCount)
      lines.push(`全场补了 ${totalRebuys} 次码，牌局节奏偏活跃，大家都愿意再试试手感。`)
    else if (totalRebuys === 0) lines.push('全场零补码，整体偏稳健——稳定本身也是一种风格。')
    if (me) {
      const v = me.finalProfit ?? me.profit
      if (v > 0) lines.push(`你今晚 +${v}，是不错的一晚。可以留意哪一手的放弃事后觉得最正确。`)
      else if (v < 0)
        lines.push(
          `你今晚 ${v}。单局结果的波动是正常表现，不足以定义长期水平；下一次只观察一个可控变量就好。`
        )
      else lines.push('你今晚账面持平，重在同桌的这段时间。')
    }
    if (facts.extraCost > 0) {
      const label = facts.expenseMode === 'winner' ? '水上比例' : '全员均摊'
      lines.push(`其他费用 ${facts.extraCost} 按「${label}」记账，不计入盈亏。`)
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
          rankings: [],
          excludedGameIds: [],
          exclusionScopeVersion: 1,
          exclusionRevision: 0
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
    const excludedGameIds = new Set(season.excludedGameIds || [])
    const needsLegacyMigration = season.exclusionScopeVersion !== 1
    const candidateGames = (raw.games || [])
      .filter(g => g.status === 'ended')
      .filter(g => new Date(g.endedAt || g.startedAt) >= queryStart)
      .filter(g => new Date(g.endedAt || g.startedAt) < seasonEnd)
      .filter(g => activePlayers(g).length >= 4)
      .filter(g => new Date(g.endedAt) - new Date(g.startedAt) >= 20 * 60 * 1000)
      .filter(g => activePlayers(g).some(p => memberSet[p.openid]))
    if (needsLegacyMigration) {
      candidateGames.filter(g => g.excludeFromSeason).forEach(g => excludedGameIds.add(g._id))
    }
    const qualifiedGames = candidateGames.filter(g => !excludedGameIds.has(g._id))

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
    season.excludedGameIds = [...excludedGameIds]
    season.exclusionScopeVersion = 1
    season.exclusionRevision = Math.max(0, Number(season.exclusionRevision) || 0)
    season.gameSummaries = candidateGames
      .slice(-50)
      .reverse()
      .map(g => ({
        _id: g._id,
        name: g.name || '',
        playerCount: activePlayers(g).length,
        startedAt: g.startedAt,
        endedAt: g.endedAt,
        excluded: excludedGameIds.has(g._id)
      }))
    season.calculatedAt = new Date()
    season.calculationMeta = { algorithmVersion: 5, qualifiedCount: qualifiedGames.length }
    db._notify('seasons', season._id)
    return {
      ok: true,
      seasonId: season._id,
      rankedCount: rankings.filter(r => r.rank > 0).length,
      qualifiedCount: qualifiedGames.length,
      algorithmVersion: 5
    }
  },

  async resetSeason({ circleId }) {
    return handlers.calcSeasonScore({ circleId })
  },

  async excludeGame({ gameId, circleId, exclude = true }) {
    if (!gameId) return { ok: false, error: 'INVALID_PARAMS' }
    const db = getDb()
    const raw = db._raw
    const game = (raw.games || []).find(g => g._id === gameId)
    if (!game) return { ok: false, error: 'NOT_FOUND' }
    const legacy = !circleId
    let circles
    if (legacy) {
      if (game.hostOpenid !== MY_OPENID) return { ok: false, error: 'NOT_HOST' }
      circles = (raw.circles || []).filter(
        circle =>
          circle.status === 'active' &&
          circle.currentSeasonId &&
          (game.players || []).some(p => (circle.memberOpenids || []).includes(p.openid))
      )
      game.excludeFromSeason = !!exclude
      db._notify('games', gameId)
    } else {
      const circle = (raw.circles || []).find(c => c._id === circleId)
      if (!circle || circle.status !== 'active') return { ok: false, error: 'NOT_FOUND' }
      if (circle.ownerOpenid !== MY_OPENID) return { ok: false, error: 'NOT_HOST' }
      if (!(game.players || []).some(p => (circle.memberOpenids || []).includes(p.openid))) {
        return { ok: false, error: 'GAME_NOT_IN_CIRCLE' }
      }
      circles = [circle]
    }
    let firstSeasonId = ''
    for (const circle of circles) {
      const season = (raw.seasons || []).find(s => s._id === circle.currentSeasonId)
      if (!season || season.status !== 'ongoing') {
        if (!legacy) return { ok: false, error: 'NO_ACTIVE_SEASON' }
        continue
      }
      if (season.exclusionScopeVersion !== 1) {
        const migration = await handlers.calcSeasonScore({ circleId: circle._id })
        if (!migration.ok) {
          if (!legacy) return migration
          continue
        }
      }
      const ids = new Set(season.excludedGameIds || [])
      if (exclude) ids.add(gameId)
      else ids.delete(gameId)
      season.excludedGameIds = [...ids]
      season.exclusionScopeVersion = 1
      season.exclusionRevision = Math.max(0, Number(season.exclusionRevision) || 0) + 1
      firstSeasonId = firstSeasonId || season._id
      db._notify('seasons', season._id)
      await handlers.calcSeasonScore({ circleId: circle._id })
    }
    return {
      ok: true,
      circleId: circleId || '',
      seasonId: firstSeasonId,
      excluded: !!exclude,
      legacy
    }
  },

  async getSeasonView(event = {}) {
    const { circleId } = event || {}
    if (!circleId) return { ok: false, error: 'INVALID_PARAMS' }
    const raw = getDb()._raw
    const circle = (raw.circles || []).find(c => c._id === circleId)
    if (!circle) return { ok: false, error: 'CIRCLE_NOT_FOUND' }
    const memberOpenids = circle.memberOpenids || []
    if (!memberOpenids.includes(MY_OPENID)) return { ok: false, error: 'NOT_MEMBER' }
    const seasonId = event.seasonId || circle.currentSeasonId
    const season = seasonId ? (raw.seasons || []).find(s => s._id === seasonId) || null : null
    const memberProfiles = memberOpenids.map(openid => {
      const u = (raw.users || []).find(x => x._openid === openid) || {}
      return {
        openid,
        nickname: u.nickname || '',
        avatar: u.avatar || '',
        profileUpdatedAt: u.updatedAt || u.profileUpdatedAt || u.createdAt || ''
      }
    })
    const excluded = new Set(season?.excludedGameIds || [])
    const start = season ? new Date(season.startAt) : null
    const end = season ? new Date(season.endAt) : null
    const myGames = (raw.games || [])
      .filter(g => {
        if (g.status !== 'ended') return false
        if (!(g.players || []).some(p => p.openid === MY_OPENID)) return false
        // 已删除（对本人隐藏）的记录不出现在任何列表里
        if ((g.hiddenForOpenids || []).includes(MY_OPENID)) return false
        if (start && end) {
          const t = new Date(g.endedAt)
          if (!(t >= start && t < end)) return false
        }
        return true
      })
      .sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt))
      .map(g => {
        const active = (g.players || []).filter(p => !p.eliminatedAt)
        const me = active.find(p => p.openid === MY_OPENID)
        return {
          _id: g._id,
          name: g.name || '',
          playerCount: active.length,
          startedAt: g.startedAt,
          endedAt: g.endedAt,
          myProfit: me ? Number(me.finalProfit ?? me.profit) || 0 : 0,
          counted: !excluded.has(g._id) && !g.excludeFromSeason
        }
      })
    return buildSeasonView({ season, circle, memberProfiles, myGames, viewerOpenid: MY_OPENID })
  },

  async getMyAnalytics() {
    const raw = getDb()._raw
    const games = (raw.games || []).filter(
      g =>
        g.status === 'ended' &&
        (g.players || []).some(p => p.openid === MY_OPENID) &&
        !(g.hiddenForOpenids || []).includes(MY_OPENID)
    )
    const analytics = computeAnalytics(games, MY_OPENID)
    const scores = games
      .slice()
      .sort((a, b) => new Date(a.endedAt || a.startedAt) - new Date(b.endedAt || b.startedAt))
      .map(g => {
        const me = (g.players || []).find(p => p.openid === MY_OPENID)
        if (!me) return null
        const ratio = Number(g.scoreRatio) > 0 ? Number(g.scoreRatio) : 1
        return Math.round((me.finalProfit ?? me.profit ?? 0) / ratio)
      })
      .filter(s => s !== null)
    const recent = scores.slice(-5)
    const prev = scores.slice(-10, -5)
    const recentSum = recent.reduce((s, v) => s + v, 0)
    const prevSum = prev.reduce((s, v) => s + v, 0)
    const best = scores.length ? Math.max(...scores) : 0
    const worst = scores.length ? Math.min(...scores) : 0
    const direction = recentSum > prevSum ? 'up' : recentSum < prevSum ? 'down' : 'flat'
    const signals = { sampleCount: scores.length, recentSum, prevSum, best, worst, direction }
    return {
      ok: true,
      stats: analytics.stats,
      dimensions: analytics.dimensions,
      trend: { recentSum, prevSum, best, worst, direction },
      note: buildTrendNote(signals),
      meta: analytics.meta
    }
  },

  async getGameView(event = {}) {
    const { gameId, inviteCode } = event || {}
    if (!gameId) return { ok: false, error: 'INVALID_PARAMS' }
    const raw = getDb()._raw
    const game = (raw.games || []).find(g => g._id === gameId)
    if (!game) return { ok: false, error: 'GAME_NOT_FOUND' }
    const isPlayer =
      game.hostOpenid === MY_OPENID || (game.players || []).some(p => p.openid === MY_OPENID)
    const codeMatches =
      !!inviteCode && !!game.inviteCode && String(inviteCode).toUpperCase() === game.inviteCode
    const ended = game.status === 'ended'
    if (isPlayer) return { ok: true, role: 'player', game: { ...game }, canJoin: false }
    if (codeMatches) {
      return {
        ok: true,
        role: ended ? 'viewerEnded' : 'viewer',
        game: { ...game },
        canJoin: !ended
      }
    }
    return { ok: false, error: 'NOT_AUTHORIZED' }
  },

  async removeCircleMember({ circleId, targetOpenid }) {
    if (!circleId || !targetOpenid) return { ok: false, error: 'INVALID_PARAMS' }
    const db = getDb()
    const circle = (db._raw.circles || []).find(c => c._id === circleId)
    if (!circle || circle.status !== 'active') return { ok: false, error: 'NOT_FOUND' }
    if (circle.ownerOpenid !== MY_OPENID) return { ok: false, error: 'NOT_OWNER' }
    if (targetOpenid === circle.ownerOpenid) return { ok: false, error: 'OWNER_CANNOT_REMOVE' }
    if (!(circle.memberOpenids || []).includes(targetOpenid))
      return { ok: false, error: 'NOT_MEMBER' }
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
      const result = await fn.call(handlers, data)
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
