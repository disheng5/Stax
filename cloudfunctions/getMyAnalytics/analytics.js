// 镜像自 miniprogram/utils/analytics.js —— 个人聚合 + 趋势札记纯函数。
// 两处必须保持一致：改动其一必须同步另一处并跑测试。
const { computeGameStats, sortDimensionRows, gameScore, positionKey } = require('./stats.js')

const ANALYTICS_VERSION = 2
const { buildTrendNote, buildTrendSignals, MIN_NOTE_SAMPLE } = require('./trend-note.js')

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function computeAnalytics(games, openid) {
  const visible = (games || []).filter(g => g.status === 'ended' && gameScore(g, openid) !== null)
  const stats = computeGameStats(visible, openid)

  const dimPlayers = {}
  const dimRebuys = {}
  const dimWeekday = {}
  const dimOpponents = {}
  const dimPosition = {}

  visible.forEach(g => {
    const me = (g.players || []).find(p => p.openid === openid)
    if (!me) return
    const ratio = Number(g.scoreRatio) > 0 ? Number(g.scoreRatio) : 1
    const score = Math.round((me.finalProfit ?? me.profit ?? 0) / ratio)

    const playerCount = (g.players || []).length
    const pk = `${playerCount} 人`
    if (!dimPlayers[pk]) dimPlayers[pk] = { key: pk, games: 0, profit: 0, wins: 0 }
    dimPlayers[pk].games++
    dimPlayers[pk].profit += score
    if (score > 0) dimPlayers[pk].wins++

    const rebuys = Number(me.buyInCount) || 1
    const rk = rebuys >= 3 ? '3+ 次' : `${rebuys} 次`
    if (!dimRebuys[rk]) dimRebuys[rk] = { key: rk, games: 0, profit: 0, wins: 0 }
    dimRebuys[rk].games++
    dimRebuys[rk].profit += score
    if (score > 0) dimRebuys[rk].wins++

    const day = WEEKDAYS[new Date(g.endedAt || g.startedAt).getDay()]
    if (!dimWeekday[day]) dimWeekday[day] = { key: day, games: 0, profit: 0, wins: 0 }
    dimWeekday[day].games++
    dimWeekday[day].profit += score
    if (score > 0) dimWeekday[day].wins++

    const seat = positionKey(me)
    if (!dimPosition[seat]) dimPosition[seat] = { key: seat, games: 0, profit: 0, wins: 0 }
    dimPosition[seat].games++
    dimPosition[seat].profit += score
    if (score > 0) dimPosition[seat].wins++

    ;(g.players || []).forEach(p => {
      if (p.openid === openid) return
      const name = p.nickname || '玩家'
      if (!dimOpponents[name]) dimOpponents[name] = { key: name, games: 0 }
      dimOpponents[name].games++
    })
  })

  return {
    stats,
    dimensions: {
      players: sortDimensionRows(Object.values(dimPlayers), 'players'),
      rebuys: sortDimensionRows(Object.values(dimRebuys), 'rebuys'),
      weekday: sortDimensionRows(Object.values(dimWeekday), 'weekday'),
      position: sortDimensionRows(Object.values(dimPosition), 'position'),
      opponents: sortDimensionRows(Object.values(dimOpponents), 'opponents')
    },
    meta: { sourceGameCount: visible.length, algorithmVersion: ANALYTICS_VERSION }
  }
}

module.exports = { computeAnalytics, buildTrendNote, buildTrendSignals, ANALYTICS_VERSION, MIN_NOTE_SAMPLE }
