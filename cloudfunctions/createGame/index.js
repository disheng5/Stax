// cloudfunctions/createGame/index.js — 创建牌局
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  // TODO:
  //   1. 校验入参（name / buyIn / sb / bb / blindUpMinutes）
  //   2. 生成唯一 6 位邀请码（重试机制）
  //   3. 写入 games 集合，hostOpenid = OPENID，status = 'ongoing'
  //   4. 返回 { gameId, inviteCode }
  return { ok: true, openid: OPENID, todo: 'createGame skeleton' }
}
