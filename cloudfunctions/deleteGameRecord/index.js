// cloudfunctions/deleteGameRecord/index.js
// 只允许从“我自己的战绩列表”中移除一条已结束牌局。
// 实现策略：
//   1. 在 games.players[].deletedByOpenidList 上加入当前 openid，
//      让 history 查询 + 用户个人统计在前端按 openid 过滤即可隐藏。
//   2. 同步扣减 user.stats 的相关字段，确保「我的统计」马上一致。
// 不会真正删除整局数据，避免影响其他玩家。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { gameId } = event || {}
  if (!gameId) return { ok: false, error: 'INVALID_PARAMS' }

  const got = await db
    .collection('games')
    .doc(gameId)
    .get()
    .catch(() => null)
  if (!got || !got.data) return { ok: false, error: 'GAME_NOT_FOUND' }
  const game = got.data
  const me = (game.players || []).find(p => p.openid === OPENID)
  if (!me) return { ok: false, error: 'NOT_PLAYER' }

  const hidden = Array.isArray(game.hiddenForOpenids) ? game.hiddenForOpenids : []
  if (hidden.includes(OPENID)) return { ok: true, alreadyHidden: true }

  await db
    .collection('games')
    .doc(gameId)
    .update({
      data: { hiddenForOpenids: _.addToSet(OPENID) }
    })

  // 扣减用户战绩
  if (game.status === 'ended') {
    const myProfit = Number(me.finalProfit ?? me.profit ?? 0) || 0
    const userQ = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    if (userQ.data.length) {
      const u = userQ.data[0]
      const s = u.stats || { totalGames: 0, totalProfit: 0, biggestWin: 0, biggestLoss: 0, wins: 0 }
      await db
        .collection('users')
        .doc(u._id)
        .update({
          data: {
            'stats.totalGames': Math.max(0, (s.totalGames || 0) - 1),
            'stats.totalProfit': (s.totalProfit || 0) - myProfit,
            'stats.wins': Math.max(0, (s.wins || 0) - (myProfit > 0 ? 1 : 0))
          }
        })
    }
  }

  return { ok: true }
}
