const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const ALGO_VERSION = 5
const EXCLUSION_SCOPE_VERSION = 1
const GENERIC_NICKNAMES = new Set(['玩家', '庄家', '微信用户', '未设置昵称'])

function meaningfulNickname(value) {
  const nickname = typeof value === 'string' ? value.trim() : ''
  return !!nickname && !GENERIC_NICKNAMES.has(nickname)
}

function profileTime(profile) {
  const n = +new Date(profile.updatedAt || profile.profileUpdatedAt || profile.createdAt || 0)
  return Number.isFinite(n) ? n : 0
}

function mergeUserDocs(docs) {
  const sorted = docs.slice().sort((a, b) => {
    const nameDiff = Number(meaningfulNickname(b.nickname)) - Number(meaningfulNickname(a.nickname))
    return nameDiff || profileTime(b) - profileTime(a) || Number(!!b.avatar) - Number(!!a.avatar)
  })
  const named = sorted.find(u => meaningfulNickname(u.nickname))
  const withAvatar = sorted.filter(u => u.avatar).sort((a, b) => profileTime(b) - profileTime(a))[0]
  const latest = sorted.slice().sort((a, b) => profileTime(b) - profileTime(a))[0] || {}
  return {
    nickname: named ? named.nickname.trim() : '',
    avatar: withAvatar ? withAvatar.avatar : '',
    updatedAt: latest.updatedAt || latest.profileUpdatedAt || latest.createdAt || ''
  }
}

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

async function getCurrentSeason(circle) {
  if (!circle.currentSeasonId) return null
  const s = await db
    .collection('seasons')
    .doc(circle.currentSeasonId)
    .get()
    .catch(() => null)
  return s && s.data ? s.data : null
}

async function createSeason(circle) {
  // 并发滚季守卫：后到者复用先到者刚建的新赛季，避免开出两个赛季
  const latest = await db
    .collection('circles')
    .doc(circle._id)
    .get()
    .catch(() => null)
  const currentId = latest?.data?.currentSeasonId
  if (currentId && currentId !== circle.currentSeasonId) {
    const s = await db
      .collection('seasons')
      .doc(currentId)
      .get()
      .catch(() => null)
    if (s?.data?.status === 'ongoing' && new Date() < new Date(s.data.endAt)) return s.data
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
      excludedGameIds: [],
      exclusionScopeVersion: EXCLUSION_SCOPE_VERSION,
      exclusionRevision: 0,
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
    rankings: [],
    excludedGameIds: [],
    exclusionScopeVersion: EXCLUSION_SCOPE_VERSION,
    exclusionRevision: 0
  }
}

// 冠军荣誉写入用户档案；荣誉是附加信息，失败不阻塞赛季状态机（与 settleSeason 同源逻辑）
async function recordChampionHonor(season, champion, now) {
  if (!champion) return
  try {
    const [userQ, circleQ] = await Promise.all([
      db.collection('users').where({ _openid: champion.openid }).limit(100).get(),
      db
        .collection('circles')
        .doc(season.circleId)
        .get()
        .catch(() => null)
    ])
    if (!(userQ.data || []).length) return
    const user = userQ.data
      .slice()
      .sort(
        (a, b) =>
          Number(!!b.nickname) - Number(!!a.nickname) ||
          Number(!!b.avatar) - Number(!!a.avatar)
      )[0]
    await db
      .collection('users')
      .doc(user._id)
      .update({
        data: {
          'honors.championships': _.push([
            {
              circleName: circleQ?.data?.name || '',
              seasonName: season.seasonName,
              profitBB: champion.profitBB,
              achievedAt: now
            }
          ]),
          'honors.totalChampionCount': _.inc(1)
        }
      })
  } catch (err) {
    console.error('[calcSeasonScore honor]', season._id, err)
  }
}

