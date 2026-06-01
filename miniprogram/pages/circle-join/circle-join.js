Page({
  data: { code: '', submitting: false },

  onLoad(options) {
    if (options.code) {
      const code = String(options.code).toUpperCase()
      this.setData({ code })
      this.onJoin()
    }
  },

  onCodeInput(e) {
    this.setData({ code: (e.detail.value || '').toUpperCase() })
  },

  async onJoin() {
    const code = (this.data.code || '').trim()
    if (code.length !== 8) {
      wx.showToast({ title: '请输入 8 位邀请码', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'joinCircle', data: { inviteCode: code } })
      if (res.result?.ok) {
        if (res.result.alreadyJoined) wx.showToast({ title: '你已在圈中', icon: 'none' })
        else wx.showToast({ title: '加入成功' })
        wx.redirectTo({ url: '/pages/circle-detail/circle-detail?id=' + res.result.circleId })
      } else {
        const msg =
          res.result?.error === 'NOT_FOUND' ? '未找到该圈子' : res.result?.error || '加入失败'
        wx.showToast({ title: msg, icon: 'none' })
      }
    } catch (_) {
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
