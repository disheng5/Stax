const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { inviteCode } = event || {}

  if (!/^[A-Z0-9]{8}$/.test(inviteCode || '')) return { ok: false, error: 'INVALID_CODE' }

  const found = await db
    .collection('circles')
    .where({ inviteCode, status: 'active' })
    .limit(1)
    .get()

  if (!found.data.length) return { ok: false, error: 'NOT_FOUND' }
  const circle = found.data[0]

  if ((circle.memberOpenids || []).includes(OPENID))
    return { ok: true, circleId: circle._id, alreadyJoined: true }

  const now = new Date()
  await db
    .collection('circles')
    .doc(circle._id)
    .update({
      data: {
        memberOpenids: _.addToSet(OPENID),
        [`memberJoinedAt.${OPENID}`]: now
      }
    })

  const calc = await cloud
    .callFunction({ name: 'calcSeasonScore', data: { circleId: circle._id } })
    .catch(err => {
      console.error('[joinCircle calc]', err)
      return null
    })
  return {
    ok: true,
    circleId: circle._id,
    scoreUpdated: !!calc?.result?.ok
  }
}
