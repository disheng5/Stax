// cloudfunctions/createGame/index.js — 创建牌局
const cloud = require('wx-server-sdk')
const { recoverLegacyNickname } = require('./game-name.js')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const GENERIC_NICKNAMES = new Set(['玩家', '庄家', '微信用户', '未设置昵称'])
const DEFAULT_STATS = {
  totalGames: 0,
  totalProfit: 0,
  biggestWin: 0,
  biggestLoss: 0,
  wins: 0
}

function meaningfulNickname(value) {
  const nickname = typeof value === 'string' ? value.trim() : ''
  return !!nickname && nickname.length <= 24 && !GENERIC_NICKNAMES.has(nickname)
}

function profileTime(user) {
  const n = +new Date(user.updatedAt || user.profileUpdatedAt || user.createdAt || 0)
  return Number.isFinite(n) ? n : 0
}

async function getLatestProfile(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(100).get()
  const users = res.data || []
  const named = users
    .filter(u => meaningfulNickname(u.nickname))
    .sort((a, b) => profileTime(b) - profileTime(a))[0]
  const withAvatar = users.filter(u => u.avatar).sort((a, b) => profileTime(b) - profileTime(a))[0]
  const latest = users.slice().sort((a, b) => profileTime(b) - profileTime(a))[0] || {}
  return {
    users,
    nickname: named ? named.nickname.trim() : '',
    avatar: withAvatar ? withAvatar.avatar : '',
    updatedAt:
      (named && (named.updatedAt || named.profileUpdatedAt || named.createdAt)) ||
      latest.updatedAt ||
      latest.profileUpdatedAt ||
      latest.createdAt ||
      ''
  }
}

async function findLatestGameProfile(openid) {
  const read = (status, orderField) =>
    db
      .collection('games')
      .where({ status, players: _.elemMatch({ openid }) })
      .orderBy(orderField, 'desc')
      .limit(10)
      .get()
      .then(res => res.data || [])
      .catch(err => {
        console.warn('[createGame profile history]', status, err)
        return []
      })

  const [ongoing, ended] = await Promise.all([
    read('ongoing', 'startedAt'),
    read('ended', 'endedAt')
  ])
  const profiles = [...ongoing, ...ended]
    .map(game => {
      const player = (game.players || []).find(item => item.openid === openid)
      if (!player) return null
      return {
        nickname: player.nickname,
        avatar: player.avatar || '',
        updatedAt:
          player.profileUpdatedAt || game.profileUpdatedAt || game.endedAt || game.startedAt || ''
      }
    })
    .filter(Boolean)
    .sort((a, b) => profileTime(b) - profileTime(a))

  const named = profiles.find(item => meaningfulNickname(item.nickname))
  const withAvatar = profiles.find(item => item.avatar)
  return {
    nickname: named ? named.nickname.trim() : '',
    avatar: withAvatar ? withAvatar.avatar : '',
    updatedAt: (named && named.updatedAt) || (withAvatar && withAvatar.updatedAt) || ''
  }
}

async function resolveProfile(openid, clientNickname, clientAvatar, rawName) {
  let stored = { users: [], nickname: '', avatar: '', updatedAt: '' }
  let usersReadSucceeded = false
  try {
    stored = await getLatestProfile(openid)
    usersReadSucceeded = true
  } catch (err) {
    console.warn('[createGame profile users]', err)
  }

  const hasStoredIdentity = meaningfulNickname(stored.nickname)
  let nickname = hasStoredIdentity ? stored.nickname.trim() : ''
  let avatar = hasStoredIdentity
    ? stored.avatar || ''
    : stored.avatar || (typeof clientAvatar === 'string' ? clientAvatar : '')
  let source = hasStoredIdentity ? 'users' : ''

  if (!nickname && meaningfulNickname(clientNickname)) {
    nickname = clientNickname.trim()
    source = 'client'
  }

  // 已发布旧版本会把昵称写进自动生成的记录名，但部分账号没有正确传 nickname。
  // 只识别旧生成器的完整固定格式，避免从用户自定义名称中猜测身份。
  if (!nickname) {
    const legacyNickname = recoverLegacyNickname(rawName)
    if (meaningfulNickname(legacyNickname)) {
      nickname = legacyNickname
      source = 'legacyName'
    }
  }

  if (!hasStoredIdentity && (!nickname || !avatar)) {
    const history = await findLatestGameProfile(openid)
    if (!nickname && meaningfulNickname(history.nickname)) {
      nickname = history.nickname
      source = 'gameHistory'
    }
    if (!avatar && history.avatar) avatar = history.avatar
  }

  return {
    nickname,
    avatar,
    updatedAt: source === 'users' ? stored.updatedAt : '',
    source,
    users: stored.users || [],
    usersReadSucceeded
  }
}

