// cloudfunctions/settleGame/index.js — 下桌记录与房主最终结算
// players 数组的读改写在事务内完成，避免多人同时下桌时互相覆盖。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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

// 结算后更新每个玩家的累计战绩：一次 _.in 批量查 + 并行原子更新
async function updateUserStats(players, game, now) {
  const ratio = Number(game.scoreRatio) > 0 ? Number(game.scoreRatio) : 1
  const openids = players.map(p => p.openid)
  const byOpenid = {}
  try {
    const existing = await db
      .collection('users')
      .where({ _openid: _.in(openids) })
      .limit(100)
      .get()
    existing.data.forEach(u => {
      byOpenid[u._openid] = u
    })
  } catch (err) {
    console.error('[updateUserStats query]', err)
  }
  await Promise.all(
    players.map(p => {
      const score = Math.round((p.finalProfit || 0) / ratio)
      const u = byOpenid[p.openid]
      if (!u) {
        return db
          .collection('users')
          .add({
            data: {
              _openid: p.openid,
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
          .catch(err => console.error('[updateUserStats add]', p.openid, err))
      }
      // 原子更新，两局同时结算也不丢计数；max/min 用 0 截断保持与初始语义一致
      return db
        .collection('users')
        .doc(u._id)
        .update({
          data: {
            'stats.totalGames': _.inc(1),
            'stats.totalProfit': _.inc(score),
            'stats.biggestWin': _.max(Math.max(0, score)),
            'stats.biggestLoss': _.min(Math.min(0, score)),
            'stats.wins': _.inc(score > 0 ? 1 : 0)
          }
        })
        .catch(err => console.error('[updateUserStats update]', p.openid, err))
    })
  )
}

async function fetchActiveCircles(memberOpenids = []) {
  const PAGE_SIZE = 100
  const query = filtered =>
    db.collection('circles').where(
      filtered && memberOpenids.length
        ? { status: 'active', memberOpenids: _.elemMatch(_.in(memberOpenids)) }
        : { status: 'active' }
    )
  const fetch = async filtered => {
    const out = []
    const countRes = await query(filtered)
      .count()
      .catch(() => null)
    if (countRes && typeof countRes.total === 'number') {
      const total = countRes.total || 0
      for (let skip = 0; skip < total; skip += PAGE_SIZE) {
        const page = await query(filtered).skip(skip).limit(PAGE_SIZE).get()
        out.push(...(page.data || []))
      }
    } else {
      for (let skip = 0; ; skip += PAGE_SIZE) {
        const page = await query(filtered).skip(skip).limit(PAGE_SIZE).get()
        out.push(...(page.data || []))
        if ((page.data || []).length < PAGE_SIZE) break
      }
    }
    return out
  }
  try {
    return await fetch(true)
  } catch (err) {
    console.warn('[fetchActiveCircles member fallback]', err)
    const memberSet = new Set(memberOpenids)
    return (await fetch(false)).filter(circle =>
      (circle.memberOpenids || []).some(openid => memberSet.has(openid))
    )
  }
}

// 触发相关圈子的赛季积分重算。
// 云函数返回后事件循环即被冻结，fire-and-forget 不可靠，必须等待完成。
async function triggerSeasonCalc(players) {
  try {
    const playerSet = {}
    players.forEach(p => {
      if (p.openid) playerSet[p.openid] = true
    })
    const circles = await fetchActiveCircles(Object.keys(playerSet))
    const related = circles.filter(c => (c.memberOpenids || []).some(openid => playerSet[openid]))
    await Promise.all(
      related.map(c =>
        cloud
          .callFunction({ name: 'calcSeasonScore', data: { circleId: c._id } })
          .catch(e => console.error('[calcSeasonScore]', c._id, e))
      )
    )
  } catch (err) {
    console.error('[calcSeasonScore trigger]', err)
  }
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { gameId, finalStacks, extraCost = 0, expenseMode = 'all', mode = 'checkout' } = event || {}

  if (!gameId || !finalStacks || typeof finalStacks !== 'object')
    return { ok: false, error: 'INVALID_PARAMS' }

  const submittedOpenids = Object.keys(finalStacks).filter(
    openid =>
      finalStacks[openid] !== '' &&
      finalStacks[openid] !== null &&
      finalStacks[openid] !== undefined
  )
  if (!submittedOpenids.length) return { ok: false, error: 'NO_STACKS_SUBMITTED' }

  const now = new Date()
  let txn
  try {
    txn = await db.runTransaction(async transaction => {
      const snap = await transaction
        .collection('games')
        .doc(gameId)
        .get()
        .catch(() => null)
      if (!snap || !snap.data) return { ok: false, error: 'GAME_NOT_FOUND' }
      const game = snap.data
      if (game.status === 'ended') return { ok: false, error: 'ALREADY_ENDED' }

      const isHost = game.hostOpenid === OPENID
      const isPlayer = (game.players || []).some(p => p.openid === OPENID)
      if (!isPlayer) return { ok: false, error: 'NOT_PLAYER' }
      if (mode === 'finalize' && !isHost) return { ok: false, error: 'NOT_HOST' }

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

      // 被淘汰/踢出的玩家不参与任何结算计算（新踢人已直接移除，此处兜底旧数据的 eliminatedAt 标记）
      const active = players.filter(p => !p.eliminatedAt)
      const allSettled =
        active.length > 0 &&
        active.every(p => p.finalStack !== null && p.finalStack !== undefined)
      const diff = allSettled ? active.reduce((s, p) => s + p.profit, 0) : 0
      let ended = false
      let shares = active.map(p => ({ openid: p.openid, nickname: p.nickname, share: 0 }))

      if (mode === 'finalize') {
        if (!allSettled) return { ok: false, error: 'NOT_ALL_CHECKED_OUT' }
        if (diff !== 0) return { ok: false, error: 'PROFIT_NOT_ZERO', diff }

        if (extraCost > 0 && expenseMode === 'all') shares = aaEven(active, extraCost)
        else if (extraCost > 0 && expenseMode === 'winner')
          shares = aaWinnerByRatio(active, extraCost)

        const shareMap = {}
        shares.forEach(s => {
          shareMap[s.openid] = Number(s.share) || 0
        })
        players = players.map(p =>
          p.eliminatedAt ? p : { ...p, share: shareMap[p.openid] || 0, finalProfit: p.profit }
        )
        ended = true
      }

      // 兼容字段：按【全体玩家】计已结算数（与改造前一致）。
      // 旧线上前端用 settledCount / checkedOutCount 判断「全员已结算 → 出结束/费用分摊按钮」，
      // 二者必须双写且口径一致，否则字段冻结导致房间无法收局（曾致线上事故）。
      const settledAll = players.filter(
        p => p.finalStack !== null && p.finalStack !== undefined
      ).length
      const update = {
        players,
        extraCost,
        expenseMode,
        aaMode: expenseMode,
        shareTotal: shares.reduce((s, x) => s + (x.share || 0), 0),
        checkedOutCount: settledAll,
        settledCount: settledAll
      }
      if (ended) {
        update.status = 'ended'
        update.endedAt = now
      }

      await transaction.collection('games').doc(gameId).update({ data: update })
      // 牌局状态与流水同事务提交，watch 不会再看到“数据已变、流水尚未落库”的中间态。
      for (const openid of submittedOpenids) {
        await transaction.collection('transactions').add({
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
      // active 与结算数学同源返回，后续统计不再各自过滤（避免口径漂移）
      const activeFinal = players.filter(p => !p.eliminatedAt)
      return { ok: true, ended, diff, game, players, activePlayers: activeFinal, update, isHost }
    }, 3)
  } catch (err) {
    console.error('[settleGame txn]', err)
    return { ok: false, error: 'CONFLICT_RETRY' }
  }
  if (!txn.ok) return txn

  const { ended, diff, game, players, activePlayers, update } = txn

  if (ended) {
    // 两者相互独立（users.stats 与 circles/seasons），并行执行缩短结算等待
    await Promise.all([
      updateUserStats(activePlayers, game, now),
      triggerSeasonCalc(activePlayers)
    ])
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
