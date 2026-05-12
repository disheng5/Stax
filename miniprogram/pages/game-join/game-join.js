// pages/game-join/game-join.js — 加入牌局
Page({
  data: { code: '' },
  onCodeInput(e) { this.setData({ code: e.detail.value.toUpperCase() }) },
  onScan() {
    wx.scanCode({
      onlyFromCamera: false,
      success: res => this.setData({ code: (res.result || '').toUpperCase().slice(-6) })
    })
  },
  async onSubmit() {
    if (!/^[A-Z0-9]{6}$/.test(this.data.code)) {
      wx.showToast({ title: '请输入 6 位邀请码', icon: 'none' })
      return
    }
    // TODO: 调用 cloudfunction joinGame，跳转 game-detail
    wx.showToast({ title: '骨架阶段，待实现', icon: 'none' })
  }
})
