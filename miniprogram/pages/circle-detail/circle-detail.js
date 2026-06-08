const app = getApp()

Page({
  data: {
    circleId: '',
    circle: null,
    season: null,
    ranked: [],
    unranked: [],
    members: [],
    isOwner: false,
    daysLeft: 0,
    loading: true
  },

  onLoad(options) {
    this.setData({ circleId: options.id || '' })
  },

  async onShow() {
    await this._fetch()
  },

  async _fetch() {
    const openid = app.globalData.openid
    if (!this.data.circleId) return
    try {
      const db = wx.cloud.database()
      const got = await db.collection('circles').doc(this.data.circleId).get()
      const circle = got.data
      const isOwner = circle.ownerOpenid === openid
      let season = null,
        ranked = [],
        unranked = [],
        daysLeft = 0

      if (circle.currentSeasonId) {
        const s = await db
          .collection('seasons')
          .doc(circle.currentSeasonId)
          .get()
          .catch(() => null)
        if (s && s.data) {
          season = s.data
          const now = new Date()
          daysLeft = Math.max(0, Math.ceil((new Date(s.data.endAt) - now) / (24 * 60 * 60 * 1000)))
          ranked = (s.data.rankings || []).filter(r => r.rank > 0).sort((a, b) => a.rank - b.rank)
          unranked = (s.data.rankings || []).filter(r => r.rank === 0)
        }
      }

      this.setData({ circle, season, ranked, unranked, isOwner, daysLeft, loading: false })
      this._buildMembers(circle, season)
    } catch (err) {
      console.error(err)
      this.setData({ loading: false })
    }
  },

  async _buildMembers(circle, season) {
    const rankMap = {}
    if (season) {
      ;(season.rankings || []).forEach(r => {
        rankMap[r.openid] = r.nickname
      })
    }
    const members = (circle.memberOpenids || []).map(openid => ({
      openid,
      nickname: rankMap[openid] || ''
    }))
    this.setData({ members })

    const needFetch = members.filter(m => !m.nickname).map(m => m.openid)
    if (!needFetch.length) return
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAvatars',
        data: { openids: needFetch }
      })
      const nicknames = res.result?.nicknames || {}
      const updated = this.data.members.map(m => ({
        ...m,
        nickname: m.nickname || nicknames[m.openid] || '成员'
      }))
      this.setData({ members: updated })
    } catch (err) {
      console.error(err)
    }
  },

  onHistory() {
    wx.navigateTo({ url: '/pages/circle-history/circle-history?id=' + this.data.circleId })
  },

  onLeave() {
    wx.showModal({
      title: '退出圈子',
      content: '退出后不再参与排名，已有积分保留。',
      confirmText: '退出',
      confirmColor: '#C8102E',
      success: async r => {
        if (!r.confirm) return
        try {
          const res = await wx.cloud.callFunction({
            name: 'leaveCircle',
            data: { circleId: this.data.circleId }
          })
          if (res.result?.ok) {
            wx.showToast({ title: '已退出' })
            wx.navigateBack()
          } else {
            wx.showToast({ title: res.result?.error || '操作失败', icon: 'none' })
          }
        } catch (_) {
          wx.showToast({ title: '网络异常', icon: 'none' })
        }
      }
    })
  },

  onResetSeason() {
    wx.showModal({
      title: '重置本季积分',
      content: '将清空当前赛季所有积分并重新计算，确定吗？',
      confirmText: '重置',
      confirmColor: '#C8102E',
      success: async r => {
        if (!r.confirm) return
        wx.showLoading({ title: '重置中…' })
        try {
          const res = await wx.cloud.callFunction({
            name: 'resetSeason',
            data: { circleId: this.data.circleId }
          })
          wx.hideLoading()
          if (res.result?.ok) {
            wx.showToast({ title: '已重置，积分重新计算中' })
            setTimeout(() => this._fetch(), 1500)
          } else {
            const msg =
              res.result?.error === 'NO_ACTIVE_SEASON'
                ? '当前无进行中赛季'
                : res.result?.error || '操作失败'
            wx.showToast({ title: msg, icon: 'none' })
          }
        } catch (_) {
          wx.hideLoading()
          wx.showToast({ title: '网络异常', icon: 'none' })
        }
      }
    })
  },

  onDissolve() {
    wx.showModal({
      title: '解散圈子',
      content: '解散后所有成员将无法查看此圈子。',
      confirmText: '解散',
      confirmColor: '#C8102E',
      success: async r => {
        if (!r.confirm) return
        try {
          const res = await wx.cloud.callFunction({
            name: 'dissolveCircle',
            data: { circleId: this.data.circleId }
          })
          if (res.result?.ok) {
            wx.showToast({ title: '已解散' })
            wx.navigateBack()
          } else {
            wx.showToast({ title: res.result?.error || '操作失败', icon: 'none' })
          }
        } catch (_) {
          wx.showToast({ title: '网络异常', icon: 'none' })
        }
      }
    })
  },

  onShareAppMessage() {
    const c = this.data.circle
    return {
      title: `来「${c.name}」一起切磋，看看谁是魁首`,
      path: `/pages/circle-join/circle-join?code=${c.inviteCode}`
    }
  }
})
