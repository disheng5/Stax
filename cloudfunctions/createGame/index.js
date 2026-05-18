// cloudfunctions/createGame/index.js — 创建牌局
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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
    nickname = '庄家',
    avatar = ''
  } = event

  if (!name || typeof name !== 'string') return { ok: false, error: 'INVALID_NAME' }
  if (buyIn <= 0 || smallBlind <= 0 || bigBlind <= 0) return { ok: false, error: 'INVALID_AMOUNT' }

  const inviteCode = await uniqueCode()
  const now = new Date()
  const blindStructure = buildBlindStructure(smallBlind, bigBlind)

  const doc = {
    hostOpenid: OPENID,
    name,
    status: 'ongoing',
    buyIn,
    smallBlind,
    bigBlind,
    blindUpMinutes,
    playerOpsShared: playerOpsShared !== false,
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
        nickname,
        avatar,
        buyInCount: 1,
        totalBuyIn: buyIn,
        currentStack: buyIn,
        finalStack: null,
        profit: 0,
        joinedAt: now,
        eliminatedAt: null
      }
    ],
    totalPot: buyIn
  }

  const res = await db.collection('games').add({ data: doc })
  await db.collection('transactions').add({
    data: {
      gameId: res._id,
      type: 'buyIn',
      playerOpenid: OPENID,
      amount: buyIn,
      operatorOpenid: OPENID,
      timestamp: now
    }
  })

  return { ok: true, gameId: res._id, inviteCode }
}
