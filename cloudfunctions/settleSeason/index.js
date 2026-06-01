const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async event => {
  const now = new Date()
  const expired = await db
    .collection('seasons')
    .where({ status: 'ongoing', endAt: _.lte(now) })
    .limit(50)
    .get()

  let settled = 0
  for (const season of expired.data || []) {
    const rankings = season.rankings || []
    const champion = rankings.find(r => r.rank === 1)
    const championOpenid = champion ? champion.openid : null

    await db
      .collection('seasons')
      .doc(season._id)
      .update({
        data: {
          status: 'settled',
          championOpenid,
          settledAt: now
        }
      })

    if (champion) {
      const userQ = await db.collection('users').where({ _openid: championOpenid }).limit(1).get()
      if (userQ.data.length) {
        const circleQ = await db
          .collection('circles')
          .doc(season.circleId)
          .get()
          .catch(() => null)
        const circleName = circleQ?.data?.name || ''
        await db
          .collection('users')
          .doc(userQ.data[0]._id)
          .update({
            data: {
              'honors.championships': _.push([
                {
                  circleName,
                  seasonName: season.seasonName,
                  profitBB: champion.profitBB,
                  achievedAt: now
                }
              ]),
              'honors.totalChampionCount': _.inc(1)
            }
          })
      }
    }

    await db
      .collection('circles')
      .doc(season.circleId)
      .update({
        data: { currentSeasonId: null }
      })

    settled++
  }

  return { ok: true, settled }
}
