const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const ALGO_VERSION = 3

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
  const startAt = now
  const endAt = new Date(now.getTime() + 6 * 7 * 24 * 60 * 60 * 1000)
  const countRes = await db.collection('seasons').where({ circleId: circle._id }).count()
  const seasonNo = (countRes.total || 0) + 1
  const seasonName = getSeasonName(now, seasonNo)

  const res = await db.collection('seasons').add({
    data: {
      circleId: circle._id,
      seasonNo,
      seasonName,
      startAt,
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
    startAt,
    endAt,
    status: 'ongoing',
    rankings: []
  }
}

function endedGamesQuery(queryStart, seasonEnd) {
  return db
    .collection('games')
    .where(
      _.and([{ status: 'ended' }, { endedAt: _.gte(queryStart) }, { endedAt: _.lt(seasonEnd) }])
    )
}

async function fetchEndedGames(queryStart, seasonEnd) {
  const PAGE_SIZE = 100
  const readPage = skip =>
    endedGamesQuery(queryStart, seasonEnd)
      .field({
        players: true,
        bigBlind: true,
        excludeFromSeason: true,
        startedAt: true,
        endedAt: true,
        name: true
      })
      .orderBy('endedAt', 'asc')
      .skip(skip)
      .limit(PAGE_SIZE)
      .get()

  const pages = []
  const countRes = await endedGamesQuery(queryStart, seasonEnd)
    .count()
    .catch(() => null)
  if (countRes && typeof countRes.total === 'number') {
    const total = countRes.total || 0
    for (let skip = 0; skip < total; skip += PAGE_SIZE * 5) {
      const batch = []
      for (let s = skip; s < Math.min(skip + PAGE_SIZE * 5, total); s += PAGE_SIZE) {
        batch.push(readPage(s))
      }
      pages.push(...(await Promise.all(batch)))
    }
  } else {
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const page = await readPage(skip)
      pages.push(page)
      if ((page.data || []).length < PAGE_SIZE) break
    }
  }

  return [
    ...new Map(
      pages
        .reduce((list, r) => list.concat(r.data || []), [])
        .filter(Boolean)
        .map(g => [g._id, g])
    ).values()
  ]
}

async function fetchActiveCircles() {
  const PAGE_SIZE = 100
  const query = () => db.collection('circles').where({ status: 'active' })
  const countRes = await query()
    .count()
    .catch(() => null)
  const out = []
  if (countRes && typeof countRes.total === 'number') {
    const total = countRes.total || 0
    for (let skip = 0; skip < total; skip += PAGE_SIZE) {
      const page = await query().skip(skip).limit(PAGE_SIZE).get()
      out.push(...(page.data || []))
    }
  } else {
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const page = await query().skip(skip).limit(PAGE_SIZE).get()
      out.push(...(page.data || []))
      if ((page.data || []).length < PAGE_SIZE) break
    }
  }
  return out
}

