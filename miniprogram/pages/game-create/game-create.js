// pages/game-create/game-create.js — 创建牌局
const { formatDate } = require('../../utils/format.js')
const { readLocalProfile } = require('../../utils/user.js')
const app = getApp()

Page({
  data: {
    name: '',
    buyIn: 500,
    smallBlind: 5,
    bigBlind: 5,
    blindUpMinutes: 999,
    playerOpsShared: true,
    submitting: false
  },

  onLoad() {
    const def = app.globalData.defaultBlind || { sb: 5, bb: 5, blindUpMinutes: 999 }
    this.setData({
      name: formatDate(new Date()) + ' 牌局',
      buyIn: app.globalData.defaultBuyIn || 500,
      smallBlind: def.sb || 5,
      bigBlind: def.bb || 5,
      blindUpMinutes: 999
    })
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value })
  },
  onBuyInInput(e) {
    this.setData({ buyIn: Number(e.detail.value) || 0 })
  },
  onSbInput(e) {
    this.setData({ smallBlind: Number(e.detail.value) || 0 })
  },
  onBbInput(e) {
    this.setData({ bigBlind: Number(e.detail.value) || 0 })
  },
  onPlayerOpsSharedChange(e) {
    this.setData({ playerOpsShared: !!e.detail.value })
  },

  async onSubmit() {
    if (!this.data.name.trim()) {
      wx.showToast({ title: '请填写局名', icon: 'none' })
      return
    }
    if (this.data.buyIn <= 0) {
      wx.showToast({ title: '买入额需大于 0', icon: 'none' })
      return
    }
    if (this.data.smallBlind <= 0 || this.data.bigBlind <= 0) {
      wx.showToast({ title: '大小盲需大于 0', icon: 'none' })
      return
    }

    const profile = readLocalProfile()
    this.setData({ submitting: true })
    wx.showLoading({ title: '创建中…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'createGame',
        data: {
          name: this.data.name.trim(),
          buyIn: Number(this.data.buyIn),
          smallBlind: Number(this.data.smallBlind),
          bigBlind: Number(this.data.bigBlind),
          blindUpMinutes: Number(this.data.blindUpMinutes),
          playerOpsShared: this.data.playerOpsShared,
          nickname: profile.nickname || '玩家',
          avatar: profile.avatar || ''
        }
      })
      wx.hideLoading()
      const { ok, gameId, inviteCode, error } = res.result || {}
      if (!ok) {
        wx.showToast({ title: error || '创建失败', icon: 'none' })
        return
      }
      wx.showModal({
        title: '牌局已创建',
        content: `邀请码：${inviteCode}\n点击确定进入牌局`,
        showCancel: false,
        success: () => wx.redirectTo({ url: `/pages/game-detail/game-detail?id=${gameId}` })
      })
    } catch (err) {
      wx.hideLoading()
      console.error(err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
