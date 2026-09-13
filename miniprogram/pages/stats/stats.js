const app = getApp()
const { formatProfit } = require('../../utils/format.js')
const { fetchAllGames, getCachedGames, getCacheVersion } = require('../../utils/game-data.js')
const { computeAnalytics } = require('../../utils/analytics.js')
const { changedPatch } = require('../../utils/render.js')

Page(require('../../utils/live-view.js').liveGamesPage({
  data: { dim: 'players', dimData: [], loading: true },
  onLoad() {
    const openid = app.globalData.openid || wx.getStorageSync('last_openid')
    const cached = getCachedGames(openid)
    if (cached.length) this._applyGames(cached, openid)
  },
  async onShow() {
    const ver = getCacheVersion()
    if (this._lastFetch && Date.now() - this._lastFetch < 30000 && this._cacheVer === ver) return
    this._cacheVer = ver
    await this._fetchAll()
  },
  async _fetchAll() {
    try {
      await app.globalData.openidReady
      const openid = app.globalData.openid
      if (!openid) return
      this._applyGames(await fetchAllGames(openid), openid)
      this._lastFetch = Date.now()
    } catch (err) { console.error(err) }
    finally { if (this.data.loading) this.setData({ loading: false }) }
  },
  _applyGames(games, openid) {
    this._dimensions = computeAnalytics(games, openid).dimensions
    this._applyDimension(this.data.dim)
  },
  _applyDimension(dim) {
    const rows = (this._dimensions || {})[dim] || []
    const patch = changedPatch(this.data, {
      dim, loading: false,
      dimData: rows.map(g => ({
        ...g, avg: g.games ? Math.round((g.profit || 0) / g.games) : 0,
        winRate: g.games ? Math.round(((g.wins || 0) * 1000) / g.games) / 10 : 0,
        profitFormatted: formatProfit(g.profit || 0)
      }))
    })
    if (Object.keys(patch).length) this.setData(patch)
  },
  onDimChange(e) { this._applyDimension(e.currentTarget.dataset.k) }
}, function () { return this._fetchAll() }))
