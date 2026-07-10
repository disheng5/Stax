// cloudfunctions/whoami/index.js — 返回当前调用者 openid 与 user 文档
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function syncProfileToGames(openid, nickname, avatar) {
  try {
    const _ = db.command
    const PAGE_SIZE = 100
    const query = () =>
      db.collection('games').where({ status: 'ongoing', players: _.elemMatch({ openid }) })
    const games = []
    const countRes = await query()
      .count()
      .catch(() => null)
    if (countRes && typeof countRes.total === 'number') {
      const total = countRes.total || 0
      for (let skip = 0; skip < total; skip += PAGE_SIZE) {
        const page = await query().skip(skip).limit(PAGE_SIZE).get()
        games.push(...(page.data || []))
      }
    } else {
      for (let skip = 0; ; skip += PAGE_SIZE) {
        const page = await query().skip(skip).limit(PAGE_SIZE).get()
        games.push(...(page.data || []))
        if ((page.data || []).length < PAGE_SIZE) break
      }
    }
    // 只处理资料确实变化的牌局；事务内重读再写，避免覆盖并发的买入/结算
    const stale = games.filter(game =>
      (game.players || []).some(
        p =>
          p.openid === openid &&
          ((nickname && p.nickname !== nickname) || (avatar && p.avatar !== avatar))
      )
    )
    await Promise.all(
      stale.map(game =>
        db
          .runTransaction(async transaction => {
            const snap = await transaction
              .collection('games')
              .doc(game._id)
              .get()
              .catch(() => null)
            if (!snap || !snap.data || snap.data.status !== 'ongoing') return
            const players = (snap.data.players || []).map(p => {
              if (p.openid !== openid) return p
              return {
                ...p,
                nickname: nickname || p.nickname,
                avatar: avatar || p.avatar
              }
            })
            await transaction.collection('games').doc(game._id).update({ data: { players } })
          }, 3)
          .catch(err => console.error('[syncProfileToGames txn]', game._id, err))
      )
    )
  } catch (err) {
    console.error('[syncProfileToGames]', err)
  }
}

exports.main = async event => {
  try {
    const { OPENID } = cloud.getWXContext()
    const { upsertNickname, upsertAvatar } = event || {}

    if (!OPENID) {
      return { ok: false, error: 'OPENID_UNAVAILABLE_IN_TEST_CONSOLE' }
    }

    const q = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    let user
    if (!q.data.length) {
      const now = new Date()
      const created = await db.collection('users').add({
        data: {
          nickname: upsertNickname || '玩家',
          avatar: upsertAvatar || '',
          createdAt: now,
          stats: { totalGames: 0, totalProfit: 0, biggestWin: 0, biggestLoss: 0, wins: 0 }
        }
      })
      user = {
        _id: created._id,
        _openid: OPENID,
        nickname: upsertNickname || '玩家',
        avatar: upsertAvatar || ''
      }
      if (upsertNickname || upsertAvatar) {
        await syncProfileToGames(OPENID, user.nickname, user.avatar)
      }
    } else {
      user = q.data[0]
      const needUpdate =
        (upsertNickname && upsertNickname !== user.nickname) ||
        (upsertAvatar && upsertAvatar !== user.avatar)
      if (needUpdate) {
        const newNickname = upsertNickname || user.nickname
        const newAvatar = upsertAvatar || user.avatar
        await db
          .collection('users')
          .doc(user._id)
          .update({
            data: { nickname: newNickname, avatar: newAvatar }
          })
        user.nickname = newNickname
        user.avatar = newAvatar
        await syncProfileToGames(OPENID, newNickname, newAvatar)
      }
    }

    return { ok: true, openid: OPENID, user }
  } catch (err) {
    return { ok: false, error: err.message || String(err), code: err.code || err.errCode || '' }
  }
}
