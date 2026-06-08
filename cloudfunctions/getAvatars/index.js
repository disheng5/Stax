const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async event => {
  const { openids = [] } = event
  if (!openids.length) return { ok: true, avatars: {} }

  try {
    const unique = [...new Set(openids)].slice(0, 20)
    const results = await Promise.all(
      unique.map(openid =>
        db
          .collection('users')
          .where({ _openid: openid })
          .limit(1)
          .get()
          .then(r => ({ openid, avatar: (r.data && r.data[0] && r.data[0].avatar) || '' }))
          .catch(() => ({ openid, avatar: '' }))
      )
    )

    const needTempUrl = results
      .filter(r => r.avatar && r.avatar.startsWith('cloud://'))
      .map(r => r.avatar)

    let tempUrlMap = {}
    if (needTempUrl.length) {
      const urlRes = await cloud.getTempFileURL({ fileList: [...new Set(needTempUrl)] })
      ;(urlRes.fileList || []).forEach(f => {
        if (f.tempFileURL) tempUrlMap[f.fileID] = f.tempFileURL
      })
    }

    const avatars = {}
    results.forEach(r => {
      if (!r.avatar) return
      avatars[r.openid] = tempUrlMap[r.avatar] || r.avatar
    })

    return { ok: true, avatars }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}
