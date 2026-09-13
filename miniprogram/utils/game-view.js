const { cacheGame } = require('./game-data.js')
const { mergeTransactions } = require('./transaction-format.js')
const KEY = 'stax_complete_games_v1'
const MAX_AGE = 2 * 86400000
let snapshots
const inFlight = new Map()
let saveTimer
let generation = 0

function revision(game) {
  return Number(game?.stateRevision ?? game?.txRevision) || 0
}
function txSignature(game) {
  return JSON.stringify([
    game?.txRevision || 0,
    game?.txSeq || 0,
    game?.status,
    (game?.players || []).map(p => [p.openid, p.totalBuyIn, p.finalStack, p.eliminatedAt]),
    game?.extraCost,
    game?.expenseMode
  ])
}
function loadCache() {
  if (!snapshots) {
    try {
      snapshots = wx.getStorageSync(KEY) || {}
    } catch (_) {
      snapshots = {}
    }
  }
  return snapshots
}
function getCompleteGame(id) {
  const item = loadCache()[id]
  return item && Date.now() - item.ts <= MAX_AGE ? item : null
}
function rememberCompleteGame(game, transactions) {
  const previous = getCompleteGame(game._id)
  if (previous && revision(previous.game) > revision(game)) return previous
  const item = { game, transactions, signature: txSignature(game), ts: Date.now() }
  loadCache()[game._id] = item
  cacheGame(game)
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const entries = Object.entries(loadCache())
      .filter(([, x]) => Date.now() - x.ts <= MAX_AGE)
      .sort(([, a], [, b]) => b.ts - a.ts)
      .slice(0, 12)
    snapshots = Object.fromEntries(entries)
    try {
      wx.setStorageSync(KEY, snapshots)
    } catch (_) {}
  }, 150)
  return item
}
async function readTransactions(id) {
  const db = wx.cloud.database()
  const query = () => db.collection('transactions').where({ gameId: id })
  const page = offset =>
    query().orderBy('timestamp', 'desc').orderBy('_id', 'desc').skip(offset).limit(20).get()
  const [first, count] = await Promise.all([
    page(0),
    query()
      .count()
      .catch(() => null)
  ])
  let out = first.data || []
  if (typeof count?.total === 'number') {
    for (let offset = 20; offset < count.total; offset += 100) {
      const requests = []
      for (let next = offset; next < Math.min(count.total, offset + 100); next += 20)
        requests.push(page(next))
      for (const result of await Promise.all(requests)) out = out.concat(result.data || [])
    }
    if (mergeTransactions([], out).length !== count.total)
      throw new Error('INCOMPLETE_TRANSACTIONS')
  } else {
    for (let offset = 20; out.length === offset; offset += 20) {
      const result = await page(offset)
      out = out.concat(result.data || [])
      if ((result.data || []).length < 20) break
    }
  }
  return mergeTransactions([], out)
}
function fetchCompleteGame(id, knownGame) {
  if (inFlight.has(id)) return inFlight.get(id)
  const epoch = generation
  const task = (async () => {
    const db = wx.cloud.database()
    const read = async () => {
      const game = (await db.collection('games').doc(id).get()).data
      if (!game || game.deletedAt || game.status === 'deleted') throw new Error('GAME_NOT_FOUND')
      return game
    }
    const save = (game, transactions) => {
      if (epoch !== generation) throw new Error('CACHE_CLEARED')
      return rememberCompleteGame(game, transactions)
    }
    const cached = getCompleteGame(id)
    let game = knownGame
    if (cached) {
      game = game || (await read())
      if (txSignature(game) === cached.signature) return save(game, cached.transactions)
    }
    // Establish the revision before ledger reads, then verify it after every page succeeds.
    game = game || (await read())
    let transactions = await readTransactions(id)
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await read()
      if (txSignature(latest) === txSignature(game)) return save(latest, transactions)
      game = latest
      transactions = await readTransactions(id)
    }
    throw new Error('GAME_CHANGED_DURING_READ')
  })().finally(() => {
    if (inFlight.get(id) === task) inFlight.delete(id)
  })
  inFlight.set(id, task)
  return task
}
let warmTimer
function warmRecentGames(games) {
  clearTimeout(warmTimer)
  warmTimer = setTimeout(async () => {
    const queue = (games || []).slice(0, 5).filter(g => {
      const cached = getCompleteGame(g._id)
      return !cached || cached.signature !== txSignature(g) || Date.now() - cached.ts > 30000
    })
    async function worker() {
      while (queue.length) {
        const game = queue.shift()
        try {
          await fetchCompleteGame(game._id, game)
        } catch (_) {}
      }
    }
    await Promise.all([worker(), worker()])
  }, 400)
}
function clearCompleteGames() {
  generation++
  inFlight.clear()
  snapshots = {}
  clearTimeout(saveTimer)
  clearTimeout(warmTimer)
  try {
    wx.removeStorageSync(KEY)
  } catch (_) {}
}
function removeCompleteGame(id) {
  delete loadCache()[id]
  try {
    wx.setStorageSync(KEY, snapshots)
  } catch (_) {}
}
module.exports = {
  txSignature,
  getCompleteGame,
  rememberCompleteGame,
  fetchCompleteGame,
  warmRecentGames,
  clearCompleteGames,
  removeCompleteGame
}
