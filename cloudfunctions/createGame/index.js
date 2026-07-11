// cloudfunctions/createGame/index.js — 创建牌局
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const GENERIC_NICKNAMES = new Set(['玩家', '庄家', '微信用户', '未设置昵称'])

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
    nickname: named ? named.nickname.trim() : '',
    avatar: withAvatar ? withAvatar.avatar : '',
    updatedAt: latest.updatedAt || latest.profileUpdatedAt || latest.createdAt || ''
  }
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
  } = event

  const normalizedName = typeof name === 'string' ? name.trim() : ''
  const normalizedBuyIn = Number(buyIn)
  const normalizedSmallBlind = Number(smallBlind)
  const normalizedBigBlind = Number(bigBlind)
  if (!normalizedName) return { ok: false, error: 'INVALID_NAME' }
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

  // users 是权威资料；历史线上用户尚未迁入 users 时，使用客户端已校验资料兜底。
  // 兜底只补空值，不能让旧本地缓存覆盖玩家刚更新的云端资料。
  let finalNickname = meaningfulNickname(nickname) ? nickname.trim() : ''
  let finalAvatar = typeof avatar === 'string' ? avatar : ''
  let profileUpdatedAt = ''
  try {
    const user = await getLatestProfile(OPENID)
    if (meaningfulNickname(user.nickname)) finalNickname = user.nickname
    if (user.avatar) finalAvatar = user.avatar
    profileUpdatedAt = user.updatedAt || ''
  } catch (_) {}
  if (!meaningfulNickname(finalNickname)) return { ok: false, error: 'PROFILE_REQUIRED' }

  const inviteCode = await uniqueCode()
  const now = new Date()
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
    players: [
      {
        openid: OPENID,
        nickname: finalNickname,
        avatar: finalAvatar,
        profileUpdatedAt,
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
    const created = await db.runTransaction(async transaction => {
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
    }, 3)
    return { ok: true, gameId: created.gameId, inviteCode }
  } catch (err) {
    console.error('[createGame txn]', err)
    return { ok: false, error: 'CONFLICT_RETRY' }
  }
}
