// cloudfunctions/settleGame/index.js — 结算牌局（含 AA 分摊）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const {
    gameId,
    finalStacks,
    extraCost = 0,
    aaMode = 'none',
    shares = []
  } = event

  if (!gameId || !finalStacks || typeof finalStacks !== 'object') {
    return { ok: false, error: 'INVALID_PARAMS' }
  }

  const got = await db.collection('games').doc(gameId).get().catch(() => null)
  if (!got || !got.data) return { ok: false, error: 'GAME_NOT_FOUND' }
  const game = got.data
  if (game.status === 'ended') return { ok: false, error: 'ALREADY_ENDED' }
  if (game.hostOpenid !== OPENID) return { ok: false, error: 'NOT_HOST' }

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

  await db.collection('games').doc(gameId).update({
    data: {
      players,
      status: 'ended',
      endedAt: now,
      extraCost,
      aaMode,
      shareTotal: shares.reduce((s, x) => s + (x.share || 0), 0)
    }
  })

  await db.collection('transactions').add({
    data: {
      gameId, type: 'settle', playerOpenid: OPENID,
      amount: extraCost, operatorOpenid: OPENID,
      byHost: true, revoked: false, timestamp: now,
      meta: { aaMode }
    }
  })

  // 聚合更新 user.stats（用 finalProfit 包含 AA 分摊后净额）
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
            totalProfit: p.finalProfit,
            biggestWin: Math.max(0, p.finalProfit),
            biggestLoss: Math.min(0, p.finalProfit),
            wins: p.finalProfit > 0 ? 1 : 0
          }
        }
      })
    } else {
      const u = userQ.data[0]
      const s = u.stats || { totalGames: 0, totalProfit: 0, biggestWin: 0, biggestLoss: 0, wins: 0 }
      await db.collection('users').doc(u._id).update({
        data: {
          'stats.totalGames': s.totalGames + 1,
          'stats.totalProfit': s.totalProfit + p.finalProfit,
          'stats.biggestWin': Math.max(s.biggestWin || 0, p.finalProfit),
          'stats.biggestLoss': Math.min(s.biggestLoss || 0, p.finalProfit),
          'stats.wins': (s.wins || 0) + (p.finalProfit > 0 ? 1 : 0)
        }
      })
    }
  }

  return { ok: true, players }
}
