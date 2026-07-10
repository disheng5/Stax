const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const GENERIC_NICKNAMES = new Set(['玩家', '庄家', '微信用户', '未设置昵称'])
const BATCH_SIZE = 10

function meaningfulNickname(value) {
  const nickname = typeof value === 'string' ? value.trim() : ''
  return !!nickname && !GENERIC_NICKNAMES.has(nickname)
}

function profileTime(profile) {
  const n = +new Date(profile.updatedAt || profile.profileUpdatedAt || profile.createdAt || 0)
  return Number.isFinite(n) ? n : 0
}

function mergeUserDocs(docs) {
  const sorted = docs.slice().sort((a, b) => {
    const nameDiff = Number(meaningfulNickname(b.nickname)) - Number(meaningfulNickname(a.nickname))
    return nameDiff || profileTime(b) - profileTime(a) || Number(!!b.avatar) - Number(!!a.avatar)
  })
  const named = sorted.find(u => meaningfulNickname(u.nickname))
  const withAvatar = sorted.filter(u => u.avatar).sort((a, b) => profileTime(b) - profileTime(a))[0]
  const latest = sorted.slice().sort((a, b) => profileTime(b) - profileTime(a))[0] || {}
  return {
    nickname: named ? named.nickname.trim() : '',
    avatar: withAvatar ? withAvatar.avatar : '',
    updatedAt: latest.updatedAt || latest.profileUpdatedAt || latest.createdAt || ''
  }
}

exports.main = async event => {
  const unique = [...new Set(((event && event.openids) || []).filter(Boolean))].slice(0, 500)
  if (!unique.length) return { ok: true, profiles: {}, avatars: {}, nicknames: {} }

  try {
    const _ = db.command
    const users = []
    for (let i = 0; i < unique.length; i += BATCH_SIZE) {
      const batch = unique.slice(i, i + BATCH_SIZE)
      const res = await db
        .collection('users')
        .where({ _openid: _.in(batch) })
        .limit(1000)
        .get()
      users.push(...(res.data || []))
    }

    const grouped = {}
    users.forEach(user => {
      if (!user._openid) return
      if (!grouped[user._openid]) grouped[user._openid] = []
      grouped[user._openid].push(user)
    })

    const profiles = {}
    const avatars = {}
    const nicknames = {}
    Object.keys(grouped).forEach(openid => {
      const profile = mergeUserDocs(grouped[openid])
      profiles[openid] = profile
      if (profile.avatar) avatars[openid] = profile.avatar
      if (profile.nickname) nicknames[openid] = profile.nickname
    })

    return { ok: true, profiles, avatars, nicknames }
  } catch (err) {
    console.error('[getAvatars]', err)
    return { ok: false, error: err.message || String(err) }
  }
}
