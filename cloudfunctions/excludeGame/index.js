const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function fetchActiveCircles() {
  const PAGE_SIZE = 100
  const query = () => db.collection('circles').where({ status: 'active' })
  const countRes = await query()
    .count()
    .catch(() => null)
  const out = []
  if (countRes && typeof countRes.total === 'number') {
    const total = countRes.total || 0
    for (let skip = 0; skip < total; skip += PAGE_SIZE) {
      const page = await query().skip(skip).limit(PAGE_SIZE).get()
      out.push(...(page.data || []))
    }
  } else {
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const page = await query().skip(skip).limit(PAGE_SIZE).get()
      out.push(...(page.data || []))
      if ((page.data || []).length < PAGE_SIZE) break
    }
  }
  return out
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { gameId, exclude = true, circleId } = event || {}
  if (!gameId) return { ok: false, error: 'INVALID_PARAMS' }

  const got = await db
    .collection('games')
    .doc(gameId)
    .get()
    .catch(() => null)
  if (!got || !got.data) return { ok: false, error: 'NOT_FOUND' }

  // 授权：该局房主，或（新增）传入的圈子的榜主可管理本季比赛。
  // circleId 为可选新增参数，旧调用不传则沿用房主校验，向后兼容。
  let authorized = got.data.hostOpenid === OPENID
  if (!authorized && circleId) {
    const c = await db
      .collection('circles')
      .doc(circleId)
      .get()
      .catch(() => null)
    if (c && c.data && c.data.ownerOpenid === OPENID) authorized = true
  }
  if (!authorized) return { ok: false, error: 'NOT_HOST' }

  await db
    .collection('games')
    .doc(gameId)
    .update({
      data: { excludeFromSeason: !!exclude }
    })

  // 触发相关圈子积分重算
  try {
    const playerOpenids = (got.data.players || []).map(p => p.openid)
    const playerSet = {}
    playerOpenids.forEach(openid => {
      if (openid) playerSet[openid] = true
    })
    const circles = await fetchActiveCircles()
    await Promise.all(
      circles
        .filter(c => (c.memberOpenids || []).some(openid => playerSet[openid]))
        .map(c =>
          cloud.callFunction({ name: 'calcSeasonScore', data: { circleId: c._id } }).catch(() => {})
        )
    )
  } catch (_) {}

  return { ok: true }
}
