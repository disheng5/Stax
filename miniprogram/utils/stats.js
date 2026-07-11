// utils/stats.js — 战绩统计共用计算（首页 / 历史 / 我的 共用，保证口径一致）

// 我在某局的积分（盈亏 / 记分比例）；不在局内返回 null
function gameScore(game, openid) {
  const me = (game.players || []).find(p => p.openid === openid)
  if (!me) return null
  const ratio = Number(game.scoreRatio) > 0 ? Number(game.scoreRatio) : 1
  return Math.round((me.finalProfit ?? me.profit ?? 0) / ratio)
}

function computeGameStats(games, openid) {
  let totalGames = 0
  let totalProfit = 0
  let biggestWin = 0
  let biggestLoss = 0
  let wins = 0
  ;(games || []).forEach(g => {
    const score = gameScore(g, openid)
    if (score === null) return
    totalGames++
    totalProfit += score
    if (score > biggestWin) biggestWin = score
    if (score < biggestLoss) biggestLoss = score
    if (score > 0) wins++
  })
  const winRate = totalGames > 0 ? Math.round((wins * 1000) / totalGames) / 10 : 0
  return { totalGames, totalProfit, biggestWin, biggestLoss, wins, winRate }
}

const WEEKDAY_ORDER = {
  周一: 1,
  周二: 2,
  周三: 3,
  周四: 4,
  周五: 5,
  周六: 6,
  周日: 7
}

function sortDimensionRows(rows, dimension) {
  return (rows || []).slice().sort((a, b) => {
    if (dimension === 'players' || dimension === 'rebuys') {
      const numberDiff = (parseInt(a.key, 10) || 0) - (parseInt(b.key, 10) || 0)
      if (numberDiff) return numberDiff
    } else if (dimension === 'weekday') {
      const dayDiff = (WEEKDAY_ORDER[a.key] || 99) - (WEEKDAY_ORDER[b.key] || 99)
      if (dayDiff) return dayDiff
    } else if (dimension === 'opponents') {
      const sampleDiff = (Number(b.games) || 0) - (Number(a.games) || 0)
      if (sampleDiff) return sampleDiff
    }
    return String(a.key || '').localeCompare(String(b.key || ''), 'zh-CN', { numeric: true })
  })
}

module.exports = { gameScore, computeGameStats, sortDimensionRows }
