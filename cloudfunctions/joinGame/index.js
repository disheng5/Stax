// cloudfunctions/joinGame/index.js — 加入牌局
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const GENERIC_NICKNAMES = new Set(['玩家', '庄家', '微信用户', '未设置昵称'])

function meaningfulNickname(value) {
  const nickname = typeof value === 'string' ? value.trim() : ''
  return !!nickname && !GENERIC_NICKNAMES.has(nickname)
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

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { inviteCode, mode = 'player', hands = 1 } = event

  if (!/^[A-Z0-9]{6}$/.test(inviteCode || '')) return { ok: false, error: 'INVALID_CODE' }

  const found = await db.collection('games').where({ inviteCode, status: 'ongoing' }).limit(1).get()

  if (!found.data.length) return { ok: false, error: 'GAME_NOT_FOUND' }
  const game = found.data[0]

  if (mode === 'viewer') {
    return { ok: true, gameId: game._id, viewer: true }
  }

  // 已在则直接返回
  const exists = (game.players || []).find(p => p.openid === OPENID)
  if (exists) return { ok: true, gameId: game._id, alreadyJoined: true }

  // 从 users 表获取最新昵称和头像，保证其他用户能看到
  let finalNickname = ''
  let finalAvatar = ''
  let profileUpdatedAt = ''
  try {
    const user = await getLatestProfile(OPENID)
    if (user.nickname) finalNickname = user.nickname
    if (user.avatar) finalAvatar = user.avatar
    profileUpdatedAt = user.updatedAt || ''
  } catch (_) {}
  if (!meaningfulNickname(finalNickname)) return { ok: false, error: 'PROFILE_REQUIRED' }

  const buyHands = Math.max(1, Math.floor(Number(hands) || 1))
  const amount = game.buyIn * buyHands
  const now = new Date()
  const player = {
    openid: OPENID,
    nickname: finalNickname,
    avatar: finalAvatar,
    profileUpdatedAt,
    buyInCount: buyHands,
    totalBuyIn: amount,
    currentStack: amount,
    finalStack: null,
    profit: 0,
    joinedAt: now,
    eliminatedAt: null
  }

  // 事务内查重 + 写入，避免同一用户双端并发加入产生重复玩家
  let txn
  try {
    txn = await db.runTransaction(async transaction => {
      const snap = await transaction
        .collection('games')
        .doc(game._id)
        .get()
        .catch(() => null)
      if (!snap || !snap.data || snap.data.status !== 'ongoing')
        return { ok: false, error: 'GAME_NOT_FOUND' }
      const cur = snap.data
      if ((cur.players || []).some(p => p.openid === OPENID))
        return { ok: true, alreadyJoined: true }
      await transaction
        .collection('games')
        .doc(game._id)
        .update({
          data: {
            players: [...(cur.players || []), player],
            totalPot: (Number(cur.totalPot) || 0) + amount
          }
        })
      return { ok: true }
    }, 3)
  } catch (err) {
    console.error('[joinGame txn]', err)
    return { ok: false, error: 'CONFLICT_RETRY' }
  }
  if (!txn.ok) return txn
  if (txn.alreadyJoined) return { ok: true, gameId: game._id, alreadyJoined: true }

  await db.collection('transactions').add({
    data: {
      gameId: game._id,
      type: 'buyIn',
      playerOpenid: OPENID,
      amount,
      operatorOpenid: OPENID,
      timestamp: now,
      meta: { hands: buyHands }
    }
  })

  return { ok: true, gameId: game._id }
}
