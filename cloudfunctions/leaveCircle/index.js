const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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
  const circle = got.data

  if (circle.ownerOpenid === OPENID) return { ok: false, error: 'OWNER_CANNOT_LEAVE' }

  if (!(circle.memberOpenids || []).includes(OPENID)) return { ok: false, error: 'NOT_MEMBER' }

  await db
    .collection('circles')
    .doc(circleId)
    .update({
      data: {
        memberOpenids: _.pull(OPENID),
        [`memberJoinedAt.${OPENID}`]: _.remove()
      }
    })

  const calc = await cloud
    .callFunction({ name: 'calcSeasonScore', data: { circleId } })
    .catch(err => {
      console.error('[leaveCircle calc]', err)
      return null
    })
  return { ok: true, scoreUpdated: !!calc?.result?.ok }
}
