// 镜像自 miniprogram/utils/season-view.js —— 赛季隐私裁剪纯函数。
// 两处必须保持一致：改动其一必须同步另一处并跑测试。
function pickHonors(rankings) {
  return (rankings || [])
    .filter(r => r.rank > 0 && r.rank <= 3 && (r.games || 0) > 0)
    .sort((a, b) => a.rank - b.rank)
    .map(({ openid, nickname, avatar, profileUpdatedAt, rank }) => ({
      openid,
      nickname,
      avatar,
      profileUpdatedAt,
      rank
    }))
}

function sanitizeMembers(memberOpenids, memberProfiles) {
  const profileMap = {}
  ;(memberProfiles || []).forEach(p => {
    profileMap[p.openid] = p
  })
  return (memberOpenids || []).map(openid => {
    const p = profileMap[openid] || {}
    return {
      openid,
      nickname: p.nickname || '',
      avatar: p.avatar || '',
      profileUpdatedAt: p.profileUpdatedAt || ''
    }
  })
}

function buildOwnerReview(gameSummaries, excludedIds) {
  return (gameSummaries || []).map(g => {
    const start = new Date(g.startedAt)
    const end = new Date(g.endedAt)
    const durationMin = Math.round((end - start) / 60000)
    const shortId = (g._id || '').slice(-6).toUpperCase()
    return {
      shortId,
      startedAt: g.startedAt,
      endedAt: g.endedAt,
      playerCount: g.playerCount || 0,
      durationMin,
      compliant: durationMin >= 20 && (g.playerCount || 0) >= 4,
      excluded: !!(excludedIds && excludedIds.has(g._id))
    }
  })
}

function buildSeasonView(input) {
  const { season, circle, memberProfiles, myGames, viewerOpenid } = input || {}
  const memberOpenids = circle?.memberOpenids || []
  const isMember = memberOpenids.includes(viewerOpenid)
  const isOwner = circle?.ownerOpenid === viewerOpenid

  const seasonInfo = season
    ? {
      seasonId: season._id,
      seasonName: season.seasonName || '',
      seasonNo: season.seasonNo || 0,
      startAt: season.startAt || '',
      endAt: season.endAt || '',
      status: season.status || ''
    }
    : null

  if (!isMember) {
    return {
      ok: true,
      isMember: false,
      isOwner: false,
      season: seasonInfo,
      honors: [],
      me: null,
      members: [],
      myGames: [],
      ownerReview: null
    }
  }

  const honors = pickHonors(season?.rankings)
  const members = sanitizeMembers(memberOpenids, memberProfiles)

  const meRanking = (season?.rankings || []).find(r => r.openid === viewerOpenid)
  const me =
    meRanking && meRanking.games > 0
      ? {
        rank: meRanking.rank,
        profitBB: meRanking.profitBB,
        rawProfit: meRanking.rawProfit,
        games: meRanking.games,
        wins: meRanking.wins,
        winRate: meRanking.winRate
      }
      : null

  const filteredGames = (myGames || []).filter(g => g.counted !== false)

  const excludedIds = new Set(season?.excludedGameIds || [])
  const ownerReview = isOwner ? buildOwnerReview(season?.gameSummaries, excludedIds) : null

  return {
    ok: true,
    isMember,
    isOwner,
    season: seasonInfo,
    honors,
    me,
    members,
    myGames: filteredGames,
    ownerReview
  }
}

module.exports = { buildSeasonView, pickHonors, sanitizeMembers, buildOwnerReview }
