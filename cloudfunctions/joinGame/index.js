// cloudfunctions/joinGame/index.js — 加入牌局
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { inviteCode, nickname = '玩家', avatar = '', mode = 'player', hands = 1 } = event

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
  let finalNickname = nickname
  let finalAvatar = avatar
  try {
    const userQ = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    if (userQ.data.length) {
      const u = userQ.data[0]
      if (u.nickname) finalNickname = u.nickname
      if (u.avatar) finalAvatar = u.avatar
    }
  } catch (_) {}

  const buyHands = Math.max(1, Math.floor(Number(hands) || 1))
  const amount = game.buyIn * buyHands
  const now = new Date()
  const player = {
    openid: OPENID,
    nickname: finalNickname,
    avatar: finalAvatar,
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
