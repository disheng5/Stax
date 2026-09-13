// cloudfunctions/getMyAnalytics/index.js —— 个人统计 + 维度 + 趋势札记（只读聚合）
// 只用调用者可见（未 hiddenForOpenids）的已结束记录聚合；结果可从原始记录重算。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const { computeAnalytics, buildTrendNote, buildTrendSignals } = require('./analytics.js')
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
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const page = await query()
      .field({
        players: true,
        scoreRatio: true,
        bigBlind: true,
        status: true,
        startedAt: true,
        endedAt: true,
        hiddenForOpenids: true,
        deletedAt: true
      })
      .orderBy('endedAt', 'asc')
      .skip(skip)
      .limit(PAGE_SIZE)
      .get()
    out.push(...(page.data || []))
    if ((page.data || []).length < PAGE_SIZE) break
  }
  return [...new Map(out.map(game => [game._id, game])).values()].filter(
    game => gameScore(game, openid) !== null
  )
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const games = await fetchMyEndedGames(OPENID)
  const analytics = computeAnalytics(games, OPENID)
  const signals = buildTrendSignals(games, OPENID)
  const note = buildTrendNote(signals, { variation: event?.noteVariation })
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
