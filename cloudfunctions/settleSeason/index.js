const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function recordChampionHonor(season, champion, now) {
  if (!champion) return
  try {
    const [userQ, circleQ] = await Promise.all([
      db.collection('users').where({ _openid: champion.openid }).limit(100).get(),
      db
        .collection('circles')
        .doc(season.circleId)
        .get()
        .catch(() => null)
    ])
    if (!(userQ.data || []).length) return
    const user = userQ.data
      .slice()
      .sort(
        (a, b) =>
          Number(!!b.nickname) - Number(!!a.nickname) ||
          Number(!!b.avatar) - Number(!!a.avatar)
      )[0]
    await db
      .collection('users')
      .doc(user._id)
      .update({
        data: {
          'honors.championships': _.push([
            {
              circleName: circleQ?.data?.name || '',
              seasonName: season.seasonName,
              profitBB: champion.profitBB,
              achievedAt: now
            }
          ]),
          'honors.totalChampionCount': _.inc(1)
        }
      })
  } catch (err) {
    // 荣誉是附加信息，失败不能阻塞赛季状态机；日志留给运维补偿。
    console.error('[settleSeason honor]', season._id, err)
  }
}

async function settleOne(season, now) {
  const champion = (season.rankings || []).find(rank => rank.rank === 1) || null
  await db.runTransaction(async transaction => {
    const circle = await transaction
      .collection('circles')
      .doc(season.circleId)
      .get()
      .catch(() => null)
    await transaction
      .collection('seasons')
      .doc(season._id)
      .update({
        data: {
          status: 'settled',
          championOpenid: champion ? champion.openid : null,
          settledAt: now
        }
      })
    if (circle?.data?.currentSeasonId === season._id) {
      await transaction
        .collection('circles')
        .doc(season.circleId)
        .update({ data: { currentSeasonId: null } })
    }
  }, 3)
  await recordChampionHonor(season, champion, now)
}

exports.main = async () => {
  const now = new Date()
  let settled = 0
  const failed = []
  // 每批处理后文档会离开查询结果，因此始终读取第一页，直到全部结清。
  while (true) {
    const expired = await db
      .collection('seasons')
      .where({ status: 'ongoing', endAt: _.lte(now) })
      .limit(100)
      .get()
    if (!(expired.data || []).length) break
    for (const season of expired.data || []) {
      try {
        await settleOne(season, now)
        settled++
      } catch (err) {
        console.error('[settleSeason]', season._id, err)
        failed.push(season._id)
      }
    }
    if (failed.length) break
  }
  return { ok: failed.length === 0, settled, failed }
}
