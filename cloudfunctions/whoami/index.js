// cloudfunctions/whoami/index.js — 当前用户身份与资料的唯一写入口
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const GENERIC_NICKNAMES = new Set(['玩家', '庄家', '微信用户', '未设置昵称'])
const PAGE_SIZE = 100

function meaningfulNickname(value) {
  const nickname = typeof value === 'string' ? value.trim() : ''
  return !!nickname && nickname.length <= 24 && !GENERIC_NICKNAMES.has(nickname)
}

function timeValue(value) {
  if (!value) return 0
  const n = +new Date(value)
  return Number.isFinite(n) ? n : 0
}

function profileTime(profile) {
  return timeValue(profile.updatedAt || profile.profileUpdatedAt || profile.createdAt)
}

function sortProfiles(a, b) {
  const nameDiff = Number(meaningfulNickname(b.nickname)) - Number(meaningfulNickname(a.nickname))
  if (nameDiff) return nameDiff
  const timeDiff = profileTime(b) - profileTime(a)
  if (timeDiff) return timeDiff
  return Number(!!b.avatar) - Number(!!a.avatar)
}

function bestProfile(candidates) {
  const sorted = (candidates || []).filter(Boolean).slice().sort(sortProfiles)
  const best = sorted[0] || {}
  const named = sorted.find(p => meaningfulNickname(p.nickname))
  const withAvatar = sorted
    .filter(p => p.avatar)
    .sort((a, b) => profileTime(b) - profileTime(a))[0]
  const withStats = sorted.find(p => p.stats)
  return {
    ...best,
    nickname: named ? named.nickname.trim() : '',
    avatar: withAvatar ? withAvatar.avatar : '',
    stats: (withStats && withStats.stats) || best.stats
  }
}

async function runBatches(list, size, worker) {
  for (let i = 0; i < list.length; i += size) {
    await Promise.all(list.slice(i, i + size).map(worker))
  }
}

async function fetchAll(queryFactory) {
  const out = []
  const countRes = await queryFactory()
    .count()
    .catch(() => null)
  if (countRes && typeof countRes.total === 'number') {
    const total = countRes.total || 0
    for (let skip = 0; skip < total; skip += PAGE_SIZE) {
      const page = await queryFactory().skip(skip).limit(PAGE_SIZE).get()
      out.push(...(page.data || []))
    }
  } else {
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const page = await queryFactory().skip(skip).limit(PAGE_SIZE).get()
      out.push(...(page.data || []))
      if ((page.data || []).length < PAGE_SIZE) break
    }
  }
  return out
}

async function findLatestGameProfile(openid) {
  const read = (status, orderField) =>
    db
      .collection('games')
      .where({ status, players: _.elemMatch({ openid }) })
      .orderBy(orderField, 'desc')
      .limit(10)
      .get()
      .then(r => r.data || [])
      .catch(err => {
        console.warn('[whoami profile recovery]', status, err)
        return []
      })
  const [ongoing, ended] = await Promise.all([
    read('ongoing', 'startedAt'),
    read('ended', 'endedAt')
  ])
  const candidates = [...ongoing, ...ended]
    .map(game => {
      const player = (game.players || []).find(p => p.openid === openid)
      if (!player) return null
      return {
        nickname: player.nickname,
        avatar: player.avatar,
        updatedAt:
          player.profileUpdatedAt || game.profileUpdatedAt || game.endedAt || game.startedAt
      }
    })
    .filter(Boolean)
  return bestProfile(candidates)
}

async function syncProfileToGames(openid, nickname, avatar, updatedAt) {
  try {
    const games = await fetchAll(() =>
      db.collection('games').where({ status: 'ongoing', players: _.elemMatch({ openid }) })
    )
    const stale = games.filter(game =>
      (game.players || []).some(
        p =>
          p.openid === openid &&
          ((nickname && p.nickname !== nickname) || (avatar && p.avatar !== avatar))
      )
    )
    await runBatches(stale, 10, game =>
      db
        .runTransaction(async transaction => {
          const snap = await transaction.collection('games').doc(game._id).get().catch(() => null)
          if (!snap || !snap.data || snap.data.status !== 'ongoing') return
          const players = (snap.data.players || []).map(p =>
            p.openid === openid
              ? {
                ...p,
                nickname: nickname || p.nickname,
                avatar: avatar || p.avatar,
                profileUpdatedAt: updatedAt
              }
              : p
          )
          await transaction
            .collection('games')
            .doc(game._id)
            .update({ data: { players, profileUpdatedAt: updatedAt } })
        }, 3)
        .catch(err => console.error('[syncProfileToGames txn]', game._id, err))
    )
  } catch (err) {
    console.error('[syncProfileToGames]', err)
  }
}

