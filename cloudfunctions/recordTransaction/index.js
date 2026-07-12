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
const OPERATION_ID_LIMIT = 50

function normalizeOperationId(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  return /^[a-zA-Z0-9_-]{8,64}$/.test(id) ? id : ''
}

function hasOperation(game, operationId) {
  return !!operationId && (game.recentOperationIds || []).includes(operationId)
}

function operationUpdate(game, operationId) {
  if (!operationId) return {}
  const ids = (game.recentOperationIds || []).filter(id => id !== operationId)
  ids.push(operationId)
  return { recentOperationIds: ids.slice(-OPERATION_ID_LIMIT) }
}

function operationMeta(operationId) {
  return operationId ? { operationId } : {}
}

function receiptId(gameId, operationId) {
  return `${gameId}:${operationId}`
}

// 结果裁剪：回执只保存可安全重放的业务结果，剔除 game 快照等大对象。
function receiptResult(result) {
  if (!result || typeof result !== 'object') return result
  const clone = { ...result }
  delete clone.game
  return clone
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

function resolveNickname(game, openid) {
  const player = (game.players || []).find(p => p.openid === openid)
  return player?.nickname || ''
}

// 在事务中读取 game 文档并执行 fn；fn 返回业务结果。
// 事务冲突由 runTransaction 自动重试（3 次），仍失败则返回 CONFLICT_RETRY。
//
// 持久幂等：有 operationId 时，先查 opReceipts 命中即返回原结果（idempotent:true）；
// 事务成功后写回执。无 operationId 时保持旧行为（旧客户端不受影响）。
// recentOperationIds 内存窗口保留作为同一 game 文档内的快速路径。
async function withGameTxn(gameId, operationId, actorOpenid, fn) {
  if (operationId) {
    const receiptSnap = await db
      .collection('opReceipts')
      .doc(receiptId(gameId, operationId))
      .get()
      .catch(() => null)
    if (receiptSnap && receiptSnap.data && receiptSnap.data.result) {
      return { ...receiptSnap.data.result, idempotent: true, operationId }
    }
  }
  try {
    return await db.runTransaction(async transaction => {
      const snap = await transaction
        .collection('games')
        .doc(gameId)
        .get()
        .catch(() => null)
      if (!snap || !snap.data) return { ok: false, error: 'GAME_NOT_FOUND' }
      const game = snap.data
      const isParticipant =
        game.hostOpenid === actorOpenid ||
        (game.players || []).some(player => player.openid === actorOpenid)
      if (!isParticipant) return { ok: false, error: 'NOT_PLAYER' }
      if (hasOperation(game, operationId)) {
        return { ok: true, idempotent: true, operationId, game }
      }
      if (game.status !== 'ongoing') return { ok: false, error: 'GAME_ENDED' }
      const result = await fn(transaction, game)
      if (operationId && result && result.ok) {
        await transaction
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
      return result
    }, 3)
  } catch (err) {
    console.error('[recordTransaction txn]', err)
    return { ok: false, error: 'CONFLICT_RETRY' }
  }
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { gameId, type, playerOpenid, amount: rawAmount = 0, hands: handsInput, txId } = event
  const amount = Number(rawAmount)
  const operationId = normalizeOperationId(event.operationId)

  if (!gameId || !type) return { ok: false, error: 'INVALID_PARAMS' }
  const now = new Date()

  /* eslint-disable indent -- Prettier and ESLint disagree on switch-case indentation. */
  switch (type) {
    case 'rebuy':
    case 'addOn': {
      if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'INVALID_AMOUNT' }
      const targetOpenid = playerOpenid || OPENID
      let hands = 1
      const res = await withGameTxn(gameId, operationId, OPENID, async (transaction, game) => {
        const isHost = game.hostOpenid === OPENID
        const isPlayer = (game.players || []).some(p => p.openid === OPENID)
        if (!isHost && !isPlayer) return { ok: false, error: 'NOT_PLAYER' }
        if (!isHost && game.playerOpsShared === false) return { ok: false, error: 'NOT_HOST' }
        if (!isHost && targetOpenid !== OPENID) return { ok: false, error: 'CAN_ONLY_BUY_FOR_SELF' }
        const players = game.players.slice()
        const idx = players.findIndex(p => p.openid === targetOpenid)
        if (idx < 0) return { ok: false, error: 'PLAYER_NOT_FOUND' }
        const buyIn = Number(game.buyIn) || 0
        hands = Math.min(
          99,
          Number(handsInput) > 0
            ? Math.floor(Number(handsInput))
            : buyIn > 0
              ? Math.max(1, Math.round(amount / buyIn))
              : 1
        )
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
          totalPot: (Number(game.totalPot) || 0) + amount,
          checkedOutCount: settledCount,
          settledCount,
          txSeq: seq,
          txRevision: nextTxRevision(game),
          stateRevision: nextStateRevision(game),
          ...operationUpdate(game, operationId)
        }
        await transaction.collection('games').doc(gameId).update({ data: update })
        const tx = await transaction.collection('transactions').add({
          data: {
            gameId,
            type,
            playerOpenid: targetOpenid,
            amount,
            operatorOpenid: OPENID,
            operatorNicknameSnapshot: resolveNickname(game, OPENID),
            byHost: isHost,
            revoked: false,
            timestamp: now,
            operationSequence: seq,
            beforeHands: Number(previous.buyInCount) || 0,
            afterHands: (Number(previous.buyInCount) || 0) + hands,
            meta: { hands },
            ...operationMeta(operationId)
          }
        })
        return { ok: true, isHost, txId: tx && tx._id, game: { ...game, ...update } }
      })
      return res
    }

    case 'revoke': {
      if (!txId) return { ok: false, error: 'TX_REQUIRED' }
      return await withGameTxn(gameId, operationId, OPENID, async (transaction, game) => {
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
        const update = {
          players,
          totalPot: Math.max(0, (Number(game.totalPot) || 0) - tx.amount),
          txSeq: nextTxSeq(game),
          txRevision: nextTxRevision(game),
          stateRevision: nextStateRevision(game),
          ...operationUpdate(game, operationId)
        }
        await transaction.collection('games').doc(gameId).update({ data: update })
        await transaction
          .collection('transactions')
          .doc(txId)
          .update({
            data: {
              revoked: true,
              revokedAt: now,
              revokedBy: OPENID,
              revokedByNicknameSnapshot: resolveNickname(game, OPENID),
              ...(operationId ? { revokeOperationId: operationId } : {})
            }
          })
        return { ok: true, game: { ...game, ...update } }
      })
    }

    case 'eliminate': {
      // 踢出 = 从 players 中彻底移除：买入从总池扣除，
      // 后续结算差额 / AA / 转账 / 战绩 / 赛季积分天然不再包含该玩家。
      // 快照存入 removedPlayers 供流水显示昵称与审计。
      let removed = null
      const res = await withGameTxn(gameId, operationId, OPENID, async (transaction, game) => {
        if (game.hostOpenid !== OPENID) return { ok: false, error: 'NOT_HOST' }
        if (playerOpenid === game.hostOpenid) return { ok: false, error: 'CANT_ELIMINATE_HOST' }
        const players = game.players.slice()
        const idx = players.findIndex(p => p.openid === playerOpenid)
        if (idx < 0) return { ok: false, error: 'PLAYER_NOT_FOUND' }
        removed = players[idx]
        players.splice(idx, 1)
        const removedBuyIn = Number(removed.totalBuyIn) || 0
        const seq = nextTxSeq(game)
        const update = {
          players,
          totalPot: Math.max(0, (Number(game.totalPot) || 0) - removedBuyIn),
          removedPlayers: [
            ...(game.removedPlayers || []),
            { ...removed, removedAt: now, removedBy: OPENID }
          ],
          txSeq: seq,
          txRevision: nextTxRevision(game),
          stateRevision: nextStateRevision(game),
          ...operationUpdate(game, operationId)
        }
        await transaction.collection('games').doc(gameId).update({ data: update })
        const tx = await transaction.collection('transactions').add({
          data: {
            gameId,
            type,
            playerOpenid,
            amount: -removedBuyIn,
            operatorOpenid: OPENID,
            operatorNicknameSnapshot: resolveNickname(game, OPENID),
            byHost: true,
            revoked: false,
            timestamp: now,
            operationSequence: seq,
            meta: {
              nickname: removed.nickname || '',
              removedBuyIn
            },
            ...operationMeta(operationId)
          }
        })
        return { ok: true, txId: tx && tx._id, game: { ...game, ...update } }
      })
      return res
    }

    case 'pauseToggle': {
      return await withGameTxn(gameId, operationId, OPENID, async (transaction, game) => {
        if (game.hostOpenid !== OPENID) return { ok: false, error: 'NOT_HOST' }
        const paused = !game.paused
        const update = { paused, stateRevision: nextStateRevision(game) }
        if (paused) {
          update.pausedAt = now
        } else if (game.pausedAt) {
          update.pausedAccumMs = (game.pausedAccumMs || 0) + (now - new Date(game.pausedAt))
          update.pausedAt = null
        }
        Object.assign(update, operationUpdate(game, operationId))
        await transaction.collection('games').doc(gameId).update({ data: update })
        return { ok: true, paused }
      })
    }

    case 'levelUp': {
      return await withGameTxn(gameId, operationId, OPENID, async (transaction, game) => {
        if (game.hostOpenid !== OPENID) return { ok: false, error: 'NOT_HOST' }
        const next = Math.min((game.currentLevel || 0) + 1, game.blindStructure.length - 1)
        await transaction
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
        return { ok: true, level: next }
      })
    }

    default:
      return { ok: false, error: 'UNKNOWN_TYPE' }
  }
  /* eslint-enable indent */
}
