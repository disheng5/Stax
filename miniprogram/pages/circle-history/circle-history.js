Page({
  data: { circleId: '', seasons: [], loading: true },

  onLoad(options) {
    this.setData({ circleId: options.id || '' })
  },

  async onShow() {
    if (!this.data.circleId) return
    try {
      const db = wx.cloud.database()
      const query = () =>
        db
          .collection('seasons')
          .where({ circleId: this.data.circleId, status: 'settled' })
          .orderBy('settledAt', 'desc')
      const first = await query().limit(20).get()
      let all = first.data || []
      for (let skip = 20; all.length === skip; skip += 20) {
        const page = await query().skip(skip).limit(20).get()
        all = all.concat(page.data || [])
        if ((page.data || []).length < 20) break
      }
      const seasons = all.map(s => {
        const top3 = (s.rankings || [])
          .filter(r => r.rank > 0 && r.rank <= 3)
          .sort((a, b) => a.rank - b.rank)
          .map(r => ({ rank: r.rank, nickname: r.nickname || '玩家', avatar: r.avatar || '' }))
        return {
          _id: s._id,
          seasonName: s.seasonName,
          honors: top3,
          settledAt: s.settledAt
        }
      })
      this.setData({ seasons, loading: false })
    } catch (err) {
      console.error(err)
      this.setData({ loading: false })
    }
  }
})