async function syncProfileToSeasons(openid, nickname, avatar, updatedAt) {
  try {
    const circles = await fetchAll(() =>
      db
        .collection('circles')
        .where({ status: 'active', memberOpenids: _.elemMatch(_.eq(openid)) })
    )
    const seasonIds = [...new Set(circles.map(c => c.currentSeasonId).filter(Boolean))]
    await runBatches(seasonIds, 10, seasonId =>
      db.runTransaction(async transaction => {
        const got = await transaction
          .collection('seasons')
          .doc(seasonId)
          .get()
          .catch(() => null)
        if (!got || !got.data || got.data.status !== 'ongoing') return
        const rankings = got.data.rankings || []
        if (!rankings.some(r => r.openid === openid)) return
        const next = rankings.map(r =>
          r.openid === openid
            ? {
              ...r,
              nickname: nickname || r.nickname,
              avatar: avatar || r.avatar,
              profileUpdatedAt: updatedAt
            }
            : r
        )
        await transaction
          .collection('seasons')
          .doc(seasonId)
          .update({ data: { rankings: next, profileUpdatedAt: updatedAt } })
      }, 3)
    )
  } catch (err) {
    console.error('[syncProfileToSeasons]', err)
  }
}

function serializeUser(user) {
  return {
    ...user,
    updatedAt: user.updatedAt ? new Date(user.updatedAt).toISOString() : ''
  }
}

exports.main = async event => {
  try {
    const { OPENID } = cloud.getWXContext()
    const {
      upsertNickname,
      upsertAvatar,
      bootstrapNickname,
      bootstrapAvatar,
      bootstrapOpenid
    } = event || {}

    if (!OPENID) return { ok: false, error: 'OPENID_UNAVAILABLE_IN_TEST_CONSOLE' }
    if (upsertNickname !== undefined && !meaningfulNickname(upsertNickname)) {
      return { ok: false, error: 'INVALID_NICKNAME' }
    }

    const q = await db.collection('users').where({ _openid: OPENID }).limit(PAGE_SIZE).get()
    const docs = q.data || []
    const stored = bestProfile(docs)
    let nickname = stored.nickname || ''
    let avatar = stored.avatar || ''

    if (
      !meaningfulNickname(nickname) ||
      (!avatar && Number(stored.profileVersion || 0) < 2)
    ) {
      const recovered = await findLatestGameProfile(OPENID)
      if (!meaningfulNickname(nickname) && meaningfulNickname(recovered.nickname)) {
        nickname = recovered.nickname.trim()
      }
      if (!avatar && recovered.avatar) avatar = recovered.avatar
    }

    // bootstrap 只填历史空值，绝不覆盖云端已有真资料。
    const canBootstrap = bootstrapOpenid === OPENID
    if (
      canBootstrap &&
      !meaningfulNickname(nickname) &&
      meaningfulNickname(bootstrapNickname)
    ) {
      nickname = bootstrapNickname.trim()
    }
    if (canBootstrap && !avatar && bootstrapAvatar) avatar = bootstrapAvatar

    if (upsertNickname !== undefined) nickname = upsertNickname.trim()
    if (upsertAvatar !== undefined) avatar = upsertAvatar || ''

    const profileChanged = stored.nickname !== nickname || (stored.avatar || '') !== avatar
    const needsConsolidation = docs.some(
      doc =>
        doc.nickname !== nickname ||
        (doc.avatar || '') !== avatar ||
        Number(doc.profileVersion || 0) < 2
    )
    const now = new Date()
    const updatedAt =
      profileChanged || !timeValue(stored.updatedAt) ? now : new Date(stored.updatedAt)
    const stats = stored.stats || {
      totalGames: 0,
      totalProfit: 0,
      biggestWin: 0,
      biggestLoss: 0,
      wins: 0
    }

    let userId = stored._id || ''
    if (!docs.length) {
      const created = await db.collection('users').add({
        data: {
          nickname: nickname || '玩家',
          avatar,
          createdAt: now,
          updatedAt,
          profileVersion: 2,
          stats
        }
      })
      userId = created._id
    } else if (profileChanged || needsConsolidation) {
      await runBatches(docs, 10, doc =>
        db
          .collection('users')
          .doc(doc._id)
          .update({
            data: {
              nickname: nickname || '玩家',
              avatar,
              updatedAt,
              profileVersion: 2
            }
          })
      )
    }

    const user = {
      ...stored,
      _id: userId,
      _openid: OPENID,
      nickname: nickname || '玩家',
      avatar,
      updatedAt,
      profileVersion: 2,
      stats
    }

    if (profileChanged) {
      await Promise.all([
        syncProfileToGames(OPENID, nickname, avatar, updatedAt),
        syncProfileToSeasons(OPENID, nickname, avatar, updatedAt)
      ])
    }

    return { ok: true, openid: OPENID, user: serializeUser(user) }
  } catch (err) {
    return { ok: false, error: err.message || String(err), code: err.code || err.errCode || '' }
  }
}
