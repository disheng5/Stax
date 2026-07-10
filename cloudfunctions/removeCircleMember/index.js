const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { circleId, targetOpenid } = event || {}
  if (!circleId || !targetOpenid) return { ok: false, error: 'INVALID_PARAMS' }

  const got = await db
    .collection('circles')
    .doc(circleId)
    .get()
    .catch(() => null)
  if (!got || !got.data || got.data.status !== 'active') return { ok: false, error: 'NOT_FOUND' }
  const circle = got.data

  if (circle.ownerOpenid !== OPENID) return { ok: false, error: 'NOT_OWNER' }
  if (targetOpenid === circle.ownerOpenid) return { ok: false, error: 'OWNER_CANNOT_REMOVE' }
  if (!(circle.memberOpenids || []).includes(targetOpenid)) return { ok: false, error: 'NOT_MEMBER' }

  await db
    .collection('circles')
    .doc(circleId)
    .update({
      data: {
        memberOpenids: _.pull(targetOpenid),
        [`memberJoinedAt.${targetOpenid}`]: _.remove()
      }
    })

  const calc = await cloud.callFunction({ name: 'calcSeasonScore', data: { circleId } })
  const result = calc.result || {}
  if (!result.ok) return { ok: false, error: result.error || 'CALC_FAILED' }

  return { ok: true, ...result }
}
