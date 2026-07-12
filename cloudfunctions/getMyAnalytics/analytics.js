// 镜像自 miniprogram/utils/analytics.js —— 个人聚合 + 趋势札记纯函数。
// 两处必须保持一致：改动其一必须同步另一处并跑测试。
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
  const recentCount = Math.min(sampleCount, 5)
  const fmt = v => `${v >= 0 ? '+' : ''}${v}`

  let observation
  if (rising) {
    observation = `最近 ${recentCount} 场合计 ${fmt(recentSum)} 分，比前一段更好。`
  } else if (falling) {
    observation = `最近 ${recentCount} 场合计 ${fmt(recentSum)} 分，比前一段差一些。`
  } else {
    observation = `最近 ${recentCount} 场基本持平，单场在 ${worst} 到 ${fmt(best)} 之间波动。`
  }

  let perspective
  if (falling) {
    perspective = `${sampleCount} 场还太少，单看输赢说明不了水平，运气占的比重很大。别急着改打法。`
  } else if (rising) {
    perspective = '赢的时候也复盘一下：是牌好，还是选择对。这样赢得才稳。'
  } else {
    perspective = '成绩稳定，说明打法没大漏洞。想再进一步，可以从下面这条细节入手。'
  }

  const TIPS = [
    '位置很重要：在按钮位（最后行动）多打一些牌，在枪口位（最先行动）收紧，长期更划算。',
    '别用同花小张去追顺子/同花：多数时候赔率不够，跟注前先估一下凑成的概率。',
    '下注想清楚目的：是想让更差的牌跟注（要价值），还是想让更好的牌盖牌（在诈唬），没目的就别下。',
    '拿到大牌该加注就加注，慢打常常少赢甚至让对手追牌翻盘。',
    '被再加注（3-bet）时先想对手范围，边缘牌直接盖掉比硬跟更省分。',
    '翻牌没中也别习惯性跟注：给自己定个规矩——没听牌、没成对就果断放弃。',
    '记住几个常用赔率：听同花约 4:1、听两头顺约 5:1，池底赔率不够就别追。'
  ]
  const tip = TIPS[Math.abs(recentSum + worst + best) % TIPS.length]
  const action = `下一局可以试一个小技巧：${tip}`

  return { enough: true, observation, perspective, action }
}

module.exports = { computeAnalytics, buildTrendNote, ANALYTICS_VERSION, MIN_NOTE_SAMPLE }