// 到期赛季结账：状态机置 settled + 记冠军；事务内校验 status 防并发重复结账/重复荣誉。
// 不清 currentSeasonId：createSeason 随后覆盖；若开新季失败，视图仍能展示已结账赛季。
async function settleExpiredSeason(seasonId, now) {
  let champion = null
  let seasonDoc = null
  let settledNow = false
  try {
    await db.runTransaction(async transaction => {
      const got = await transaction
        .collection('seasons')
        .doc(seasonId)
        .get()
        .catch(() => null)
      if (!got || !got.data || got.data.status !== 'ongoing') return
      seasonDoc = got.data
      champion = (got.data.rankings || []).find(r => r.rank === 1) || null
      await transaction
        .collection('seasons')
        .doc(seasonId)
        .update({
          data: {
            status: 'settled',
            championOpenid: champion ? champion.openid : null,
            settledAt: now
          }
        })
      settledNow = true
    }, 3)
  } catch (err) {
    console.error('[calcSeasonScore settle]', seasonId, err)
    return { settledNow: false }
  }
  if (settledNow && seasonDoc) await recordChampionHonor(seasonDoc, champion, now)
  return { settledNow }
}

function endedGamesQuery(queryStart, seasonEnd, memberBatch) {
  const conditions = [
    { status: 'ended' },
    { endedAt: _.gte(queryStart) },
    { endedAt: _.lt(seasonEnd) }
  ]
  if (memberBatch && memberBatch.length) {
    conditions.push({ players: _.elemMatch({ openid: _.in(memberBatch) }) })
  }
  return db.collection('games').where(_.and(conditions))
}

async function fetchEndedGamesForBatch(queryStart, seasonEnd, memberBatch) {
  const PAGE_SIZE = 100
  const readPage = skip =>
    endedGamesQuery(queryStart, seasonEnd, memberBatch)
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
  const countRes = await endedGamesQuery(queryStart, seasonEnd, memberBatch)
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

  return pages.reduce((list, r) => list.concat(r.data || []), []).filter(Boolean)
}

