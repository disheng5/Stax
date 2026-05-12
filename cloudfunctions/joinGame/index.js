// cloudfunctions/joinGame/index.js — 加入牌局
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { inviteCode, nickname = '玩家', avatar = '' } = event

  if (!/^[A-Z0-9]{6}$/.test(inviteCode || '')) return { ok: false, error: 'INVALID_CODE' }

  const found = await db
    .collection('games')
    .where({ inviteCode, status: 'ongoing' })
    .limit(1)
    .get()

  if (!found.data.length) return { ok: false, error: 'GAME_NOT_FOUND' }
  const game = found.data[0]

  // 已在则直接返回
  const exists = (game.players || []).find(p => p.openid === OPENID)
  if (exists) return { ok: true, gameId: game._id, alreadyJoined: true }

  const now = new Date()
  const player = {
    openid: OPENID,
    nickname,
    avatar,
    buyInCount: 1,
    totalBuyIn: game.buyIn,
    currentStack: game.buyIn,
    finalStack: null,
    profit: 0,
    joinedAt: now,
    eliminatedAt: null
  }

  await db
    .collection('games')
    .doc(game._id)
    .update({
      data: {
        players: _.push([player]),
        totalPot: _.inc(game.buyIn)
      }
    })

  await db.collection('transactions').add({
    data: {
      gameId: game._id,
      type: 'buyIn',
      playerOpenid: OPENID,
      amount: game.buyIn,
      operatorOpenid: OPENID,
      timestamp: now
    }
  })

  return { ok: true, gameId: game._id }
}
