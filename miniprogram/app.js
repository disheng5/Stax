const ENV_ID = 'cloud1-d7gykoaktfc01fbf0'

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('[Stax] 当前基础库不支持云开发，请升级微信开发者工具')
      return
    }

    let resolve
    this.globalData.openidReady = new Promise(r => {
      resolve = r
    })
    this._resolveOpenid = resolve

    if (ENV_ID === 'STAX_REPLACE_ME_BEFORE_DEPLOY') {
      this.globalData.demoMode = true
      const cloudMock = require('./utils/cloud-mock.js')
      cloudMock.install()
      console.log('[Stax] Running in DEMO mode (no envId configured)')
      this._whoami()
    } else {
      wx.cloud.init({ env: ENV_ID, traceUser: true })
      this._whoami()
    }

    const shown = wx.getStorageSync('compliance_shown')
    if (!shown) {
      wx.showModal({
        title: '使用须知',
        content:
          'StaxKit 仅供朋友间线下竞技扑克记账与学习交流使用，严禁用于任何形式的赌博活动。请遵守当地法律法规。',
        showCancel: false,
        confirmText: '我已知晓',
        success: () => wx.setStorageSync('compliance_shown', true)
      })
    }
  },

  async _whoami(retry = 0) {
    try {
      const cached = wx.getStorageSync('user_profile') || {}
      const res = await wx.cloud.callFunction({
        name: 'whoami',
        data: {
          upsertNickname: cached.nickname || cached.nickName || undefined,
          upsertAvatar: cached.avatarUrl || cached.avatar || undefined
        }
      })
      if (res && res.result && res.result.ok) {
        this.globalData.openid = res.result.openid
        this.globalData.userDoc = res.result.user
      }
      if (!cached.nickname && !cached.nickName) {
        this.globalData.needProfile = true
      }
    } catch (err) {
      console.error('[whoami]', err)
      if (retry < 2) {
        setTimeout(() => this._whoami(retry + 1), 1500)
        return
      }
    }
    if (this._resolveOpenid) {
      this._resolveOpenid(this.globalData.openid)
      this._resolveOpenid = null
    }
  },

  resetDemo() {
    if (this.globalData.demoMode) {
      require('./utils/cloud-mock.js').reset()
      this._whoami()
    }
  },

  globalData: {
    userInfo: null,
    openid: null,
    userDoc: null,
    openidReady: null,
    demoMode: false,
    defaultBuyIn: 500,
    defaultBlind: { sb: 5, bb: 5, blindUpMinutes: 999 }
  }
})
