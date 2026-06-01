const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function genCode(len = 8) {
  let c = ''
  for (let i = 0; i < len; i++) c += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length))
  return c
}

async function uniqueCode() {
  for (let i = 0; i < 10; i++) {
    const code = genCode()
    const dup = await db.collection('circles').where({ inviteCode: code }).count()
    if (dup.total === 0) return code
  }
  throw new Error('GENERATE_CODE_FAILED')
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { name } = event || {}

  if (!name || typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 12)
    return { ok: false, error: 'INVALID_NAME' }

  const inviteCode = await uniqueCode()
  const now = new Date()

  const memberJoinedAt = {}
  memberJoinedAt[OPENID] = now

  const res = await db.collection('circles').add({
    data: {
      name: name.trim(),
      ownerOpenid: OPENID,
      inviteCode,
      memberOpenids: [OPENID],
      memberJoinedAt,
      currentSeasonId: null,
      status: 'active',
      createdAt: now
    }
  })

  return { ok: true, circleId: res._id, inviteCode }
}
