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

// 每日定时触发（见 config.json）：赛季时间一到即自动结账并开新一季，无需等下一场牌局。
// 与 calcSeasonScore 的惰性结账互为兜底：谁先到谁结，事务状态机保证不重复结账/重复荣誉。
exports.main = async () => {
  const now = new Date()
  let settled = 0
  const failed = []
  const processed = new Set()
  // 每批处理后已结账文档会离开查询结果；processed 防止个别赛季结不掉时死循环。
  while (true) {
    const expired = await db
      .collection('seasons')
      .where({ status: 'ongoing', endAt: _.lte(now) })
      .limit(100)
      .get()
    const batch = (expired.data || []).filter(s => !processed.has(s._id))
    if (!batch.length) break
    for (const season of batch) {
      processed.add(season._id)
      try {
        // 首选完整滚季路径（calcSeasonScore）：最终校准 → 结账+冠军荣誉 → 自动开新一季
        await cloud
          .callFunction({ name: 'calcSeasonScore', data: { circleId: season.circleId } })
          .catch(err => console.warn('[settleSeason calc]', season.circleId, err))
        const latest = await db
          .collection('seasons')
          .doc(season._id)
          .get()
          .catch(() => null)
        if (latest && latest.data && latest.data.status === 'ongoing') {
          // 圈子已停用等走不通重算路径的赛季：按库存 rankings 直接结账（不开新一季）
          await settleOne({ ...latest.data, _id: season._id }, now)
        }
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
