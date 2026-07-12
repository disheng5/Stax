const app = getApp()

Page({
  data: { circles: [], loading: true },

  onLoad() {
    try {
      const openid = app.globalData.openid || wx.getStorageSync('last_openid')
      const snapshot = openid && wx.getStorageSync(`snap_circles_${openid}`)
      if (snapshot && Array.isArray(snapshot.circles)) {
        this.setData({ circles: snapshot.circles, loading: false })
      }
    } catch (_) {}
  },

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
      const query = () =>
        db
          .collection('circles')
          .where({ status: 'active', memberOpenids: _.elemMatch(_.eq(openid)) })
          .orderBy('createdAt', 'desc')
      const [first, countRes] = await Promise.all([
        query().limit(20).get(),
        query()
          .count()
          .catch(() => null)
      ])
      let circleDocs = first.data || []
      if (countRes && typeof countRes.total === 'number') {
        const total = countRes.total || circleDocs.length
        for (let skip = 20; skip < total; skip += 100) {
          const batch = []
          for (let s = skip; s < Math.min(skip + 100, total); s += 20) {
            batch.push(query().skip(s).limit(20).get())
          }
          const pages = await Promise.all(batch)
          pages.forEach(page => {
            circleDocs = circleDocs.concat(page.data || [])
          })
        }
      } else {
        for (let skip = 20; circleDocs.length === skip; skip += 20) {
          const page = await query().skip(skip).limit(20).get()
          circleDocs = circleDocs.concat(page.data || [])
          if ((page.data || []).length < 20) break
        }
      }

      const seasonFetches = circleDocs.map(c => {
        if (!c.currentSeasonId) return Promise.resolve(null)
        return db
          .collection('seasons')
          .doc(c.currentSeasonId)
          .get()
          .catch(() => null)
      })
      const seasonResults = await Promise.all(seasonFetches)

      const circles = circleDocs.map((c, i) => {
        let seasonInfo = '赛季未启动'
        let myRank = ''
        const s = seasonResults[i]?.data
        if (s) {
          seasonInfo = s.seasonName || '进行中'
          const me = (s.rankings || []).find(r => r.openid === openid)
          if (me && me.rank > 0) myRank = `第 ${me.rank} 名`
          else if (me && me.games === 0) myRank = '打一场即可上榜'
          else if (me) myRank = `打了 ${me.games} 场`
          else myRank = '暂无数据'
        }
        return { ...c, seasonInfo, myRank }
      })
      this.setData({ circles })
      try {
        wx.setStorageSync(`snap_circles_${openid}`, { ts: Date.now(), circles })
      } catch (_) {}
      this._lastFetch = Date.now()
    } catch (err) {
      console.error(err)
    }
  },

  onCreate() {
    wx.navigateTo({ url: '/pages/circle-create/circle-create' })
  },
  onOpenCircle(e) {
    wx.navigateTo({ url: '/pages/circle-detail/circle-detail?id=' + e.currentTarget.dataset.id })
  }
})
