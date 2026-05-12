// app.js — Stax 小程序入口
App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('[Stax] 当前基础库不支持云开发，请升级微信开发者工具')
      return
    }
    wx.cloud.init({
      env: 'your-env-id',
      traceUser: true
    })

    // 合规弹窗：首次进入提示（详见 Spec §5.5）
    const shown = wx.getStorageSync('compliance_shown')
    if (!shown) {
      wx.showModal({
        title: '使用须知',
        content:
          '长河筹略（Stax）仅供朋友间线下竞技扑克记账与学习交流使用，严禁用于任何形式的赌博活动。请遵守当地法律法规。',
        showCancel: false,
        confirmText: '我已知晓',
        success: () => wx.setStorageSync('compliance_shown', true)
      })
    }

    // 拉取自身 openid，写入 globalData
    this._whoami()
  },

  async _whoami(retry = 0) {
    try {
      const cached = wx.getStorageSync('user_profile') || {}
      const res = await wx.cloud.callFunction({
        name: 'whoami',
        data: {
          upsertNickname: cached.nickName || undefined,
          upsertAvatar: cached.avatarUrl || undefined
        }
      })
      if (res && res.result && res.result.ok) {
        this.globalData.openid = res.result.openid
        this.globalData.userDoc = res.result.user
      }
    } catch (err) {
      console.error('[whoami]', err)
      if (retry < 2) setTimeout(() => this._whoami(retry + 1), 1500)
    }
  },

  globalData: {
    userInfo: null,
    openid: null,
    userDoc: null,
    defaultBuyIn: 100,
    defaultBlind: { sb: 10, bb: 20, blindUpMinutes: 20 }
  }
})
