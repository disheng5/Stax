// cloudfunctions/joinGame/index.js — 加入牌局
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { inviteCode } = event
  // TODO:
  //   1. 按 inviteCode 查找 ongoing 牌局
  //   2. 若已在 players 中则返回 gameId
  //   3. 否则 push 新 player（含 totalBuyIn = buyIn, buyInCount = 1, joinedAt = now）
  //   4. 写一条 transactions(buyIn) 流水
  return { ok: true, openid: OPENID, inviteCode, todo: 'joinGame skeleton' }
}
