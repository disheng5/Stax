Page({
  data: { circleId: '', seasons: [], loading: true },

  onLoad(options) {
    this.setData({ circleId: options.id || '' })
  },

  async onShow() {
    if (!this.data.circleId) return
    try {
      const db = wx.cloud.database()
      const res = await db
        .collection('seasons')
        .where({ circleId: this.data.circleId, status: 'settled' })
        .orderBy('settledAt', 'desc')
        .limit(50)
        .get()
      const seasons = (res.data || []).map(s => {
        const champ = (s.rankings || []).find(r => r.rank === 1)
        return {
          _id: s._id,
          seasonName: s.seasonName,
          championNickname: champ ? champ.nickname : '无人',
          championBB: champ ? champ.profitBB : 0,
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
