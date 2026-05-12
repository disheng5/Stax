// cloudfunctions/recordTransaction/index.js — rebuy / addOn / eliminate / 升盲 / 暂停
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { gameId, type, playerOpenid, amount = 0 } = event

  if (!gameId || !type) return { ok: false, error: 'INVALID_PARAMS' }

  const got = await db.collection('games').doc(gameId).get().catch(() => null)
  if (!got || !got.data) return { ok: false, error: 'GAME_NOT_FOUND' }
  const game = got.data
  if (game.status !== 'ongoing') return { ok: false, error: 'GAME_ENDED' }
  if (game.hostOpenid !== OPENID) return { ok: false, error: 'NOT_HOST' }

  const now = new Date()
  const players = game.players.slice()

  switch (type) {
    case 'rebuy':
    case 'addOn': {
      if (amount <= 0) return { ok: false, error: 'INVALID_AMOUNT' }
      const idx = players.findIndex(p => p.openid === playerOpenid)
      if (idx < 0) return { ok: false, error: 'PLAYER_NOT_FOUND' }
      players[idx] = {
        ...players[idx],
        buyInCount: players[idx].buyInCount + 1,
        totalBuyIn: players[idx].totalBuyIn + amount,
        currentStack: (players[idx].currentStack || 0) + amount,
        eliminatedAt: null
      }
      await db.collection('games').doc(gameId).update({
        data: { players, totalPot: _.inc(amount) }
      })
      break
    }
    case 'eliminate': {
      const idx = players.findIndex(p => p.openid === playerOpenid)
      if (idx < 0) return { ok: false, error: 'PLAYER_NOT_FOUND' }
      players[idx] = { ...players[idx], eliminatedAt: now, currentStack: 0 }
      await db.collection('games').doc(gameId).update({ data: { players } })
      break
    }
    case 'pauseToggle': {
      const paused = !game.paused
      const update = { paused }
      if (paused) {
        update.pausedAt = now
      } else if (game.pausedAt) {
        update.pausedAccumMs = (game.pausedAccumMs || 0) + (now - new Date(game.pausedAt))
        update.pausedAt = null
      }
      await db.collection('games').doc(gameId).update({ data: update })
      break
    }
    case 'levelUp': {
      const next = Math.min((game.currentLevel || 0) + 1, game.blindStructure.length - 1)
      await db.collection('games').doc(gameId).update({
        data: { currentLevel: next, levelStartedAt: now, pausedAccumMs: 0 }
      })
      break
    }
    default:
      return { ok: false, error: 'UNKNOWN_TYPE' }
  }

  await db.collection('transactions').add({
    data: { gameId, type, playerOpenid: playerOpenid || OPENID, amount, operatorOpenid: OPENID, timestamp: now }
  })

  return { ok: true }
}
