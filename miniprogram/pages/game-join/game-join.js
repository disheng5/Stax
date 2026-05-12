// pages/game-join/game-join.js — 加入牌局
const { readLocalProfile } = require('../../utils/user.js')
const app = getApp()

Page({
  data: { code: '', submitting: false },
  onLoad(options) {
    if (options.code) this.setData({ code: String(options.code).toUpperCase() })
  },
  onCodeInput(e) { this.setData({ code: e.detail.value.toUpperCase() }) },
  onScan() {
    wx.scanCode({
      onlyFromCamera: false,
      success: res => {
        const m = String(res.result || '').toUpperCase().match(/[A-Z0-9]{6}/)
        if (m) this.setData({ code: m[0] })
        else wx.showToast({ title: '未识别到邀请码', icon: 'none' })
      }
    })
  },
  async onSubmit() {
    if (!/^[A-Z0-9]{6}$/.test(this.data.code)) {
      wx.showToast({ title: '请输入 6 位邀请码', icon: 'none' }); return
    }
    const profile = readLocalProfile()
    if (!profile.nickname) {
      wx.showModal({
        title: '请先完善资料',
        content: '需要昵称头像才能在牌局中显示，请先去「我的」设置',
        confirmText: '去设置',
        success: r => { if (r.confirm) wx.switchTab({ url: '/pages/profile/profile' }) }
      })
      return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '加入中…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'joinGame',
        data: {
          inviteCode: this.data.code,
          nickname: profile.nickname,
          avatar: profile.avatar
        }
      })
      wx.hideLoading()
      const { ok, gameId, error, alreadyJoined } = res.result || {}
      if (!ok) { wx.showToast({ title: error === 'GAME_NOT_FOUND' ? '邀请码无效或牌局已结束' : (error || '加入失败'), icon: 'none' }); return }
      if (alreadyJoined) wx.showToast({ title: '您已在该牌局中', icon: 'none' })
      wx.redirectTo({ url: `/pages/game-detail/game-detail?id=${gameId}` })
    } catch (err) {
      wx.hideLoading()
      console.error(err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
