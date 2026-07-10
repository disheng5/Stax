let _cache = null
let _cacheTime = 0
let _cacheOpenid = ''
let _version = 0
const CACHE_TTL = 30000
const STALE_CACHE_TTL = 10 * 60 * 1000

function _storageKey(openid) {
  return `stax_games_${openid}`
}

function _wxStorage() {
  return typeof wx !== 'undefined' && wx.getStorageSync ? wx : null
}

function _persist(openid, games) {
  const store = _wxStorage()
  if (!store || !openid) return
  try {
    store.setStorageSync(_storageKey(openid), { ts: Date.now(), games })
  } catch (err) {
    console.warn('[game-data persist]', err)
  }
}

function _hydrate(openid, maxAge = CACHE_TTL) {
  if (!openid) return null
  if (_cache && _cacheOpenid === openid && Date.now() - _cacheTime < maxAge) return _cache
  const store = _wxStorage()
  if (!store) return null
  try {
    const saved = store.getStorageSync(_storageKey(openid))
    if (!saved || !Array.isArray(saved.games)) return null
    if (Date.now() - (saved.ts || 0) > maxAge) return null
    _cache = saved.games
    _cacheTime = saved.ts || Date.now()
    _cacheOpenid = openid
    return _cache
  } catch (err) {
    console.warn('[game-data hydrate]', err)
    return null
  }
}

// 结算/删除等写操作后调用；版本号递增让各页面的 onShow 守卫立刻失效
function _invalidate() {
  const oldOpenid = _cacheOpenid
  _cache = null
  _cacheTime = 0
  _cacheOpenid = ''
  _version++
  const store = _wxStorage()
  if (store && oldOpenid) {
    try {
      store.removeStorageSync(_storageKey(oldOpenid))
    } catch (err) {
      console.warn('[game-data invalidate]', err)
    }
  }
}

function getCacheVersion() {
  return _version
}

function getCachedGames(openid, maxAge = STALE_CACHE_TTL) {
  return _hydrate(openid, maxAge) || []
}

async function fetchAllGames(openid, opts = {}) {
  const force = opts.force || false
  const cached = !force ? _hydrate(openid, CACHE_TTL) : null
  if (cached) return cached

  const db = wx.cloud.database()
  const _ = db.command
  const PAGE_SIZE = 20
  const query = () =>
    db
      .collection('games')
      .where({ status: 'ended', players: _.elemMatch({ openid }) })
      .orderBy('endedAt', 'desc')
  const first = await query().limit(PAGE_SIZE).get()

  let all = first.data || []
  if ((first.data || []).length === PAGE_SIZE) {
    const countRes = await db
      .collection('games')
      .where({ status: 'ended', players: _.elemMatch({ openid }) })
      .count()
      .catch(() => null)
    if (countRes && typeof countRes.total === 'number') {
      const total = countRes.total || PAGE_SIZE
      for (let skip = PAGE_SIZE; skip < total; skip += PAGE_SIZE * 5) {
        const fetches = []
        for (let s = skip; s < Math.min(skip + PAGE_SIZE * 5, total); s += PAGE_SIZE) {
          fetches.push(query().skip(s).limit(PAGE_SIZE).get())
        }
        const results = await Promise.all(fetches)
        results.forEach(r => {
          all = all.concat(r.data || [])
        })
      }
    } else {
      for (let skip = PAGE_SIZE; ; skip += PAGE_SIZE) {
        const page = await query().skip(skip).limit(PAGE_SIZE).get()
        const data = page.data || []
        all = all.concat(data)
        if (data.length < PAGE_SIZE) break
      }
    }
  }

  const filtered = all.filter(
    g => !(Array.isArray(g.hiddenForOpenids) && g.hiddenForOpenids.includes(openid))
  )

  _cache = filtered
  _cacheTime = Date.now()
  _cacheOpenid = openid
  _persist(openid, filtered)
  return filtered
}

module.exports = {
  fetchAllGames,
  getCachedGames,
  invalidateGamesCache: _invalidate,
  getCacheVersion
}
