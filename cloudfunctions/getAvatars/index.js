const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async event => {
  const { openids = [] } = event
  if (!openids.length) return { ok: true, avatars: {}, nicknames: {} }

  try {
    // 一次 _.in 批量查，替代每个 openid 单独查询
    const _ = db.command
    const unique = [...new Set(openids)].filter(Boolean)
    const users = []
    for (let i = 0; i < unique.length; i += 100) {
      const batch = unique.slice(i, i + 100)
      const res = await db
        .collection('users')
        .where({ _openid: _.in(batch) })
        .limit(100)
        .get()
      users.push(...(res.data || []))
    }

    // 返回原始 avatar（cloud:// 原样透传）：小程序端 <image> 原生渲染 cloud://
    // 且自带缓存，跨页秒显不闪；不再换 getTempFileURL（临时链接会过期、且引发闪烁）
    const avatars = {}
    const nicknames = {}
    users.forEach(u => {
      if (u.avatar) avatars[u._openid] = u.avatar
      if (u.nickname) nicknames[u._openid] = u.nickname
    })

    return { ok: true, avatars, nicknames }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}
