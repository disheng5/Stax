// cloudfunctions/recordTransaction/index.js — rebuy / addOn / eliminate 流水
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { gameId, type, playerOpenid, amount } = event
  // TODO:
  //   1. 校验仅庄家（hostOpenid === OPENID）可写
  //   2. 根据 type 更新对应 player：
  //      - rebuy / addOn → totalBuyIn += amount, buyInCount++
  //      - eliminate     → eliminatedAt = now
  //   3. 写一条 transactions
  return { ok: true, openid: OPENID, gameId, type, playerOpenid, amount, todo: 'recordTransaction skeleton' }
}
