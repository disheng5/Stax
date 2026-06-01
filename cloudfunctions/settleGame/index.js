// cloudfunctions/settleGame/index.js — 下桌记录与房主最终结算
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function aaEven(players, totalCost) {
  if (!players.length || totalCost <= 0)
    return players.map(p => ({ openid: p.openid, nickname: p.nickname, share: 0 }))
  const base = Math.floor(totalCost / players.length)
  let remain = totalCost - base * players.length
  return players.map((p, i) => ({
    openid: p.openid,
    nickname: p.nickname,
    share: base + (i < remain ? 1 : 0)
  }))
}

function aaWinnerByRatio(players, totalCost) {
  if (!players.length || totalCost <= 0)
    return players.map(p => ({ openid: p.openid, nickname: p.nickname, share: 0 }))
  const winners = players.filter(p => p.profit > 0)
  if (!winners.length) return aaEven(players, totalCost)
  const totalWin = winners.reduce((s, p) => s + p.profit, 0)
  const shares = players.map(p => ({ openid: p.openid, nickname: p.nickname, share: 0 }))
  let assigned = 0
  winners.forEach(w => {
    const idx = shares.findIndex(s => s.openid === w.openid)
    const v = Math.floor((w.profit / totalWin) * totalCost)
    shares[idx].share = v
    assigned += v
  })
  const remain = totalCost - assigned
  if (remain > 0) {
    const maxWinner = winners.slice().sort((a, b) => b.profit - a.profit)[0]
    const idx = shares.findIndex(s => s.openid === maxWinner.openid)
    shares[idx].share += remain
  }
  return shares
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { gameId, finalStacks, extraCost = 0, expenseMode = 'all', mode = 'checkout' } = event || {}

  if (!gameId || !finalStacks || typeof finalStacks !== 'object')
    return { ok: false, error: 'INVALID_PARAMS' }

  const got = await db
    .collection('games')
    .doc(gameId)
    .get()
    .catch(() => null)
  if (!got || !got.data) return { ok: false, error: 'GAME_NOT_FOUND' }
  const game = got.data
  if (game.status === 'ended') return { ok: false, error: 'ALREADY_ENDED' }

  const isHost = game.hostOpenid === OPENID
  const isPlayer = (game.players || []).some(p => p.openid === OPENID)
  if (!isPlayer) return { ok: false, error: 'NOT_PLAYER' }

  const submittedOpenids = Object.keys(finalStacks).filter(
    openid =>
      finalStacks[openid] !== '' &&
      finalStacks[openid] !== null &&
      finalStacks[openid] !== undefined
  )
  if (!submittedOpenids.length) return { ok: false, error: 'NO_STACKS_SUBMITTED' }
  if (!isHost && submittedOpenids.some(openid => openid !== OPENID))
    return { ok: false, error: 'CAN_ONLY_SETTLE_SELF' }
  if (mode === 'finalize' && !isHost) return { ok: false, error: 'NOT_HOST' }

  const now = new Date()
  let players = (game.players || []).map(p => {
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
  const diff = allSettled ? players.reduce((s, p) => s + p.profit, 0) : 0
  let ended = false
  let shares = players.map(p => ({ openid: p.openid, nickname: p.nickname, share: 0 }))

  if (mode === 'finalize') {
    if (!allSettled) return { ok: false, error: 'NOT_ALL_CHECKED_OUT' }
    if (diff !== 0) return { ok: false, error: 'PROFIT_NOT_ZERO', diff }

    if (extraCost > 0 && expenseMode === 'all') shares = aaEven(players, extraCost)
    else if (extraCost > 0 && expenseMode === 'winner') shares = aaWinnerByRatio(players, extraCost)

    const shareMap = {}
    shares.forEach(s => {
      shareMap[s.openid] = Number(s.share) || 0
    })
    players = players.map(p => ({ ...p, share: shareMap[p.openid] || 0, finalProfit: p.profit }))
    ended = true
  }

  const update = {
    players,
    extraCost,
    expenseMode,
    aaMode: expenseMode,
    shareTotal: shares.reduce((s, x) => s + (x.share || 0), 0),
    checkedOutCount: players.filter(p => p.finalStack !== null && p.finalStack !== undefined)
      .length,
    settledCount: players.filter(p => p.finalStack !== null && p.finalStack !== undefined).length
  }
  if (ended) {
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
        amount: Number(finalStacks[openid] || 0),
        operatorOpenid: OPENID,
        byHost: isHost,
        revoked: false,
        timestamp: now,
        meta: { mode, expenseMode, extraCost }
      }
    })
  }

  if (ended) {
    const ratio = Number(game.scoreRatio) > 0 ? Number(game.scoreRatio) : 1
    for (const p of players) {
      const score = Math.round((p.finalProfit || 0) / ratio)
      const userQ = await db.collection('users').where({ _openid: p.openid }).limit(1).get()
      if (!userQ.data.length) {
        await db.collection('users').add({
          data: {
            nickname: p.nickname,
            avatar: p.avatar,
            createdAt: now,
            stats: {
              totalGames: 1,
              totalProfit: score,
              biggestWin: Math.max(0, score),
              biggestLoss: Math.min(0, score),
              wins: score > 0 ? 1 : 0
            }
          }
        })
      } else {
        const u = userQ.data[0]
        const s = u.stats || {
          totalGames: 0,
          totalProfit: 0,
          biggestWin: 0,
          biggestLoss: 0,
          wins: 0
        }
        await db
          .collection('users')
          .doc(u._id)
          .update({
            data: {
              'stats.totalGames': s.totalGames + 1,
              'stats.totalProfit': s.totalProfit + score,
              'stats.biggestWin': Math.max(s.biggestWin || 0, score),
              'stats.biggestLoss': Math.min(s.biggestLoss || 0, score),
              'stats.wins': (s.wins || 0) + (score > 0 ? 1 : 0)
            }
          })
      }
    }

    // 触发圈子赛季积分更新（非阻塞，不影响结算结果）
    try {
      const playerOpenids = players.map(p => p.openid)
      const circlesRes = await db
        .collection('circles')
        .where({ status: 'active', memberOpenids: _.in(playerOpenids) })
        .limit(20)
        .get()
      for (const c of circlesRes.data || []) {
        cloud
          .callFunction({ name: 'calcSeasonScore', data: { circleId: c._id } })
          .catch(e => console.error('[calcSeasonScore]', c._id, e))
      }
    } catch (err) {
      console.error('[calcSeasonScore trigger]', err)
    }
  }

  return {
    ok: true,
    ended,
    diff,
    players,
    game: { ...game, ...update, players },
    extraCost,
    expenseMode
  }
}