async function fetchEndedGames(queryStart, seasonEnd, members) {
  try {
    const pages = []
    for (let i = 0; i < members.length; i += 10) {
      pages.push(
        ...(await fetchEndedGamesForBatch(queryStart, seasonEnd, members.slice(i, i + 10)))
      )
    }
    return [...new Map(pages.map(game => [game._id, game])).values()].sort(
      (a, b) => new Date(a.endedAt) - new Date(b.endedAt)
    )
  } catch (err) {
    // 老环境若尚未建立 players.openid 复合索引，先保证计分可用；部署清单已要求补索引。
    console.warn('[calcSeasonScore member query fallback]', err)
    const all = await fetchEndedGamesForBatch(queryStart, seasonEnd, null)
    return [...new Map(all.map(game => [game._id, game])).values()]
  }
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

async function calcForCircle(circleId, opts = {}) {
  const got = await db
    .collection('circles')
    .doc(circleId)
    .get()
    .catch(() => null)
  if (!got || !got.data || got.data.status !== 'active') {
    return { ok: false, error: 'CIRCLE_NOT_ACTIVE' }
  }

  const circle = got.data
  let season
  if (opts.seasonId) {
    // 指定赛季重算（到期赛季的最终校准路径）：不滚季、不建新季
    const s = await db
      .collection('seasons')
      .doc(opts.seasonId)
      .get()
      .catch(() => null)
    season = s && s.data ? s.data : null
  } else {
    season = await getCurrentSeason(circle)
    const now = new Date()
    if (season && season.status === 'ongoing' && now >= new Date(season.endAt)) {
      // 赛季到期 lazy 结账（settleSeason 无触发器，结账在此完成）：
      // 1) 最终校准——把窗口内最新数据（含 3 小时窗内的赛后修正）写入 rankings
      // 2) 状态机置 settled + 记冠军荣誉  3) 开新一季继续本次重算
      await calcForCircle(circleId, { seasonId: season._id })
      await settleExpiredSeason(season._id, now)
      season = null
    }
    if (!season || season.status !== 'ongoing') {
      season = await createSeason(circle)
    }
  }
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

  const allGames = await fetchEndedGames(queryStart, seasonEnd, members)

  const MIN_PLAYERS = 4
  const MIN_DURATION_MS = 20 * 60 * 1000
  // 被淘汰/踢出的玩家不计入任何统计（新踢人已直接移除，eliminatedAt 过滤兜底旧数据）
  const activePlayers = g => (g.players || []).filter(p => !p.eliminatedAt)
  // 达到人数/时长门槛且含本榜成员的候选局，供列表展示与排除/恢复。
  const candidateGames = allGames.filter(g => {
    if (activePlayers(g).length < MIN_PLAYERS) return false
    const dur = new Date(g.endedAt) - new Date(g.startedAt)
    if (dur < MIN_DURATION_MS) return false
    if (!activePlayers(g).some(p => members.includes(p.openid))) return false
    return true
  })
  // 排除状态属于当前积分榜赛季；首次升级时把旧牌局级标记迁入本季，之后只读赛季字段。
  const excludedGameIds = new Set(season.excludedGameIds || [])
  const needsLegacyMigration = season.exclusionScopeVersion !== EXCLUSION_SCOPE_VERSION
  if (needsLegacyMigration) {
    candidateGames.filter(g => g.excludeFromSeason).forEach(g => excludedGameIds.add(g._id))
  }
  const exclusionRevision = Math.max(0, Number(season.exclusionRevision) || 0)
  const qualifiedGames = candidateGames.filter(g => !excludedGameIds.has(g._id))

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

  // 老数据 users 资料缺失时，优先从最近一局的玩家快照恢复真名和头像。
  // allGames 已按 endedAt 升序，后出现的快照自然覆盖更早的快照。
  const profileMap = {}
  allGames.forEach(game => {
    activePlayers(game).forEach(player => {
      if (!memberSet[player.openid]) return
      const previous = profileMap[player.openid] || {}
      profileMap[player.openid] = {
        nickname: meaningfulNickname(player.nickname)
          ? player.nickname.trim()
          : previous.nickname || '',
        avatar: player.avatar || previous.avatar || '',
        updatedAt:
          player.profileUpdatedAt ||
          game.profileUpdatedAt ||
          game.endedAt ||
          previous.updatedAt ||
          ''
      }
    })
  })

  try {
    const grouped = {}
    for (let i = 0; i < members.length; i += 10) {
      const usersRes = await db
        .collection('users')
        .where({ _openid: _.in(members.slice(i, i + 10)) })
        .limit(1000)
        .get()
      ;(usersRes.data || []).forEach(user => {
        if (!grouped[user._openid]) grouped[user._openid] = []
        grouped[user._openid].push(user)
      })
    }
    Object.keys(grouped).forEach(openid => {
      const user = mergeUserDocs(grouped[openid])
      const fallback = profileMap[openid] || {}
      profileMap[openid] = {
        nickname: user.nickname || fallback.nickname || '',
        avatar: user.avatar || fallback.avatar || '',
        updatedAt: user.updatedAt || fallback.updatedAt || ''
      }
    })
  } catch (err) {
    console.error('[calcSeasonScore users]', err)
  }

  const rankings = ranked.map(([openid, s], i) => ({
    openid,
    nickname: profileMap[openid]?.nickname || '玩家',
    avatar: profileMap[openid]?.avatar || '',
    profileUpdatedAt: profileMap[openid]?.updatedAt || '',
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
        nickname: profileMap[openid]?.nickname || '玩家',
        avatar: profileMap[openid]?.avatar || '',
        profileUpdatedAt: profileMap[openid]?.updatedAt || '',
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
      excluded: excludedGameIds.has(g._id)
    }))

  let updateResult
  if (needsLegacyMigration) {
    try {
      updateResult = await db.runTransaction(async transaction => {
        const latestGot = await transaction
          .collection('seasons')
          .doc(season._id)
          .get()
          .catch(() => null)
        if (!latestGot?.data || latestGot.data.status !== 'ongoing') return { stale: true }
        const latest = latestGot.data
        if (latest.exclusionScopeVersion === EXCLUSION_SCOPE_VERSION) return { stale: true }
        const latestRevision = Math.max(0, Number(latest.exclusionRevision) || 0)
        if (latestRevision !== exclusionRevision) return { stale: true }
        await transaction
          .collection('seasons')
          .doc(season._id)
          .update({
            data: {
              rankings: [...rankings, ...unranked],
              gameSummaries,
              excludedGameIds: [...excludedGameIds],
              exclusionScopeVersion: EXCLUSION_SCOPE_VERSION,
              exclusionRevision,
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
        return { stale: false }
      }, 3)
    } catch (err) {
      console.error('[calcSeasonScore migration txn]', err)
      return { ok: false, error: 'CONFLICT_RETRY' }
    }
  } else {
    updateResult = await db
      .collection('seasons')
      .where({ _id: season._id, exclusionRevision })
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
  }
  const stale = needsLegacyMigration
    ? updateResult?.stale
    : Number(updateResult?.stats?.updated || 0) === 0
  if (stale) return await calcForCircle(circleId, opts)

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
