// cloudfunctions/deleteGameRecord/index.js
// 只允许从“我自己的战绩列表”中移除一条已结束牌局。
// 实现策略：
//   1. 在 games.players[].deletedByOpenidList 上加入当前 openid，
//      让 history 查询 + 用户个人统计在前端按 openid 过滤即可隐藏。
//   2. 同步扣减 user.stats 的相关字段，确保「我的统计」马上一致。
// 不会真正删除整局数据，避免影响其他玩家。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function fetchVisibleGames(openid) {
  const PAGE_SIZE = 100
  const query = () =>
    db
      .collection('games')
      .where({ status: 'ended', players: _.elemMatch({ openid }) })
      .orderBy('endedAt', 'desc')
  const countRes = await query()
    .count()
    .catch(() => null)
  const all = []
  if (countRes && typeof countRes.total === 'number') {
    for (let skip = 0; skip < countRes.total; skip += PAGE_SIZE) {
      const page = await query().skip(skip).limit(PAGE_SIZE).get()
      all.push(...(page.data || []))
    }
  } else {
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const page = await query().skip(skip).limit(PAGE_SIZE).get()
      all.push(...(page.data || []))
      if ((page.data || []).length < PAGE_SIZE) break
    }
  }
  return all.filter(
    item => !(Array.isArray(item.hiddenForOpenids) && item.hiddenForOpenids.includes(openid))
  )
}

async function rebuildUserStats(openid) {
  const games = await fetchVisibleGames(openid)
  let totalProfit = 0
  let biggestWin = 0
  let biggestLoss = 0
  let wins = 0
  let totalGames = 0
  games.forEach(item => {
    const player = (item.players || []).find(p => p.openid === openid)
    if (!player) return
    const ratio = Number(item.scoreRatio) > 0 ? Number(item.scoreRatio) : 1
    const score = Math.round(Number(player.finalProfit ?? player.profit ?? 0) / ratio)
    totalGames++
    totalProfit += score
    biggestWin = Math.max(biggestWin, score)
    biggestLoss = Math.min(biggestLoss, score)
    if (score > 0) wins++
  })
  const stats = { totalGames, totalProfit, biggestWin, biggestLoss, wins }
  const users = await db.collection('users').where({ _openid: openid }).limit(100).get()
  await Promise.all(
    (users.data || []).map(user =>
      db.collection('users').doc(user._id).update({ data: { stats } })
    )
  )
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { gameId } = event || {}
  if (!gameId) return { ok: false, error: 'INVALID_PARAMS' }

  const got = await db
    .collection('games')
    .doc(gameId)
    .get()
    .catch(() => null)
  if (!got || !got.data) return { ok: false, error: 'GAME_NOT_FOUND' }
  const game = got.data
  const me = (game.players || []).find(p => p.openid === OPENID)
  if (!me) return { ok: false, error: 'NOT_PLAYER' }

  const hidden = Array.isArray(game.hiddenForOpenids) ? game.hiddenForOpenids : []
  if (hidden.includes(OPENID)) {
    let statsRebuilt = true
    if (game.status === 'ended') {
      try {
        await rebuildUserStats(OPENID)
      } catch (err) {
        statsRebuilt = false
        console.error('[deleteGameRecord rebuild]', err)
      }
    }
    return { ok: true, alreadyHidden: true, statsRebuilt }
  }

  await db
    .collection('games')
    .doc(gameId)
    .update({
      data: { hiddenForOpenids: _.addToSet(OPENID) }
    })

  // 从仍可见的权威牌局重建统计；增量减法无法正确修复“最大赢/最大亏”。
  let statsRebuilt = true
  if (game.status === 'ended') {
    try {
      await rebuildUserStats(OPENID)
    } catch (err) {
      statsRebuilt = false
      console.error('[deleteGameRecord rebuild]', err)
    }
  }

  return { ok: true, statsRebuilt }
}