async function persistRecoveredProfile(profile, now) {
  if (
    !profile.usersReadSucceeded ||
    profile.source === 'users' ||
    !meaningfulNickname(profile.nickname)
  ) {
    return
  }

  const data = {
    nickname: profile.nickname.trim(),
    avatar: profile.avatar || '',
    updatedAt: now,
    profileVersion: 2
  }
  if (profile.users.length) {
    await Promise.all(
      profile.users.map(user => db.collection('users').doc(user._id).update({ data }))
    )
    return
  }
  await db.collection('users').add({
    data: {
      ...data,
      createdAt: now,
      stats: DEFAULT_STATS
    }
  })
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function genCode(len = 6) {
  let c = ''
  for (let i = 0; i < len; i++) c += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length))
  return c
}

async function uniqueCode() {
  for (let i = 0; i < 8; i++) {
    const code = genCode()
    const dup = await db.collection('games').where({ inviteCode: code, status: 'ongoing' }).count()
    if (dup.total === 0) return code
  }
  throw new Error('GENERATE_CODE_FAILED')
}

function buildBlindStructure(sb, bb, levels = 12) {
  const out = []
  let curSb = sb
  let curBb = bb
  for (let i = 0; i < levels; i++) {
    out.push({ sb: curSb, bb: curBb, ante: i >= 4 ? Math.floor(curBb / 4) : 0 })
    if (i % 2 === 1) {
      curSb *= 2
      curBb *= 2
    } else {
      curSb = Math.floor(curSb * 1.5)
      curBb = Math.floor(curBb * 1.5)
    }
  }
  return out
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const {
    name,
    buyIn = 500,
    smallBlind = 5,
    bigBlind = 5,
    blindUpMinutes = 999,
    playerOpsShared = true,
    scoreRatio = 1,
    nickname = '',
    avatar = ''
  } = event || {}

  const rawName = typeof name === 'string' ? name.trim() : ''
  const normalizedName = rawName
  const normalizedBuyIn = Number(buyIn)
  const normalizedSmallBlind = Number(smallBlind)
  const normalizedBigBlind = Number(bigBlind)
  if (!rawName) return { ok: false, error: 'INVALID_NAME' }
  if (
    !Number.isFinite(normalizedBuyIn) ||
    !Number.isFinite(normalizedSmallBlind) ||
    !Number.isFinite(normalizedBigBlind) ||
    normalizedBuyIn <= 0 ||
    normalizedSmallBlind <= 0 ||
    normalizedBigBlind <= 0
  ) {
    return { ok: false, error: 'INVALID_AMOUNT' }
  }

  const [profile, inviteCode] = await Promise.all([
    resolveProfile(OPENID, nickname, avatar, rawName),
    uniqueCode()
  ])
  if (!meaningfulNickname(profile.nickname)) return { ok: false, error: 'PROFILE_REQUIRED' }

  const now = new Date()
  if (profile.source !== 'users') {
    console.info('[createGame profile recovered]', {
      source: profile.source,
      hadUserDoc: profile.users.length > 0
    })
  }
  const blindStructure = buildBlindStructure(normalizedSmallBlind, normalizedBigBlind)

  const doc = {
    hostOpenid: OPENID,
    name: normalizedName,
    status: 'ongoing',
    buyIn: normalizedBuyIn,
    smallBlind: normalizedSmallBlind,
    bigBlind: normalizedBigBlind,
    blindUpMinutes,
    playerOpsShared: playerOpsShared !== false,
    scoreRatio: Number(scoreRatio) > 0 ? Number(scoreRatio) : 1,
    blindStructure,
    currentLevel: 0,
    levelStartedAt: now,
    paused: false,
    pausedAt: null,
    pausedAccumMs: 0,
    startedAt: now,
    endedAt: null,
    inviteCode,
    txRevision: 1,
    stateRevision: 1,
    players: [
      {
        openid: OPENID,
        nickname: profile.nickname,
        avatar: profile.avatar,
        profileUpdatedAt: profile.updatedAt || now,
        buyInCount: 1,
        totalBuyIn: normalizedBuyIn,
        currentStack: normalizedBuyIn,
        finalStack: null,
        profit: 0,
        joinedAt: now,
        eliminatedAt: null
      }
    ],
    totalPot: normalizedBuyIn
  }

  try {
    const [created] = await Promise.all([
      db.runTransaction(async transaction => {
        const res = await transaction.collection('games').add({ data: doc })
        await transaction.collection('transactions').add({
          data: {
            gameId: res._id,
            type: 'buyIn',
            playerOpenid: OPENID,
            amount: normalizedBuyIn,
            operatorOpenid: OPENID,
            timestamp: now,
            meta: { hands: 1 }
          }
        })
        return { gameId: res._id }
      }, 3),
      persistRecoveredProfile(profile, now).catch(err => {
        // 资料回填失败不能阻断创建；下次请求仍可再次自愈。
        console.error('[createGame profile persist]', err)
      })
    ])
    return {
      ok: true,
      gameId: created.gameId,
      inviteCode,
      game: {
        ...doc,
        _id: created.gameId
      }
    }
  } catch (err) {
    console.error('[createGame txn]', err)
    return { ok: false, error: 'CONFLICT_RETRY' }
  }
}
