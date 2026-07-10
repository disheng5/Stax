// cloudfunctions/recordTransaction/index.js
// 操作权限：
//   - rebuy / addOn ：参与人可给自己；庄家可给任意人
//   - eliminate     ：仅庄家
//   - revoke        ：仅庄家可锁销最近一条 rebuy/addOn（撤回到上一状态）
//   - pauseToggle / levelUp ：仅庄家
//
// 所有涉及 players 数组的读改写均放在数据库事务内，
// 避免多台设备同时操作时后写覆盖先写导致的丢账。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 在事务中读取 game 文档并执行 fn；fn 返回业务结果。
// 事务冲突由 runTransaction 自动重试（3 次），仍失败则返回 CONFLICT_RETRY。
async function withGameTxn(gameId, fn) {
  try {
    return await db.runTransaction(async transaction => {
      const snap = await transaction
        .collection('games')
        .doc(gameId)
        .get()
        .catch(() => null)
      if (!snap || !snap.data) return { ok: false, error: 'GAME_NOT_FOUND' }
      const game = snap.data
      if (game.status !== 'ongoing') return { ok: false, error: 'GAME_ENDED' }
      return await fn(transaction, game)
    }, 3)
  } catch (err) {
    console.error('[recordTransaction txn]', err)
    return { ok: false, error: 'CONFLICT_RETRY' }
  }
}

