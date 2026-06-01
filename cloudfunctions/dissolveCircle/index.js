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

  await db
    .collection('circles')
    .doc(circleId)
    .update({
      data: { status: 'dissolved' }
    })

  return { ok: true }
}
