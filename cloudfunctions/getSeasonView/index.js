// cloudfunctions/getSeasonView/index.js —— 赛季隐私视图（只读聚合）
// 服务端最小视图：只返回调用者有权查看的裁剪结果，前端不再直读全量 rankings。
// 隐私裁剪逻辑集中在 season-view.js（与 miniprogram/utils/season-view.js 镜像）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const { buildSeasonView } = require('./season-view.js')

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
  const named = docs
    .filter(u => meaningfulNickname(u.nickname))
    .sort((a, b) => profileTime(b) - profileTime(a))[0]
  const withAvatar = docs.filter(u => u.avatar).sort((a, b) => profileTime(b) - profileTime(a))[0]
  const latest = docs.slice().sort((a, b) => profileTime(b) - profileTime(a))[0] || {}
  return {
    nickname: named ? named.nickname.trim() : '',
    avatar: withAvatar ? withAvatar.avatar : '',
    profileUpdatedAt: latest.updatedAt || latest.profileUpdatedAt || latest.createdAt || ''
  }
}

// 成员资料以 users 表为准，供成员列表只露头像/昵称。
async function fetchMemberProfiles(memberOpenids) {
  const grouped = {}
  for (let i = 0; i < memberOpenids.length; i += 10) {
    const res = await db
      .collection('users')
      .where({ _openid: _.in(memberOpenids.slice(i, i + 10)) })
      .limit(1000)
      .get()
      .catch(() => ({ data: [] }))
    ;(res.data || []).forEach(u => {
      if (!grouped[u._openid]) grouped[u._openid] = []
      grouped[u._openid].push(u)
    })
  }
  return memberOpenids.map(openid => {
    const merged = mergeUserDocs(grouped[openid] || [])
    return { openid, ...merged }
  })
}

// 调用者本人在该赛季窗口内参与且已结束的记录（只含本人视角字段）。
async function fetchMyGames(viewerOpenid, season) {
  if (!season) return []
  const start = new Date(season.startAt)
  const end = new Date(season.endAt)
  const conditions = [
    { status: 'ended' },
    { players: _.elemMatch({ openid: viewerOpenid }) },
    { endedAt: _.gte(start) },
    { endedAt: _.lt(end) },
    // 已删除（对本人隐藏）的记录不出现在任何列表里
    { hiddenForOpenids: _.nin([viewerOpenid]) }
  ]
  const res = await db
    .collection('games')
    .where(_.and(conditions))
    .field({ players: true, name: true, startedAt: true, endedAt: true, excludeFromSeason: true })
    .orderBy('endedAt', 'desc')
    .limit(100)
    .get()
    .catch(() => ({ data: [] }))
  const excluded = new Set(season.excludedGameIds || [])
  return (res.data || []).map(g => {
    const active = (g.players || []).filter(p => !p.eliminatedAt)
    const me = active.find(p => p.openid === viewerOpenid)
    const myProfit = me ? Number(me.finalProfit ?? me.profit) || 0 : 0
    return {
      _id: g._id,
      name: g.name || '',
      playerCount: active.length,
      startedAt: g.startedAt,
      endedAt: g.endedAt,
      myProfit,
      counted: !excluded.has(g._id) && !g.excludeFromSeason
    }
  })
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { circleId } = event || {}
  if (!circleId) return { ok: false, error: 'INVALID_PARAMS' }

  const circleGot = await db
    .collection('circles')
    .doc(circleId)
    .get()
    .catch(() => null)
  if (!circleGot || !circleGot.data) return { ok: false, error: 'CIRCLE_NOT_FOUND' }
  const circle = circleGot.data

  const memberOpenids = circle.memberOpenids || []
  if (!memberOpenids.includes(OPENID)) return { ok: false, error: 'NOT_MEMBER' }

  const seasonId = event.seasonId || circle.currentSeasonId
  let season = null
  if (seasonId) {
    const seasonGot = await db
      .collection('seasons')
      .doc(seasonId)
      .get()
      .catch(() => null)
    if (seasonGot && seasonGot.data) season = seasonGot.data
  }

  const [memberProfiles, myGames, settledSeasons] = await Promise.all([
    fetchMemberProfiles(memberOpenids),
    fetchMyGames(OPENID, season),
    db
      .collection('seasons')
      .where({ circleId, status: 'settled' })
      .field({ championOpenid: true })
      .limit(1000)
      .get()
      .catch(() => ({ data: [] }))
  ])

  const view = buildSeasonView({ season, circle, memberProfiles, myGames, viewerOpenid: OPENID })
  // 冠军荣誉出口：本榜历届夺冠次数（字段只加，老前端自动忽略）
  if (view && view.isMember) {
    const championCounts = {}
    ;(settledSeasons.data || []).forEach(s => {
      if (s.championOpenid) {
        championCounts[s.championOpenid] = (championCounts[s.championOpenid] || 0) + 1
      }
    })
    view.championCounts = championCounts
  }
  return view
}
