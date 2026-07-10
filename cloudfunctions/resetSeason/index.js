const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { circleId } = event || {}
  if (!circleId) return { ok: false, error: 'INVALID_PARAMS' }

  const got = await db
    .collection('circles')
    .doc(circleId)
    .get()
    .catch(() => null)
  if (!got || !got.data) return { ok: false, error: 'NOT_FOUND' }
  if (got.data.ownerOpenid !== OPENID) return { ok: false, error: 'NOT_OWNER' }

  const circle = got.data
  if (!circle.currentSeasonId) return { ok: false, error: 'NO_ACTIVE_SEASON' }

  const calc = await cloud.callFunction({ name: 'calcSeasonScore', data: { circleId } })
  const result = calc.result || {}
  if (!result.ok) return { ok: false, error: result.error || 'CALC_FAILED' }

  return { ok: true, ...result }
}
