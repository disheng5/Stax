let _cache = null
let _cacheTime = 0
let _cacheOpenid = ''
const CACHE_TTL = 30000

function _invalidate() {
  _cache = null
  _cacheTime = 0
}

async function fetchAllGames(openid, opts = {}) {
  const force = opts.force || false
  if (!force && _cache && _cacheOpenid === openid && Date.now() - _cacheTime < CACHE_TTL) {
    return _cache
  }

  const db = wx.cloud.database()
  const _ = db.command
  const first = await db
    .collection('games')
    .where({ status: 'ended', players: _.elemMatch({ openid }) })
    .orderBy('endedAt', 'desc')
    .skip(0)
    .limit(20)
    .get()

  let all = first.data
  if (first.data.length === 20) {
    const fetches = []
    for (let skip = 20; skip < 200; skip += 20) {
      fetches.push(
        db
          .collection('games')
          .where({ status: 'ended', players: _.elemMatch({ openid }) })
          .orderBy('endedAt', 'desc')
          .skip(skip)
          .limit(20)
          .get()
      )
    }
    const results = await Promise.all(fetches)
    for (const r of results) {
      all = all.concat(r.data)
      if (r.data.length < 20) break
    }
  }

  const filtered = all.filter(
    g => !(Array.isArray(g.hiddenForOpenids) && g.hiddenForOpenids.includes(openid))
  )

  _cache = filtered
  _cacheTime = Date.now()
  _cacheOpenid = openid
  return filtered
}

module.exports = { fetchAllGames, invalidateGamesCache: _invalidate }
