const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { gameId, exclude = true } = event || {}
  if (!gameId) return { ok: false, error: 'INVALID_PARAMS' }

  const got = await db
    .collection('games')
    .doc(gameId)
    .get()
    .catch(() => null)
  if (!got || !got.data) return { ok: false, error: 'NOT_FOUND' }

  if (got.data.hostOpenid !== OPENID) return { ok: false, error: 'NOT_HOST' }

  await db
    .collection('games')
    .doc(gameId)
    .update({
      data: { excludeFromSeason: !!exclude }
    })

  // 触发相关圈子积分重算
  try {
    const playerOpenids = (got.data.players || []).map(p => p.openid)
    const _ = db.command
    const circlesRes = await db
      .collection('circles')
      .where({ status: 'active', memberOpenids: _.in(playerOpenids) })
      .limit(20)
      .get()
    for (const c of circlesRes.data || []) {
      cloud.callFunction({ name: 'calcSeasonScore', data: { circleId: c._id } }).catch(() => {})
    }
  } catch (_) {}

  return { ok: true }
}
