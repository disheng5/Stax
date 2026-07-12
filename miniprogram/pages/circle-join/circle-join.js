Page({
  data: {
    code: '',
    status: 'joining',
    message: '正在验证好友邀请…'
  },

  onLoad(options) {
    const code = String(options.code || '').toUpperCase()
    if (!/^[A-Z0-9]{8}$/.test(code)) {
      this.setData({
        status: 'error',
        message: '请从好友分享的积分榜邀请进入'
      })
      return
    }
    this.setData({ code })
    this._join()
  },

  async _join() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'joinCircle',
        data: { inviteCode: this.data.code }
      })
      if (!res.result?.ok) {
        this.setData({
          status: 'error',
          message:
            res.result?.error === 'NOT_FOUND'
              ? '邀请已失效，请让好友重新分享'
              : res.result?.error || '暂时无法加入，请稍后重试'
        })
        return
      }
      if (res.result.alreadyJoined) wx.showToast({ title: '你已在积分榜中', icon: 'none' })
      else wx.showToast({ title: '加入成功', icon: 'success' })
      wx.redirectTo({ url: '/pages/circle-detail/circle-detail?id=' + res.result.circleId })
    } catch (_) {
      this.setData({ status: 'error', message: '网络异常，请从邀请重新进入' })
    }
  },

  onBack() {
    wx.switchTab({ url: '/pages/circle-index/circle-index' })
  }
})
