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

function buildTrendNote(signals) {
  if (!signals || (signals.sampleCount || 0) < MIN_NOTE_SAMPLE) {
    return { enough: false }
  }
  const { recentSum, prevSum, best, worst, sampleCount } = signals
  const rising = recentSum > prevSum
  const falling = recentSum < prevSum

  let observation
  if (rising) {
    observation = `近段 ${sampleCount >= 10 ? '5' : Math.min(sampleCount, 5)} 场累计 ${recentSum >= 0 ? '+' : ''}${recentSum}，节奏比前一段更顺。`
  } else if (falling) {
    observation = `近段累计 ${recentSum >= 0 ? '+' : ''}${recentSum}，相比前一段有所回落。`
  } else {
    observation = `近段累计与前段持平，波动区间 ${worst} 到 ${best >= 0 ? '+' : ''}${best}。`
  }

  let perspective
  if (falling && worst < 0) {
    perspective =
      '短期结果波动是样本量不足的正常表现，不足以定义长期水平。关注可控变量比关注结果更有效率。'
  } else if (rising) {
    perspective = '结果在短期里很响，决策质量通常更安静。保持当前节奏，观察是否可持续。'
  } else {
    perspective = '稳定本身是一种信号——说明决策框架在当前环境里是自洽的。'
  }

  let action
  if (falling) {
    action = '下一次可以只观察一个变量：边缘起手是否比平时停留得更久。'
  } else if (rising) {
    action = '下一次可以记录一个决策：哪一手选择了放弃，事后觉得是正确的。'
  } else {
    action = '下一次可以留意：在什么位置、什么人数下，自己最容易偏离计划。'
  }

  return { enough: true, observation, perspective, action }
}

module.exports = { computeAnalytics, buildTrendNote, ANALYTICS_VERSION, MIN_NOTE_SAMPLE }
