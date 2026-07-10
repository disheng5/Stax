const app = getApp()
const { formatProfit, formatDate } = require('../../utils/format.js')
const SUNZI = require('../../utils/sunzi.js')
const { getDailyWord } = require('../../utils/dailyWord.js')
const {
  fetchAllGames,
  getCachedGames,
  getCacheVersion,
  cacheGame
} = require('../../utils/game-data.js')
const { computeGameStats, gameScore } = require('../../utils/stats.js')
const { isMeaningfulNickname, readLocalProfile } = require('../../utils/user.js')

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
    // 上屏快照：同步渲染上次的最近记录，冷启动首帧即有内容（随后 onShow 拉取校正）
    try {
      const lastOpenid = wx.getStorageSync('last_openid')
      const snap = lastOpenid && wx.getStorageSync(`snap_recent_${lastOpenid}`)
      if (snap && Array.isArray(snap.recentGames) && snap.recentGames.length) {
        this.setData({ recentGames: snap.recentGames, myStats: snap.myStats || null, loading: false })
      }
    } catch (_) {}
  },

  async onShow() {
    // 30s 内不重复拉取；但缓存版本变了（刚结算/删除）立即刷新
    const ver = getCacheVersion()
    if (this._lastFetch && Date.now() - this._lastFetch < 30000 && this._cacheVer === ver) return
    try {
      await app.globalData.openidReady
      const openid = app.globalData.openid
      if (openid) this.setData({ myOpenid: openid })
      this._loadDailyWord()
      await this._fetchRecent(openid)
      this._checkProfileGuide()
    } catch (err) {
      console.error('[onShow]', err)
    } finally {
      this.setData({ loading: false })
      this._lastFetch = Date.now()
      this._cacheVer = getCacheVersion()
    }
  },

  _loadDailyWord() {
    const openid = app.globalData.openid || ''
    this.setData({ dailyWord: getDailyWord(openid) })
  },

  _checkProfileGuide() {
    const hasProfile = isMeaningfulNickname(readLocalProfile(app.globalData.openid).nickname)
    const guided = wx.getStorageSync('profile_guided')
    if (!hasProfile && !guided) {
      wx.setStorageSync('profile_guided', true)
      wx.navigateTo({ url: '/pages/profile/profile?firstTime=1' })
    }
  },

  async _fetchRecent(openid) {
    if (!openid) return
    try {
      const db = wx.cloud.database()
      const _ = db.command
      const cachedEnded = getCachedGames(openid)
      if (cachedEnded.length) this._applyRecent([], cachedEnded)
      // 已结束的局走共享缓存（与历史/我的 同源），战绩随结算实时更新
      const [ongoingRes, endedAll] = await Promise.all([
        db
          .collection('games')
          .where({ status: 'ongoing', players: _.elemMatch({ openid }) })
          .orderBy('startedAt', 'desc')
          .limit(5)
          .get(),
        fetchAllGames(openid)
      ])
      this._applyRecent(ongoingRes.data, endedAll, openid)
      // 回写快照供下次冷启动秒开
      try {
        wx.setStorageSync(`snap_recent_${openid}`, {
          recentGames: this.data.recentGames,
          myStats: this.data.myStats
        })
        wx.removeStorageSync('snap_recent')
      } catch (_) {}
    } catch (err) {
      console.error(err)
    }
  },

  _applyRecent(ongoingList, endedAll, openid = app.globalData.openid) {
    const ongoing = (ongoingList || []).map(g => ({ ...g, _status: 'ongoing' }))
    const ended = (endedAll || []).slice(0, 5).map(g => {
      const profit = gameScore(g, openid) || 0
      return {
        ...g,
        _status: 'ended',
        _profit: profit,
        _profitStr: formatProfit(profit),
        _dateStr: formatDate(g.endedAt || g.startedAt)
      }
    })
    const stats = computeGameStats(endedAll || [], openid)
    this.setData({
      recentGames: [...ongoing, ...ended].slice(0, 5),
      myStats: stats.totalGames > 0 ? stats : null,
      loading: false
    })
  },

  onCreate() {
    wx.navigateTo({ url: '/pages/game-create/game-create' })
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
    const id = e.currentTarget.dataset.id
    const game = this.data.recentGames.find(item => item._id === id)
    if (game) cacheGame(game)
    wx.navigateTo({ url: '/pages/game-detail/game-detail?id=' + id })
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