function addTxLog(data) {
  // 流水是展示/撤销用的账本，玩家权威数据在 game.players 上；
  // 写入失败不阻塞主流程，仅记录日志
  return db
    .collection('transactions')
    .add({ data })
    .catch(err => {
      console.error('[tx log]', err)
      return null
    })
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { gameId, type, playerOpenid, amount = 0, hands: handsInput, txId } = event

  if (!gameId || !type) return { ok: false, error: 'INVALID_PARAMS' }
  const now = new Date()

  switch (type) {
  case 'rebuy':
  case 'addOn': {
    if (amount <= 0) return { ok: false, error: 'INVALID_AMOUNT' }
    const targetOpenid = playerOpenid || OPENID
    let hands = 1
    const res = await withGameTxn(gameId, async (transaction, game) => {
      const isHost = game.hostOpenid === OPENID
      const isPlayer = (game.players || []).some(p => p.openid === OPENID)
      if (!isHost && !isPlayer) return { ok: false, error: 'NOT_PLAYER' }
      if (!isHost && game.playerOpsShared === false) return { ok: false, error: 'NOT_HOST' }
      if (!isHost && targetOpenid !== OPENID) return { ok: false, error: 'CAN_ONLY_BUY_FOR_SELF' }
      const players = game.players.slice()
      const idx = players.findIndex(p => p.openid === targetOpenid)
      if (idx < 0) return { ok: false, error: 'PLAYER_NOT_FOUND' }
      const buyIn = Number(game.buyIn) || 0
      hands =
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
      await transaction
        .collection('games')
        .doc(gameId)
        .update({
          data: { players, totalPot: (Number(game.totalPot) || 0) + amount }
        })
      return { ok: true, isHost }
    })
    if (!res.ok) return res
    const tx = await addTxLog({
      gameId,
      type,
      playerOpenid: targetOpenid,
      amount,
      operatorOpenid: OPENID,
      byHost: res.isHost,
      revoked: false,
      timestamp: now,
      meta: { hands }
    })
    return { ok: true, txId: tx && tx._id }
  }

  case 'revoke': {
    if (!txId) return { ok: false, error: 'TX_REQUIRED' }
    return await withGameTxn(gameId, async (transaction, game) => {
      if (game.hostOpenid !== OPENID) return { ok: false, error: 'NOT_HOST' }
      const txSnap = await transaction
        .collection('transactions')
        .doc(txId)
        .get()
        .catch(() => null)
      if (!txSnap || !txSnap.data) return { ok: false, error: 'TX_NOT_FOUND' }
      const tx = txSnap.data
      if (tx.gameId !== gameId) return { ok: false, error: 'TX_NOT_FOUND' }
      if (tx.revoked) return { ok: false, error: 'ALREADY_REVOKED' }
      if (!['rebuy', 'addOn'].includes(tx.type))
        return { ok: false, error: 'CANT_REVOKE_THIS_TYPE' }
      const players = game.players.slice()
      const idx = players.findIndex(p => p.openid === tx.playerOpenid)
      if (idx < 0) return { ok: false, error: 'PLAYER_NOT_FOUND' }
      const hands = Math.max(
        1,
        tx.meta?.hands || Math.round(tx.amount / (game.buyIn || tx.amount))
      )
      players[idx] = {
        ...players[idx],
        buyInCount: Math.max(1, players[idx].buyInCount - hands),
        totalBuyIn: Math.max(0, players[idx].totalBuyIn - tx.amount),
        currentStack: Math.max(0, (players[idx].currentStack || 0) - tx.amount)
      }
      await transaction
        .collection('games')
        .doc(gameId)
        .update({
          data: { players, totalPot: Math.max(0, (Number(game.totalPot) || 0) - tx.amount) }
        })
      await transaction
        .collection('transactions')
        .doc(txId)
        .update({
          data: { revoked: true, revokedAt: now, revokedBy: OPENID }
        })
      return { ok: true }
    })
  }

  case 'eliminate': {
    // 踢出 = 从 players 中彻底移除：买入从总池扣除，
    // 后续结算差额 / AA / 转账 / 战绩 / 赛季积分天然不再包含该玩家。
    // 快照存入 removedPlayers 供流水显示昵称与审计。
    let removed = null
    const res = await withGameTxn(gameId, async (transaction, game) => {
      if (game.hostOpenid !== OPENID) return { ok: false, error: 'NOT_HOST' }
      if (playerOpenid === game.hostOpenid) return { ok: false, error: 'CANT_ELIMINATE_HOST' }
      const players = game.players.slice()
      const idx = players.findIndex(p => p.openid === playerOpenid)
      if (idx < 0) return { ok: false, error: 'PLAYER_NOT_FOUND' }
      removed = players[idx]
      players.splice(idx, 1)
      const removedBuyIn = Number(removed.totalBuyIn) || 0
      await transaction
        .collection('games')
        .doc(gameId)
        .update({
          data: {
            players,
            totalPot: Math.max(0, (Number(game.totalPot) || 0) - removedBuyIn),
            removedPlayers: [
              ...(game.removedPlayers || []),
              { ...removed, removedAt: now, removedBy: OPENID }
            ]
          }
        })
      return { ok: true }
    })
    if (!res.ok) return res
    await addTxLog({
      gameId,
      type,
      playerOpenid,
      amount: -(Number(removed && removed.totalBuyIn) || 0),
      operatorOpenid: OPENID,
      byHost: true,
      revoked: false,
      timestamp: now,
      meta: {
        nickname: (removed && removed.nickname) || '',
        removedBuyIn: Number(removed && removed.totalBuyIn) || 0
      }
    })
    return { ok: true }
  }

  case 'pauseToggle': {
    return await withGameTxn(gameId, async (transaction, game) => {
      if (game.hostOpenid !== OPENID) return { ok: false, error: 'NOT_HOST' }
      const paused = !game.paused
      const update = { paused }
      if (paused) {
        update.pausedAt = now
      } else if (game.pausedAt) {
        update.pausedAccumMs = (game.pausedAccumMs || 0) + (now - new Date(game.pausedAt))
        update.pausedAt = null
      }
      await transaction.collection('games').doc(gameId).update({ data: update })
      return { ok: true, paused }
    })
  }

  case 'levelUp': {
    return await withGameTxn(gameId, async (transaction, game) => {
      if (game.hostOpenid !== OPENID) return { ok: false, error: 'NOT_HOST' }
      const next = Math.min((game.currentLevel || 0) + 1, game.blindStructure.length - 1)
      await transaction
        .collection('games')
        .doc(gameId)
        .update({
          data: { currentLevel: next, levelStartedAt: now, pausedAccumMs: 0 }
        })
      return { ok: true, level: next }
    })
  }

  default:
    return { ok: false, error: 'UNKNOWN_TYPE' }
  }
}
