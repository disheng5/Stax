// pages/game-create/game-create.js — 创建牌局
const { BLIND_PRESETS } = require('../../utils/constants.js')
const { formatDate } = require('../../utils/format.js')
const app = getApp()

Page({
  data: {
    name: '',
    buyIn: 100,
    blindPreset: 'standard',
    customSb: 10,
    customBb: 20,
    blindUpMinutes: 20,
    submitting: false
  },
  onLoad() {
    const def = app.globalData.defaultBlind
    this.setData({
      name: formatDate(new Date()) + ' 牌局',
      buyIn: app.globalData.defaultBuyIn,
      customSb: def.sb,
      customBb: def.bb,
      blindUpMinutes: def.blindUpMinutes
    })
  },
  onNameInput(e)  { this.setData({ name: e.detail.value }) },
  onBuyInChange(e){ this.setData({ buyIn: e.detail.value }) },
  onPresetTap(e)  {
    const k = e.currentTarget.dataset.k
    this.setData({ blindPreset: k })
    if (k === 'fast')     this.setData({ customSb: 5, customBb: 10 })
    if (k === 'standard') this.setData({ customSb: 10, customBb: 20 })
  },
  onSbChange(e)   { this.setData({ customSb: e.detail.value }) },
  onBbChange(e)   { this.setData({ customBb: e.detail.value }) },
  onUpChange(e)   { this.setData({ blindUpMinutes: e.detail.value }) },

  async onSubmit() {
    if (!this.data.name.trim()) { wx.showToast({ title: '请填写局名', icon: 'none' }); return }
    if (this.data.customBb < this.data.customSb * 2) {
      wx.showToast({ title: '大盲需 ≥ 2 倍小盲', icon: 'none' }); return
    }

    const userInfo = app.globalData.userInfo || {}
    this.setData({ submitting: true })
    wx.showLoading({ title: '创建中…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'createGame',
        data: {
          name: this.data.name.trim(),
          buyIn: Number(this.data.buyIn),
          smallBlind: Number(this.data.customSb),
          bigBlind: Number(this.data.customBb),
          blindUpMinutes: Number(this.data.blindUpMinutes),
          nickname: userInfo.nickName || '庄家',
          avatar: userInfo.avatarUrl || ''
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
        success: () => {
          wx.redirectTo({ url: `/pages/game-detail/game-detail?id=${gameId}` })
        }
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
