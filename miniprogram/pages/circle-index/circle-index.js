const app = getApp()

Page({
  data: { circles: [], loading: true },

  async onShow() {
    if (this._lastFetch && Date.now() - this._lastFetch < 30000) return
    try {
      await app.globalData.openidReady
      await this._fetch()
    } catch (err) {
      console.error('[circle-index onShow]', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  async _fetch() {
    const openid = app.globalData.openid
    if (!openid) return
    try {
      const db = wx.cloud.database()
      const _ = db.command
      const res = await db
        .collection('circles')
        .where({ status: 'active', memberOpenids: _.elemMatch(_.eq(openid)) })
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get()

      const seasonFetches = res.data.map(c => {
        if (!c.currentSeasonId) return Promise.resolve(null)
        return db
          .collection('seasons')
          .doc(c.currentSeasonId)
          .get()
          .catch(() => null)
      })
      const seasonResults = await Promise.all(seasonFetches)

      const circles = res.data.map((c, i) => {
        let seasonInfo = '赛季未启动'
        let myRank = ''
        const s = seasonResults[i]?.data
        if (s) {
          seasonInfo = s.seasonName || '进行中'
          const me = (s.rankings || []).find(r => r.openid === openid)
          if (me && me.rank > 0) myRank = `第 ${me.rank} 名`
          else if (me && me.games < 1) myRank = '打一场即可上榜'
          else if (me) myRank = '积分计算中'
          else myRank = '暂无数据'
        }
        return { ...c, seasonInfo, myRank }
      })
      this.setData({ circles })
      this._lastFetch = Date.now()
    } catch (err) {
      console.error(err)
    }
  },

  onCreate() {
    wx.navigateTo({ url: '/pages/circle-create/circle-create' })
  },
  onJoin() {
    wx.navigateTo({ url: '/pages/circle-join/circle-join' })
  },
  onOpenCircle(e) {
    wx.navigateTo({ url: '/pages/circle-detail/circle-detail?id=' + e.currentTarget.dataset.id })
  }
})
