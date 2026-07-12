const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function fetchActiveCirclesForGame(game) {
  const PAGE_SIZE = 100
  const playerOpenids = (game.players || []).map(player => player.openid).filter(Boolean)
  if (!playerOpenids.length) return []
  const query = filtered =>
    db
      .collection('circles')
      .where(
        filtered
          ? { status: 'active', memberOpenids: _.elemMatch(_.in(playerOpenids)) }
          : { status: 'active' }
      )
  const fetchAll = async filtered => {
    const result = []
    const countRes = await query(filtered)
      .count()
      .catch(() => null)
    if (countRes && typeof countRes.total === 'number') {
      for (let skip = 0; skip < countRes.total; skip += PAGE_SIZE) {
        const page = await query(filtered).skip(skip).limit(PAGE_SIZE).get()
        result.push(...(page.data || []))
      }
    } else {
      for (let skip = 0; ; skip += PAGE_SIZE) {
        const page = await query(filtered).skip(skip).limit(PAGE_SIZE).get()
        result.push(...(page.data || []))
        if ((page.data || []).length < PAGE_SIZE) break
      }
    }
    return result
  }
  try {
    return await fetchAll(true)
  } catch (err) {
    console.warn('[excludeGame circles fallback]', err)
    const playerSet = new Set(playerOpenids)
    return (await fetchAll(false)).filter(circle =>
      (circle.memberOpenids || []).some(openid => playerSet.has(openid))
    )
  }
}

async function updateSeason(circle, gameId, exclude) {
  try {
    return await db.runTransaction(async transaction => {
      const seasonGot = await transaction
        .collection('seasons')
        .doc(circle.currentSeasonId)
        .get()
        .catch(() => null)
      if (!seasonGot?.data || seasonGot.data.status !== 'ongoing') {
        return { ok: false, error: 'NO_ACTIVE_SEASON' }
      }
      const season = seasonGot.data
      if (season.circleId !== circle._id) return { ok: false, error: 'NO_ACTIVE_SEASON' }
      if (season.exclusionScopeVersion !== 1) {
        return { ok: false, error: 'SEASON_MIGRATION_REQUIRED' }
      }
      const ids = new Set(season.excludedGameIds || [])
      if (exclude) ids.add(gameId)
      else ids.delete(gameId)
      await transaction
        .collection('seasons')
        .doc(season._id)
        .update({
          data: {
            excludedGameIds: [...ids],
            exclusionScopeVersion: 1,
            exclusionRevision: Math.max(0, Number(season.exclusionRevision) || 0) + 1
          }
        })
      return { ok: true, circleId: circle._id, seasonId: season._id }
    }, 3)
  } catch (err) {
    console.error('[excludeGame txn]', err)
    return { ok: false, error: 'CONFLICT_RETRY' }
  }
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { gameId, exclude = true, circleId } = event || {}
  if (!gameId) return { ok: false, error: 'INVALID_PARAMS' }

  const gameGot = await db
    .collection('games')
    .doc(gameId)
    .get()
    .catch(() => null)
  if (!gameGot?.data) return { ok: false, error: 'NOT_FOUND' }
  const game = gameGot.data

  let circles
  let legacy = false
  if (circleId) {
    const circleGot = await db
      .collection('circles')
      .doc(circleId)
      .get()
      .catch(() => null)
    if (!circleGot?.data || circleGot.data.status !== 'active') {
      return { ok: false, error: 'NOT_FOUND' }
    }
    const circle = circleGot.data
    if (circle.ownerOpenid !== OPENID) return { ok: false, error: 'NOT_HOST' }
    if (!circle.currentSeasonId) return { ok: false, error: 'NO_ACTIVE_SEASON' }
    if (
      !(game.players || []).some(player => (circle.memberOpenids || []).includes(player.openid))
    ) {
      return { ok: false, error: 'GAME_NOT_IN_CIRCLE' }
    }
    circles = [circle]
  } else {
    // 兼容已发布旧客户端：旧调用只传 gameId，由牌局房主操作。
    if (game.hostOpenid !== OPENID) return { ok: false, error: 'NOT_HOST' }
    legacy = true
    circles = (await fetchActiveCirclesForGame(game)).filter(circle => circle.currentSeasonId)
  }

  const updates = []
  for (const circle of circles) {
    let result = await updateSeason(circle, gameId, !!exclude)
    if (result.error === 'SEASON_MIGRATION_REQUIRED') {
      const migration = await cloud
        .callFunction({ name: 'calcSeasonScore', data: { circleId: circle._id } })
        .catch(err => {
          console.error('[excludeGame migrate season]', err)
          return null
        })
      if (migration?.result?.ok) result = await updateSeason(circle, gameId, !!exclude)
      else result = { ok: false, error: migration?.result?.error || 'CALC_FAILED' }
    }
    if (!result.ok && !legacy) return result
    if (result.ok) updates.push(result)
  }

  if (legacy) {
    await db
      .collection('games')
      .doc(gameId)
      .update({ data: { excludeFromSeason: !!exclude } })
  }

  for (const item of updates) {
    const calc = await cloud
      .callFunction({ name: 'calcSeasonScore', data: { circleId: item.circleId } })
      .catch(err => {
        console.error('[excludeGame calcSeasonScore]', err)
        return null
      })
    if (!calc?.result?.ok && !legacy) {
      return { ok: false, error: calc?.result?.error || 'CALC_FAILED' }
    }
  }

  return {
    ok: true,
    circleId: circleId || '',
    seasonId: updates[0]?.seasonId || '',
    excluded: !!exclude,
    legacy
  }
}
