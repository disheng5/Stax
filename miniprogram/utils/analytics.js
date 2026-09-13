const { computeGameStats, sortDimensionRows } = require('./stats.js')

const ANALYTICS_VERSION = 1
const MIN_NOTE_SAMPLE = 5

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function computeAnalytics(games, openid) {
  const visible = (games || []).filter(g => g.status === 'ended')
  const stats = computeGameStats(visible, openid)

  const dimPlayers = {}
  const dimRebuys = {}
  const dimWeekday = {}
  const dimOpponents = {}

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
      opponents: sortDimensionRows(Object.values(dimOpponents), 'opponents')
    },
    meta: { sourceGameCount: visible.length, algorithmVersion: ANALYTICS_VERSION }
  }
}

// 一句数据观察 + 一个朴实的概率/决策视角 + 一个下次能验证的德扑实用技巧。
// 用简单直白的话，不用看不懂的比喻，不说无信息量的废话。
function buildTrendNote(signals) {
  if (!signals || (signals.sampleCount || 0) < MIN_NOTE_SAMPLE) {
    return { enough: false }
  }
  const { recentSum, prevSum, best, worst, sampleCount } = signals
  const comparable = sampleCount >= 10
  const rising = comparable && recentSum > prevSum
  const falling = comparable && recentSum < prevSum
  const recentCount = Math.min(sampleCount, 5)
  const fmt = v => `${v >= 0 ? '+' : ''}${v}`

  let observation
  if (rising) {
    observation = `最近 ${recentCount} 场合计 ${fmt(recentSum)} 分，高于前 5 场的 ${fmt(prevSum)} 分。`
  } else if (falling) {
    observation = `最近 ${recentCount} 场合计 ${fmt(recentSum)} 分，低于前 5 场的 ${fmt(prevSum)} 分。`
  } else {
    observation = `最近 ${recentCount} 场合计 ${fmt(recentSum)} 分。` + (comparable ? '与前 5 场合计相同。' : '')
  }

  // 概率/决策视角：用大白话解释，不下水平结论
  let perspective
  if (recentSum < 0) {
    perspective = '短期结果有波动，不能单凭积分判断决策好坏。感到急躁时，可以先休息一会。'
  } else if (rising) {
    perspective = '结果向好时，也值得回看当时的选择；好结果不等于每次决策都正确。'
  } else {
    perspective = '积分记录反映结果，不包含每一步的判断；复盘时，把决策与结果分开看。'
  }

  // 一个德扑理性玩家真正会用的、下次能验证的具体技巧
  const TIPS = [
    '选一个印象深的决定，只用当时已知的信息复盘，先不看最终结果。',
    '需要跟注时，先分清还会看到几张公共牌，再估计改善概率和需要付出的积分。',
    '遇到意外逆转，先记下当时的信息和选择，等情绪平稳后再判断是否需要调整。'
  ]
  const tip = TIPS[Math.abs(Math.round(recentSum + (worst || 0) + (best || 0))) % TIPS.length]
  const action = tip

  return { enough: true, observation, perspective, action }
}

module.exports = { computeAnalytics, buildTrendNote, ANALYTICS_VERSION, MIN_NOTE_SAMPLE }
