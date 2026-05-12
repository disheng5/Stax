// cloudfunctions/settleGame/index.js — 结算牌局
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { gameId, finalStacks } = event   // finalStacks: { openid: number }

  if (!gameId || !finalStacks || typeof finalStacks !== 'object') {
    return { ok: false, error: 'INVALID_PARAMS' }
  }

  const got = await db.collection('games').doc(gameId).get().catch(() => null)
  if (!got || !got.data) return { ok: false, error: 'GAME_NOT_FOUND' }
  const game = got.data
  if (game.status === 'ended') return { ok: false, error: 'ALREADY_ENDED' }
  if (game.hostOpenid !== OPENID) return { ok: false, error: 'NOT_HOST' }

  const now = new Date()
  let sum = 0
  const players = game.players.map(p => {
    const finalStack = Number(finalStacks[p.openid] || 0)
    const profit = finalStack - p.totalBuyIn
    sum += profit
    return { ...p, finalStack, profit, currentStack: finalStack }
  })

  if (sum !== 0) return { ok: false, error: 'PROFIT_NOT_ZERO', diff: sum }

  await db.collection('games').doc(gameId).update({
    data: { players, status: 'ended', endedAt: now }
  })

  await db.collection('transactions').add({
    data: {
      gameId, type: 'settle', playerOpenid: OPENID,
      amount: 0, operatorOpenid: OPENID, timestamp: now
    }
  })

  // 聚合更新 user.stats
  for (const p of players) {
    const userQ = await db.collection('users').where({ _openid: p.openid }).limit(1).get()
    if (!userQ.data.length) {
      await db.collection('users').add({
        data: {
          nickname: p.nickname,
          avatar: p.avatar,
          createdAt: now,
          stats: {
            totalGames: 1,
            totalProfit: p.profit,
            biggestWin: Math.max(0, p.profit),
            biggestLoss: Math.min(0, p.profit),
            wins: p.profit > 0 ? 1 : 0
          }
        }
      })
    } else {
      const u = userQ.data[0]
      const s = u.stats || { totalGames: 0, totalProfit: 0, biggestWin: 0, biggestLoss: 0, wins: 0 }
      await db.collection('users').doc(u._id).update({
        data: {
          'stats.totalGames': s.totalGames + 1,
          'stats.totalProfit': s.totalProfit + p.profit,
          'stats.biggestWin': Math.max(s.biggestWin || 0, p.profit),
          'stats.biggestLoss': Math.min(s.biggestLoss || 0, p.profit),
          'stats.wins': (s.wins || 0) + (p.profit > 0 ? 1 : 0)
        }
      })
    }
  }

  return { ok: true, players }
}
