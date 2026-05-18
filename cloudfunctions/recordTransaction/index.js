// cloudfunctions/recordTransaction/index.js
// 操作权限：
//   - rebuy / addOn ：参与人可给自己；庄家可给任意人
//   - eliminate     ：仅庄家
//   - revoke        ：仅庄家可锁销最近一条 rebuy/addOn（撤回到上一状态）
//   - pauseToggle / levelUp ：仅庄家
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { gameId, type, playerOpenid, amount = 0, hands: handsInput, txId } = event

  if (!gameId || !type) return { ok: false, error: 'INVALID_PARAMS' }

  const got = await db
    .collection('games')
    .doc(gameId)
    .get()
    .catch(() => null)
  if (!got || !got.data) return { ok: false, error: 'GAME_NOT_FOUND' }
  const game = got.data
  if (game.status !== 'ongoing') return { ok: false, error: 'GAME_ENDED' }

  const isHost = game.hostOpenid === OPENID
  const now = new Date()
  const players = game.players.slice()

  switch (type) {
    case 'rebuy':
    case 'addOn': {
      if (amount <= 0) return { ok: false, error: 'INVALID_AMOUNT' }
      // 权限：参与人可给自己；庄家可给任意人
      const targetOpenid = playerOpenid || OPENID
      if (!isHost && targetOpenid !== OPENID) return { ok: false, error: 'CAN_ONLY_BUY_FOR_SELF' }
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
          data: { players, totalPot: _.inc(amount) }
        })
      const tx = await db.collection('transactions').add({
        data: {
          gameId,
          type,
          playerOpenid: targetOpenid,
          amount,
          operatorOpenid: OPENID,
          byHost: isHost,
          revoked: false,
          timestamp: now,
          meta: { hands }
        }
      })
      return { ok: true, txId: tx._id }
    }

    case 'revoke': {
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
      if (!['rebuy', 'addOn'].includes(tx.type))
        return { ok: false, error: 'CANT_REVOKE_THIS_TYPE' }
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
          data: { players, totalPot: _.inc(-tx.amount) }
        })
      await db
        .collection('transactions')
        .doc(txId)
        .update({
          data: { revoked: true, revokedAt: now, revokedBy: OPENID }
        })
      return { ok: true }
    }

    case 'eliminate': {
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
          operatorOpenid: OPENID,
          byHost: true,
          revoked: false,
          timestamp: now
        }
      })
      return { ok: true }
    }

    case 'pauseToggle': {
      if (!isHost) return { ok: false, error: 'NOT_HOST' }
      const paused = !game.paused
      const update = { paused }
      if (paused) {
        update.pausedAt = now
      } else if (game.pausedAt) {
        update.pausedAccumMs = (game.pausedAccumMs || 0) + (now - new Date(game.pausedAt))
        update.pausedAt = null
      }
      await db.collection('games').doc(gameId).update({ data: update })
      return { ok: true }
    }

    case 'levelUp': {
      if (!isHost) return { ok: false, error: 'NOT_HOST' }
      const next = Math.min((game.currentLevel || 0) + 1, game.blindStructure.length - 1)
      await db
        .collection('games')
        .doc(gameId)
        .update({
          data: { currentLevel: next, levelStartedAt: now, pausedAccumMs: 0 }
        })
      return { ok: true }
    }

    default:
      return { ok: false, error: 'UNKNOWN_TYPE' }
  }
}
