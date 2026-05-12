// cloudfunctions/settleGame/index.js — 结算牌局
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { gameId, finalStacks } = event   // finalStacks: { openid: number }
  // TODO:
  //   1. 仅庄家可结算
  //   2. 计算每位 player.profit = finalStack - totalBuyIn
  //   3. 校验 Σ profit === 0
  //   4. 更新 game.status = 'ended', endedAt = now, players[*].finalStack/profit
  //   5. 聚合更新各 user.stats（totalGames++, totalProfit, biggestWin, biggestLoss）
  //   6. 写一条 transactions(settle)
  return { ok: true, openid: OPENID, gameId, finalStacks, todo: 'settleGame skeleton' }
}