async function calcForCircle(circleId) {
  const got = await db
    .collection('circles')
    .doc(circleId)
    .get()
    .catch(() => null)
  if (!got || !got.data || got.data.status !== 'active') {
    return { ok: false, error: 'CIRCLE_NOT_ACTIVE' }
  }

  const circle = got.data
  const season = await ensureSeason(circle)
  if (!season || season.status !== 'ongoing') return { ok: false, error: 'NO_ACTIVE_SEASON' }

  const seasonStart = new Date(season.startAt)
  const seasonEnd = new Date(season.endAt)
  const members = circle.memberOpenids || []
  if (!members.length) {
    await db
      .collection('seasons')
      .doc(season._id)
      .update({
        data: {
          rankings: [],
          gameSummaries: [],
          calculatedAt: new Date(),
          calculationMeta: {
            algorithmVersion: ALGO_VERSION,
            reason: 'NO_MEMBERS'
          }
        }
      })
    return { ok: true, seasonId: season._id, rankedCount: 0, qualifiedCount: 0 }
  }
  const circleCreatedAt = circle.createdAt ? new Date(circle.createdAt) : seasonStart
  // 第一季允许把创建积分榜前已经结算的近期局纳入；后续赛季必须严格按赛季窗口算。
  const queryStart =
    Number(season.seasonNo) <= 1 && circleCreatedAt < seasonStart ? circleCreatedAt : seasonStart

  const allGames = await fetchEndedGames(queryStart, seasonEnd)

  const MIN_PLAYERS = 4
  const MIN_DURATION_MS = 20 * 60 * 1000
  // 被淘汰/踢出的玩家不计入任何统计（新踢人已直接移除，eliminatedAt 过滤兜底旧数据）
  const activePlayers = g => (g.players || []).filter(p => !p.eliminatedAt)
  // 达到人数/时长门槛且含本圈成员的候选局（不看 excludeFromSeason），供列表展示与排除/恢复
  const candidateGames = allGames.filter(g => {
    if (activePlayers(g).length < MIN_PLAYERS) return false
    const dur = new Date(g.endedAt) - new Date(g.startedAt)
    if (dur < MIN_DURATION_MS) return false
    if (!activePlayers(g).some(p => members.includes(p.openid))) return false
    return true
  })
  // 真正计入排名的局：候选局中未被排除的
  const qualifiedGames = candidateGames.filter(g => !g.excludeFromSeason)

  const memberSet = {}
  members.forEach(openid => {
    memberSet[openid] = true
  })

  const memberStats = {}
  members.forEach(openid => {
    memberStats[openid] = { profitBB: 0, games: 0, wins: 0, rawProfit: 0 }
  })

  qualifiedGames.forEach(g => {
    const bb = Math.max(1, Number(g.bigBlind) || 1)
    activePlayers(g).forEach(p => {
      if (!memberSet[p.openid]) return
      if (!memberStats[p.openid]) return
      const profit = p.finalProfit ?? p.profit ?? 0
      const profitBB = Math.round(profit / bb)
      memberStats[p.openid].profitBB += profitBB
      memberStats[p.openid].rawProfit += Number(profit) || 0
      memberStats[p.openid].games++
      if (profit > 0) memberStats[p.openid].wins++
    })
  })

  const titles = getTitles()
  const MIN_GAMES = 1
  const ranked = Object.entries(memberStats)
    .filter(([, s]) => s.games >= MIN_GAMES)
    .sort(
      ([oa, a], [ob, b]) =>
        b.profitBB - a.profitBB ||
        b.rawProfit - a.rawProfit ||
        b.wins - a.wins ||
        a.games - b.games ||
        oa.localeCompare(ob)
    )

  const nameMap = {}
  const avatarMap = {}
  try {
    const usersRes = await db
      .collection('users')
      .where({ _openid: _.in(members) })
      .limit(1000)
      .get()
    usersRes.data.forEach(u => {
      nameMap[u._openid] = u.nickname || '玩家'
      avatarMap[u._openid] = u.avatar || ''
    })
  } catch (err) {
    console.error('[calcSeasonScore users]', err)
  }

  const rankings = ranked.map(([openid, s], i) => ({
    openid,
    nickname: nameMap[openid] || '玩家',
    avatar: avatarMap[openid] || '',
    profitBB: s.profitBB,
    rawProfit: s.rawProfit,
    games: s.games,
    wins: s.wins,
    winRate: s.games ? Math.round((s.wins * 1000) / s.games) / 10 : 0,
    rank: i + 1,
    title: titles[i + 1] || null
  }))

  const unranked = members
    .filter(openid => !ranked.some(([o]) => o === openid))
    .map(openid => {
      const s = memberStats[openid] || {}
      const games = s.games || 0
      const wins = s.wins || 0
      return {
        openid,
        nickname: nameMap[openid] || '玩家',
        avatar: avatarMap[openid] || '',
        profitBB: s.profitBB || 0,
        rawProfit: s.rawProfit || 0,
        games,
        wins,
        winRate: games ? Math.round((wins * 1000) / games) / 10 : 0,
        rank: 0,
        title: null
      }
    })

  // 比赛摘要直接存到 season 文档，圈子详情页免扫描直读；含被排除的局(带 excluded 标记)供恢复
  const gameSummaries = candidateGames
    .slice(-50)
    .reverse()
    .map(g => ({
      _id: g._id,
      name: g.name || '',
      playerCount: activePlayers(g).length,
      startedAt: g.startedAt,
      endedAt: g.endedAt,
      excluded: !!g.excludeFromSeason
    }))

  await db
    .collection('seasons')
    .doc(season._id)
    .update({
      data: {
        rankings: [...rankings, ...unranked],
        gameSummaries,
        calculatedAt: new Date(),
        calculationMeta: {
          algorithmVersion: ALGO_VERSION,
          queryStart,
          queryEnd: seasonEnd,
          fetchedCount: allGames.length,
          qualifiedCount: qualifiedGames.length,
          memberCount: members.length
        }
      }
    })

  return {
    ok: true,
    seasonId: season._id,
    rankedCount: rankings.length,
    qualifiedCount: qualifiedGames.length,
    fetchedCount: allGames.length,
    algorithmVersion: ALGO_VERSION
  }
}

exports.main = async event => {
  const { circleId } = event || {}
  if (circleId) {
    return await calcForCircle(circleId)
  }
  const all = await fetchActiveCircles()
  for (const c of all) {
    await calcForCircle(c._id)
  }
  return { ok: true, processed: all.length }
}
