// cloudfunctions/getMyAnalytics/index.js —— 个人统计 + 维度 + 趋势札记（只读聚合）
// 只用调用者可见（未 hiddenForOpenids）的已结束记录聚合；结果可从原始记录重算。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const { computeAnalytics, buildTrendNote } = require('./analytics.js')
const { gameScore } = require('./stats.js')

async function fetchMyEndedGames(openid) {
  const PAGE_SIZE = 100
  const query = () =>
    db
      .collection('games')
      .where(
        _.and([
          { status: 'ended' },
          { players: _.elemMatch({ openid }) },
          { hiddenForOpenids: _.nin([openid]) }
        ])
      )
  const out = []
  try {
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const page = await query()
        .field({
          players: true,
          scoreRatio: true,
          bigBlind: true,
          status: true,
          startedAt: true,
          endedAt: true
        })
        .orderBy('endedAt', 'asc')
        .skip(skip)
        .limit(PAGE_SIZE)
        .get()
      out.push(...(page.data || []))
      if ((page.data || []).length < PAGE_SIZE) break
    }
  } catch (err) {
    // 老环境可能无 hiddenForOpenids 字段/索引，退化为不过滤（前端本已可见这些记录）
    console.warn('[getMyAnalytics fallback]', err)
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const page = await db
        .collection('games')
        .where(_.and([{ status: 'ended' }, { players: _.elemMatch({ openid }) }]))
        .field({
          players: true,
          scoreRatio: true,
          bigBlind: true,
          status: true,
          startedAt: true,
          endedAt: true
        })
        .orderBy('endedAt', 'asc')
        .skip(skip)
        .limit(PAGE_SIZE)
        .get()
      out.push(...(page.data || []))
      if ((page.data || []).length < PAGE_SIZE) break
    }
  }
  return out
}

// 趋势信号：按结束时间排序取本人每局积分，最近 5 场与前 5 场对比。
function buildSignals(games, openid) {
  const scores = games
    .slice()
    .sort((a, b) => new Date(a.endedAt || a.startedAt) - new Date(b.endedAt || b.startedAt))
    .map(g => gameScore(g, openid))
    .filter(s => s !== null)
  const sampleCount = scores.length
  const recent = scores.slice(-5)
  const prev = scores.slice(-10, -5)
  const recentSum = recent.reduce((s, v) => s + v, 0)
  const prevSum = prev.reduce((s, v) => s + v, 0)
  const best = scores.length ? Math.max(...scores) : 0
  const worst = scores.length ? Math.min(...scores) : 0
  const direction = recentSum > prevSum ? 'up' : recentSum < prevSum ? 'down' : 'flat'
  return { sampleCount, recentSum, prevSum, best, worst, direction }
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const games = await fetchMyEndedGames(OPENID)
  const analytics = computeAnalytics(games, OPENID)
  const signals = buildSignals(games, OPENID)
  const note = buildTrendNote(signals)
  return {
    ok: true,
    stats: analytics.stats,
    dimensions: analytics.dimensions,
    trend: {
      recentSum: signals.recentSum,
      prevSum: signals.prevSum,
      best: signals.best,
      worst: signals.worst,
      direction: signals.direction
    },
    note,
    meta: analytics.meta
  }
}
