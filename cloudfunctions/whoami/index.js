// cloudfunctions/whoami/index.js — 返回当前调用者 openid 与 user 文档
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { upsertNickname, upsertAvatar } = event || {}

  const q = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
  let user
  if (!q.data.length) {
    const now = new Date()
    const created = await db.collection('users').add({
      data: {
        nickname: upsertNickname || '玩家',
        avatar: upsertAvatar || '',
        createdAt: now,
        stats: { totalGames: 0, totalProfit: 0, biggestWin: 0, biggestLoss: 0, wins: 0 }
      }
    })
    user = { _id: created._id, _openid: OPENID, nickname: upsertNickname || '玩家', avatar: upsertAvatar || '' }
  } else {
    user = q.data[0]
    if ((upsertNickname && upsertNickname !== user.nickname) || (upsertAvatar && upsertAvatar !== user.avatar)) {
      await db.collection('users').doc(user._id).update({
        data: { nickname: upsertNickname || user.nickname, avatar: upsertAvatar || user.avatar }
      })
      user.nickname = upsertNickname || user.nickname
      user.avatar = upsertAvatar || user.avatar
    }
  }

  return { ok: true, openid: OPENID, user }
}
