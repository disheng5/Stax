// cloudfunctions/settleGame/index.js — 下桌记录与房主最终结算
// players 数组的读改写在事务内完成，避免多人同时下桌时互相覆盖。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
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

function receiptId(gameId, operationId) {
  return `${gameId}:${operationId}`
}

// 持久幂等：结果保存供重放，剔除 game 大对象。
function receiptResult(result) {
  if (!result || typeof result !== 'object') return result
  const clone = { ...result }
  delete clone.game
  return clone
}

async function readSettleReceipt(gameId, operationId) {
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

async function writeSettleReceipt(gameId, operationId, result) {
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

// 结束后允许修改结算积分的时间窗（账不平可在此期间修正）
const EDIT_WINDOW_MS = 3 * 60 * 60 * 1000

function normalizeExpenseMode(value) {
  if (['winner', 'winnerRatio', 'winnerByRatio'].includes(value)) return 'winner'
  if (['winnerEven', 'winnersEven'].includes(value)) return 'winnerEven'
  if (value === 'mvp') return 'mvp'
  if (['all', 'even'].includes(value)) return 'all'
  // 未知取值（可能来自源码已丢失的线上前端）不拒绝，
  // 回退到产品默认「水上比例」
  return 'winner'
}

function withinEditWindow(game, now) {
  if (!game.endedAt) return false
  const endedAt = +new Date(game.endedAt)
  return Number.isFinite(endedAt) && now - endedAt <= EDIT_WINDOW_MS
}

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

// 水上平均：仅赢家均摊；无赢家退化为全员均摊
function aaWinnerEven(players, totalCost) {
  if (!players.length || totalCost <= 0)
    return players.map(p => ({ openid: p.openid, nickname: p.nickname, share: 0 }))
  const winners = players.filter(p => p.profit > 0)
  if (!winners.length) return aaEven(players, totalCost)
  const winnerShares = aaEven(winners, totalCost)
  const map = {}
  winnerShares.forEach(s => {
    map[s.openid] = s.share
  })
  return players.map(p => ({ openid: p.openid, nickname: p.nickname, share: map[p.openid] || 0 }))
}

// MVP 买单：赢最多的一人承担全部费用；无赢家退化为全员均摊
function aaMvp(players, totalCost) {
  if (!players.length || totalCost <= 0)
    return players.map(p => ({ openid: p.openid, nickname: p.nickname, share: 0 }))
  const winners = players.filter(p => p.profit > 0)
  if (!winners.length) return aaEven(players, totalCost)
  const mvp = winners.slice().sort((a, b) => b.profit - a.profit)[0]
  return players.map(p => ({
    openid: p.openid,
    nickname: p.nickname,
    share: p.openid === mvp.openid ? totalCost : 0
  }))
}

function computeShares(players, totalCost, mode) {
  if (!totalCost || totalCost <= 0)
    return players.map(p => ({ openid: p.openid, nickname: p.nickname, share: 0 }))
  if (mode === 'winner') return aaWinnerByRatio(players, totalCost)
  if (mode === 'winnerEven') return aaWinnerEven(players, totalCost)
  if (mode === 'mvp') return aaMvp(players, totalCost)
  return aaEven(players, totalCost)
}

// 结束后修改结算积分时，按差额修正个人累计战绩（totalProfit/wins 精确；
// biggestWin/biggestLoss 只增不减，属近似，前端统计均由 games 原始数据实时计算不受影响）
async function applyStatsDelta(prevPlayers, nextPlayers, game) {
  const ratio = Number(game.scoreRatio) > 0 ? Number(game.scoreRatio) : 1
  const prevBy = {}
  prevPlayers
    .filter(p => !p.eliminatedAt)
    .forEach(p => {
      prevBy[p.openid] = Math.round((Number(p.finalProfit ?? p.profit) || 0) / ratio)
    })
  await Promise.all(
    nextPlayers
      .filter(p => !p.eliminatedAt)
      .map(p => {
        const newScore = Math.round((Number(p.finalProfit) || 0) / ratio)
        const oldScore = prevBy[p.openid] || 0
        const dProfit = newScore - oldScore
        const dWins = (newScore > 0 ? 1 : 0) - (oldScore > 0 ? 1 : 0)
        if (!dProfit && !dWins) return null
        return db
          .collection('users')
          .where({ _openid: p.openid })
          .update({
            data: {
              'stats.totalProfit': _.inc(dProfit),
              'stats.wins': _.inc(dWins),
              'stats.biggestWin': _.max(Math.max(0, newScore)),
              'stats.biggestLoss': _.min(Math.min(0, newScore))
            }
          })
          .catch(err => console.error('[applyStatsDelta]', p.openid, err))
      })
  )
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
    db
      .collection('circles')
      .where(
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
  const { gameId, finalStacks } = event || {}
  // ⚠️ 契约红线：绝不按 mode 名称拒绝请求（曾用 INVALID_MODE 白名单拒掉了
  // 源码已丢失的线上前端的费用分摊调用，酿成线上事故）。
  // 按【载荷形状】推断意图，任何代际的前端都能正确工作：
  //   - mode === 'finalize'            → 显式最终结算（历史契约）
  //   - 带非空 finalStacks             → 结算（checkout）
  //   - 无 finalStacks 但带 extraCost  → 设置费用分摊（expense）
  const hasExtraCost = event && event.extraCost !== undefined && event.extraCost !== null
  const hasExpenseMode = !!(event && (event.expenseMode || event.aaMode))
  const extraCost = hasExtraCost ? Number(event.extraCost) : 0
  const expenseMode = hasExpenseMode
    ? normalizeExpenseMode(event.expenseMode || event.aaMode)
    : 'all'
  const operationId = normalizeOperationId(event?.operationId)

  if (!gameId) return { ok: false, error: 'INVALID_PARAMS' }
  if (operationId) {
    const cached = await readSettleReceipt(gameId, operationId)
    if (cached) return cached
  }
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
  if (event?.mode === 'finalize') {
    mode = 'finalize'
    if (!submittedOpenids.length) return { ok: false, error: 'NO_STACKS_SUBMITTED' }
  } else if (submittedOpenids.length) {
    mode = 'checkout'
    if (event?.mode && event.mode !== 'checkout') {
      console.warn('[settleGame] unknown mode treated as checkout:', event.mode)
    }
  } else if (hasExtraCost) {
    mode = 'expense'
    if (event?.mode && event.mode !== 'expense') {
      console.warn('[settleGame] stacks-less call treated as expense, mode:', event.mode)
    }
  } else {
    // 与最初版行为一致：无有效积分提交
    return { ok: false, error: 'NO_STACKS_SUBMITTED' }
  }

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
      const isHost = game.hostOpenid === OPENID
      const isPlayer = (game.players || []).some(p => p.openid === OPENID)
      if (!isPlayer) return { ok: false, error: 'NOT_PLAYER' }
      if (mode === 'finalize' && !isHost) return { ok: false, error: 'NOT_HOST' }
      const playerOpenids = new Set((game.players || []).map(p => p.openid))
      if (submittedOpenids.some(openid => !playerOpenids.has(openid))) {
        return { ok: false, error: 'PLAYER_NOT_FOUND' }
      }
      // 朋友局：参赛成员可代提任意玩家的结算积分（目标已校验为本局玩家）；
      // 房间关闭「权限共享」开关时仍仅房主可操作
      if (!isHost && game.playerOpsShared === false) {
        return { ok: false, error: 'PLAYER_OPS_DISABLED' }
      }
      if (hasOperation(game, operationId)) {
        return {
          ok: true,
          idempotent: true,
          operationId,
          ended: game.status === 'ended',
          diff: 0,
          game,
          players: game.players || []
        }
      }

      const wasEnded = game.status === 'ended'
      // 结束后的编辑（改结算积分/改费用）只允许在时间窗内
      if (wasEnded && !withinEditWindow(game, +now)) {
        return { ok: false, error: 'ALREADY_ENDED' }
      }
      if (mode === 'finalize' && wasEnded) return { ok: false, error: 'ALREADY_ENDED' }

      // 生效的费用设置：显式传参优先，否则保留库中已存值
      const effExtraCost = hasExtraCost ? extraCost : Number(game.extraCost) || 0
      // 显式传参 > 库中已存 > 产品默认「水上比例」
      const effExpenseMode = hasExpenseMode
        ? expenseMode
        : game.expenseMode || game.aaMode
          ? normalizeExpenseMode(game.expenseMode || game.aaMode)
          : 'winner'

      const prevPlayers = game.players || []
      let players = prevPlayers.map(p => {
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

      // 被淘汰/踢出的玩家不参与任何结算计算（新踢人已直接移除，此处兜底旧数据的 eliminatedAt 标记）
      const active = players.filter(p => !p.eliminatedAt)
      const allSettled =
        active.length > 0 && active.every(p => p.finalStack !== null && p.finalStack !== undefined)
      const diff = allSettled ? active.reduce((s, p) => s + p.profit, 0) : 0

      if (mode === 'finalize') {
        if (!allSettled) return { ok: false, error: 'NOT_ALL_CHECKED_OUT' }
        if (diff !== 0) return { ok: false, error: 'PROFIT_NOT_ZERO', diff }
      }

      // 终局判定：
      //  - finalize（旧客户端）：显式终局
      //  - checkout：全员结算完即自动终局（不校验差额，账不平可在 3 小时内修正）
      //  - 已结束局的再编辑：保持 ended，不改 endedAt
      const ended = wasEnded || mode === 'finalize' || (mode === 'checkout' && allSettled)
      const justEnded = ended && !wasEnded
      const edited = wasEnded && mode === 'checkout'

      let shares = active.map(p => ({ openid: p.openid, nickname: p.nickname, share: 0 }))
      if (ended) {
        // 终局或已终局：finalProfit 与费用单一并落定/刷新
        if (effExtraCost > 0) shares = computeShares(active, effExtraCost, effExpenseMode)
        const shareMap = {}
        shares.forEach(s => {
          shareMap[s.openid] = Number(s.share) || 0
        })
        players = players.map(p =>
          p.eliminatedAt ? p : { ...p, share: shareMap[p.openid] || 0, finalProfit: p.profit }
        )
      }

      // 兼容字段：按【全体玩家】计已结算数（与改造前一致）。
      // 旧线上前端用 settledCount / checkedOutCount 判断「全员已结算」，
      // 二者必须双写且口径一致，否则字段冻结导致房间无法收局（曾致线上事故）。
      const settledAll = players.filter(
        p => p.finalStack !== null && p.finalStack !== undefined
      ).length
      const writesTransactions = submittedOpenids.length > 0
      const prevExtraCost = Number(game.extraCost) || 0
      const expenseChanged = hasExtraCost && effExtraCost !== prevExtraCost
      const emitsTransactions = writesTransactions || (mode === 'expense' && expenseChanged)
      const seqBase = Math.max(0, Number(game.txSeq) || 0)
      let seqCursor = seqBase
      const operatorNickname = (game.players || []).find(p => p.openid === OPENID)?.nickname || ''
      const txCount = submittedOpenids.length + (mode === 'expense' && expenseChanged ? 1 : 0)
      const update = {
        players,
        extraCost: effExtraCost,
        expenseMode: effExpenseMode,
        aaMode: effExpenseMode,
        shareTotal: shares.reduce((s, x) => s + (x.share || 0), 0),
        checkedOutCount: settledAll,
        settledCount: settledAll,
        stateRevision: Math.max(0, Number(game.stateRevision ?? game.txRevision) || 0) + 1,
        ...(emitsTransactions
          ? {
            txSeq: seqBase + txCount,
            txRevision: Math.max(0, Number(game.txRevision) || 0) + 1
          }
          : {}),
        ...operationUpdate(game, operationId)
      }
      if (justEnded) {
        update.status = 'ended'
        update.endedAt = now
      }

      await transaction.collection('games').doc(gameId).update({ data: update })
      // 牌局状态与流水同事务提交，watch 不会再看到“数据已变、流水尚未落库”的中间态。
      for (const openid of submittedOpenids) {
        const prevPlayer = prevPlayers.find(p => p.openid === openid)
        const beforeValue =
          prevPlayer && prevPlayer.finalStack !== null && prevPlayer.finalStack !== undefined
            ? prevPlayer.finalStack
            : null
        seqCursor++
        await transaction.collection('transactions').add({
          data: {
            gameId,
            type: ended ? 'settle' : 'settlePartial',
            playerOpenid: openid,
            amount: normalizedStacks[openid],
            operatorOpenid: OPENID,
            operatorNicknameSnapshot: operatorNickname,
            byHost: isHost,
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
      // 仅修改费用（不含结算）时也留一条可审计流水，展示前后值与操作人。
      if (mode === 'expense' && expenseChanged) {
        seqCursor++
        await transaction.collection('transactions').add({
          data: {
            gameId,
            type: 'expense',
            playerOpenid: OPENID,
            amount: effExtraCost,
            operatorOpenid: OPENID,
            operatorNicknameSnapshot: operatorNickname,
            byHost: isHost,
            revoked: false,
            timestamp: now,
            operationSequence: seqCursor,
            beforeValue: prevExtraCost,
            afterValue: effExtraCost,
            meta: { expenseMode: effExpenseMode },
            ...(operationId ? { operationId } : {})
          }
        })
      }
      // active 与结算数学同源返回，后续统计不再各自过滤（避免口径漂移）
      const activeFinal = players.filter(p => !p.eliminatedAt)
      return {
        ok: true,
        ended,
        justEnded,
        edited,
        diff,
        game,
        players,
        prevPlayers,
        activePlayers: activeFinal,
        update,
        isHost
      }
    }, 3)
  } catch (err) {
    console.error('[settleGame txn]', err)
    return { ok: false, error: 'CONFLICT_RETRY' }
  }
  if (!txn.ok) return txn
  if (txn.idempotent) {
    return {
      ok: true,
      idempotent: true,
      operationId,
      ended: txn.ended,
      diff: txn.diff,
      players: txn.players,
      game: txn.game,
      extraCost: txn.game.extraCost || 0,
      expenseMode: txn.game.expenseMode || 'all'
    }
  }

  const { ended, justEnded, edited, diff, game, players, prevPlayers, activePlayers, update } = txn

  if (justEnded) {
    // 首次终局：全量记账 + 赛季重算（两者独立，并行缩短等待）
    await Promise.all([updateUserStats(activePlayers, game, now), triggerSeasonCalc(activePlayers)])
  } else if (edited) {
    // 结束后的积分修正：按差额修正个人战绩 + 赛季重算
    await Promise.all([
      applyStatsDelta(prevPlayers, players, game),
      triggerSeasonCalc(activePlayers)
    ])
  }

  const response = {
    ok: true,
    ended,
    justEnded,
    edited,
    diff,
    players,
    game: { ...game, ...update, players },
    extraCost: update.extraCost,
    expenseMode: update.expenseMode
  }
  await writeSettleReceipt(gameId, operationId, response)
  return response
}
