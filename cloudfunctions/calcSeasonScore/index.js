const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function getSeasonName(date, seasonNo) {
  const m = date.getMonth() + 1
  let vol = '春之卷'
  if (m >= 4 && m <= 6) vol = '夏之卷'
  else if (m >= 7 && m <= 9) vol = '秋之卷'
  else if (m >= 10) vol = '冬之卷'
  return `${date.getFullYear()} · ${vol} · 第${seasonNo}回`
}

function getTitles() {
  return { 1: '当朝魁首', 2: '榜眼', 3: '探花' }
}

async function ensureSeason(circle) {
  if (circle.currentSeasonId) {
    const s = await db
      .collection('seasons')
      .doc(circle.currentSeasonId)
      .get()
      .catch(() => null)
    if (s && s.data && s.data.status === 'ongoing') {
      const now = new Date()
      if (now < new Date(s.data.endAt)) return s.data
    }
  }
  const now = new Date()
  const endAt = new Date(now.getTime() + 6 * 7 * 24 * 60 * 60 * 1000)
  const countRes = await db.collection('seasons').where({ circleId: circle._id }).count()
  const seasonNo = (countRes.total || 0) + 1
  const seasonName = getSeasonName(now, seasonNo)

  const res = await db.collection('seasons').add({
    data: {
      circleId: circle._id,
      seasonNo,
      seasonName,
      startAt: now,
      endAt,
      status: 'ongoing',
      rankings: [],
      championOpenid: null,
      settledAt: null
    }
  })
  await db
    .collection('circles')
    .doc(circle._id)
    .update({
      data: { currentSeasonId: res._id }
    })
  return {
    _id: res._id,
    circleId: circle._id,
    seasonNo,
    seasonName,
    startAt: now,
    endAt,
    status: 'ongoing',
    rankings: []
  }
}

async function calcForCircle(circleId) {
  const got = await db
    .collection('circles')
    .doc(circleId)
    .get()
    .catch(() => null)
  if (!got || !got.data || got.data.status !== 'active') return

  const circle = got.data
  const season = await ensureSeason(circle)
  if (!season || season.status !== 'ongoing') return

  const startAt = new Date(season.startAt)
  const endAt = new Date(season.endAt)
  const members = circle.memberOpenids || []
  const joinedAt = circle.memberJoinedAt || {}

  const allGames = []
  for (let skip = 0; skip < 500; skip += 20) {
    const r = await db
      .collection('games')
      .where({ status: 'ended', endedAt: _.gte(startAt).and(_.lte(endAt)) })
      .orderBy('endedAt', 'asc')
      .skip(skip)
      .limit(20)
      .get()
    allGames.push(...r.data)
    if (r.data.length < 20) break
  }

  const MIN_PLAYERS = 4
  const MIN_DURATION_MS = 20 * 60 * 1000
  const qualifiedGames = allGames.filter(g => {
    if ((g.players || []).length < MIN_PLAYERS) return false
    const dur = new Date(g.endedAt) - new Date(g.startedAt)
    if (dur < MIN_DURATION_MS) return false
    return true
  })

  const memberStats = {}
  members.forEach(openid => {
    memberStats[openid] = { profitBB: 0, games: 0 }
  })

  qualifiedGames.forEach(g => {
    const bb = Math.max(1, Number(g.bigBlind) || 1) // guard against 0 or missing
    ;(g.players || []).forEach(p => {
      if (!members.includes(p.openid)) return
      const memberJoined = joinedAt[p.openid] ? new Date(joinedAt[p.openid]) : null
      if (memberJoined && memberJoined > new Date(g.endedAt)) return
      if (!memberStats[p.openid]) return
      const profit = p.finalProfit ?? p.profit ?? 0
      memberStats[p.openid].profitBB += Math.round(profit / bb)
      memberStats[p.openid].games++
    })
  })

  const titles = getTitles()
  const MIN_GAMES = 3
  const ranked = Object.entries(memberStats)
    .filter(([, s]) => s.games >= MIN_GAMES)
    .sort(([, a], [, b]) => b.profitBB - a.profitBB)

  const userQ = await db
    .collection('users')
    .where({ _openid: _.in(members) })
    .limit(50)
    .get()
  const nameMap = {}
  ;(userQ.data || []).forEach(u => {
    nameMap[u._openid] = u.nickname || '玩家'
  })

  const rankings = ranked.map(([openid, s], i) => ({
    openid,
    nickname: nameMap[openid] || '玩家',
    profitBB: s.profitBB,
    games: s.games,
    rank: i + 1,
    title: titles[i + 1] || null
  }))

  const unranked = members
    .filter(openid => !ranked.some(([o]) => o === openid))
    .map(openid => ({
      openid,
      nickname: nameMap[openid] || '玩家',
      profitBB: (memberStats[openid] || {}).profitBB || 0,
      games: (memberStats[openid] || {}).games || 0,
      rank: 0,
      title: null
    }))

  await db
    .collection('seasons')
    .doc(season._id)
    .update({
      data: { rankings: [...rankings, ...unranked] }
    })

  return { ok: true, seasonId: season._id, rankedCount: rankings.length }
}

exports.main = async event => {
  const { circleId } = event || {}
  if (circleId) {
    return await calcForCircle(circleId)
  }
  const all = await db.collection('circles').where({ status: 'active' }).limit(100).get()
  for (const c of all.data || []) {
    await calcForCircle(c._id)
  }
  return { ok: true, processed: (all.data || []).length }
}
