// pages/index/index.js — 首页
const app = getApp()
const { formatProfit, formatDate } = require('../../utils/format.js')
const SUNZI = require('../../utils/sunzi.js')
const { getDailyWord } = require('../../utils/dailyWord.js')

Page({
  data: {
    recentGames: [],
    loading: true,
    myStats: null,
    myOpenid: '',
    quote: { text: '', from: '' },
    dailyWord: { word: '', note: '', date: '', verse: '' },
    showWordPopup: false
  },

  onLoad() {
    this.setData({ quote: SUNZI[Math.floor(Math.random() * SUNZI.length)] })
  },

  async onShow() {
    try {
      await this._ensureOpenid()
      this._loadDailyWord()
      await this._fetchRecent()
      await this._fetchStats()
      this._checkProfileGuide()
    } catch (err) {
      console.error('[onShow]', err)
      this.setData({ loading: false })
    }
  },

  _loadDailyWord() {
    const openid = app.globalData.openid || ''
    this.setData({ dailyWord: getDailyWord(openid) })
  },

  _checkProfileGuide() {
    const cached = wx.getStorageSync('user_profile') || {}
    const hasProfile = !!(cached.nickname || cached.nickName)
    const guided = wx.getStorageSync('profile_guided')
    if (!hasProfile && !guided) {
      wx.setStorageSync('profile_guided', true)
      wx.navigateTo({ url: '/pages/profile/profile?firstTime=1' })
    }
  },

  async _ensureOpenid() {
    if (app.globalData.openid) {
      this.setData({ myOpenid: app.globalData.openid })
      return
    }
    try {
      const res = await wx.cloud.callFunction({ name: 'whoami', data: {} })
      if (res?.result?.openid) {
        app.globalData.openid = res.result.openid
        app.globalData.userDoc = res.result.user
        this.setData({ myOpenid: res.result.openid })
      }
    } catch (err) {
      console.error('[whoami]', err)
    }
  },

  async _fetchRecent() {
    const openid = app.globalData.openid
    if (!openid) {
      this.setData({ loading: false })
      return
    }
    try {
      const db = wx.cloud.database()
      const _ = db.command
      const [ongoingRes, endedRes] = await Promise.all([
        db
          .collection('games')
          .where({ status: 'ongoing', players: _.elemMatch({ openid }) })
          .orderBy('startedAt', 'desc')
          .limit(5)
          .get(),
        db
          .collection('games')
          .where({ status: 'ended', players: _.elemMatch({ openid }) })
          .orderBy('endedAt', 'desc')
          .limit(5)
          .get()
      ])
      const ongoing = ongoingRes.data.map(g => ({ ...g, _status: 'ongoing' }))
      const ended = endedRes.data
        .filter(g => !(Array.isArray(g.hiddenForOpenids) && g.hiddenForOpenids.includes(openid)))
        .map(g => {
          const me = (g.players || []).find(p => p.openid === openid) || {}
          const ratio = Number(g.scoreRatio) > 0 ? Number(g.scoreRatio) : 1
          const profit = Math.round((me.finalProfit ?? me.profit ?? 0) / ratio)
          return {
            ...g,
            _status: 'ended',
            _profit: profit,
            _profitStr: formatProfit(profit),
            _dateStr: formatDate(g.endedAt || g.startedAt)
          }
        })
      this.setData({ recentGames: [...ongoing, ...ended].slice(0, 8), loading: false })
    } catch (err) {
      console.error(err)
      this.setData({ loading: false })
    }
  },

  async _fetchStats() {
    const u = app.globalData.userDoc
    if (u?.stats?.totalGames > 0) this.setData({ myStats: u.stats })
  },

  onCreate() {
    wx.navigateTo({ url: '/pages/game-create/game-create' })
  },
  onJoin() {
    wx.navigateTo({ url: '/pages/game-join/game-join' })
  },
  onHistory() {
    wx.navigateTo({ url: '/pages/history/history' })
  },
  noop() {},
  onTapDailyWord() {
    this.setData({ showWordPopup: true })
  },
  onHideWordPopup() {
    this.setData({ showWordPopup: false })
  },

  onOpenGame(e) {
    wx.navigateTo({ url: '/pages/game-detail/game-detail?id=' + e.currentTarget.dataset.id })
  },

  onShareAppMessage() {
    const dw = this.data.dailyWord
    if (dw.word) {
      return {
        title: `「${dw.word}」—— StaxKit 每日一字`,
        path: '/pages/index/index'
      }
    }
    const s = this.data.myStats
    let title = 'StaxKit — 朋友局记账神器'
    if (s && s.totalGames >= 3) {
      const pf = formatProfit(s.totalProfit || 0)
      title = `我用 StaxKit 记了 ${s.totalGames} 局，累计 ${pf}，来一起打牌？`
    }
    return { title, path: '/pages/index/index' }
  }
})
