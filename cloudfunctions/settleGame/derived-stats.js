function pendingDerivedUpdate(game, revision) {
  return { derivedPending: true, derivedVersion: revision, derivedRetryAfter: new Date(0) }
}

function createDerivedSync(db, calculateSeason) {
  const _ = db.command
  async function ensureUser(player) {
    // A failed query is never evidence that the user does not exist.
    const result = await db.collection('users').where({ _openid: player.openid }).limit(100).get()
    const named = user =>
      !!user.nickname && !['玩家', '庄家', '微信用户', '未设置昵称'].includes(user.nickname.trim())
    const users = (result.data || []).sort(
      (a, b) =>
        Number(named(b)) - Number(named(a)) ||
        +new Date(b.updatedAt || b.createdAt || 0) - +new Date(a.updatedAt || a.createdAt || 0) ||
        Number(!!b.avatar) - Number(!!a.avatar)
    )
    if (users.length) return users[0]
    const id = 'stats_' + player.openid
    try {
      await db.collection('users').add({
        data: {
          _id: id,
          _openid: player.openid,
          nickname: player.nickname || '',
          avatar: player.avatar || '',
          createdAt: new Date(),
          stats: { totalGames: 0, totalProfit: 0, wins: 0, biggestWin: 0, biggestLoss: 0 }
        }
      })
    } catch (error) {
      const existing = await db.collection('users').doc(id).get()
      if (!existing.data) throw error
    }
    return (await db.collection('users').doc(id).get()).data
  }

  async function rebuildStats(player) {
    const user = await ensureUser(player)
    const token = Date.now() + '_' + Math.random().toString(36).slice(2)
    await db
      .collection('users')
      .doc(user._id)
      .update({ data: { statsCalculationToken: token } })
    const games = new Map()
    for (let skip = 0; ; skip += 100) {
      const page = await db
        .collection('games')
        .where({ status: 'ended', players: _.elemMatch({ openid: player.openid }) })
        .orderBy('_id', 'asc')
        .skip(skip)
        .limit(100)
        .get()
      for (const game of page.data || []) games.set(game._id, game)
      if ((page.data || []).length < 100) break
    }
    const stats = { totalGames: 0, totalProfit: 0, wins: 0, biggestWin: 0, biggestLoss: 0 }
    for (const game of games.values()) {
      if (game.deletedAt || (game.hiddenForOpenids || []).includes(player.openid)) continue
      const me = (game.players || []).find(p => p.openid === player.openid && !p.eliminatedAt)
      if (!me) continue
      const ratio = Number(game.scoreRatio) > 0 ? Number(game.scoreRatio) : 1
      const score = Math.round((Number(me.finalProfit ?? me.profit) || 0) / ratio)
      stats.totalGames++
      stats.totalProfit += score
      if (score > 0) stats.wins++
      stats.biggestWin = Math.max(stats.biggestWin, score)
      stats.biggestLoss = Math.min(stats.biggestLoss, score)
    }
    stats.winRate = stats.totalGames ? Math.round((stats.wins * 1000) / stats.totalGames) / 10 : 0
    return db.runTransaction(async transaction => {
      const latest = (await transaction.collection('users').doc(user._id).get()).data
      if (latest.statsCalculationToken !== token) return false
      await transaction
        .collection('users')
        .doc(user._id)
        .update({ data: { stats: { ...(latest.stats || {}), ...stats } } })
      return true
    }, 3)
  }

  async function relatedCircles(players) {
    const ids = new Set(players.map(p => p.openid))
    const circles = []
    for (let skip = 0; ; skip += 100) {
      const page = await db
        .collection('circles')
        .where({ status: 'active' })
        .orderBy('_id', 'asc')
        .skip(skip)
        .limit(100)
        .get()
      circles.push(
        ...(page.data || []).filter(c => (c.memberOpenids || []).some(id => ids.has(id)))
      )
      if ((page.data || []).length < 100) break
    }
    return circles
  }

  async function sync(gameId) {
    let version
    try {
      const game = (await db.collection('games').doc(gameId).get()).data
      if (!game.derivedPending) return { pending: false }
      version = game.derivedVersion
      const players = (game.players || []).filter(p => !p.eliminatedAt)
      for (let start = 0; start < players.length; start += 3) {
        const applied = await Promise.all(
          players.slice(start, start + 3).map(async player => {
            try {
              return await rebuildStats(player)
            } catch (error) {
              console.warn('[stats pending]', player.openid, error.message)
              return false
            }
          })
        )
        if (applied.some(ok => !ok)) throw new Error('STATS_SUPERSEDED')
      }
      const circles = await relatedCircles(players)
      for (const circle of circles) {
        const result = await calculateSeason(circle._id)
        if (!result?.ok || result.superseded) throw new Error('SEASON_SYNC_PENDING')
      }
      const cleared = await db
        .collection('games')
        .where({ _id: gameId, derivedVersion: version })
        .update({
          data: { derivedPending: false, derivedSyncedAt: new Date() }
        })
      return { pending: !(cleared.stats?.updated > 0) }
    } catch (error) {
      console.warn('[derived sync pending]', gameId, error.message)
      if (version !== undefined) {
        await db
          .collection('games')
          .where({ _id: gameId, derivedVersion: version })
          .update({
            data: { derivedRetryAfter: new Date(Date.now() + 60000) }
          })
          .catch(() => {})
      }
      return { pending: true }
    }
  }

  async function drain() {
    const page = await db
      .collection('games')
      .where({ derivedPending: true, derivedRetryAfter: _.lte(new Date()) })
      .limit(1)
      .get()
    const results = []
    for (const game of page.data || []) results.push(await sync(game._id))
    return { ok: true, processed: results.length, pending: results.filter(r => r.pending).length }
  }
  return { sync, drain }
}
module.exports = { pendingDerivedUpdate, createDerivedSync }
