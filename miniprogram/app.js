// app.js — Stax 小程序入口
// ⚠️ 部署前必读：
// 1. 在微信开发者工具 →「云开发」→ 创建免费基础版环境
// 2. 把控制台左上角的环境 ID（形如 stax-9gabcd0e-1f2g3h4i5j）粘贴到下方 ENV_ID
// 3. 不要把它当作密钥保护，envId 是公开标识，可直接提交到 git
//
// ✨ Demo 模式：如果 ENV_ID 保持占位符，启动会自动接管 wx.cloud 走本地 mock 数据
//   - 0 配置就能在开发者工具里看到完整 UI 跑起来
//   - 含 1 个进行中牌局、5 局历史、10 个术语、169 起手牌
//   - 数据在内存中，刷新即重置；可在「我的」→「重置 Demo 数据」手动重置
const ENV_ID = 'cloud1-d7gykoaktfc01fbf0'

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('[Stax] 当前基础库不支持云开发，请升级微信开发者工具')
      return
    }

    if (ENV_ID === 'STAX_REPLACE_ME_BEFORE_DEPLOY') {
      // ===== Demo 模式 =====
      this.globalData.demoMode = true
      const cloudMock = require('./utils/cloud-mock.js')
      cloudMock.install()
      console.log('[Stax] Running in DEMO mode (no envId configured)')
      // 仍然走 _whoami 让 globalData 拿到 mock openid
      this._whoami()
    } else {
      // ===== 真实云开发 =====
      wx.cloud.init({ env: ENV_ID, traceUser: true })
      this._whoami()
    }

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
    } catch (err) {
      console.error('[whoami]', err)
      if (retry < 2) setTimeout(() => this._whoami(retry + 1), 1500)
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
    demoMode: false,
    defaultBuyIn: 100,
    defaultBlind: { sb: 10, bb: 20, blindUpMinutes: 20 }
  }
})
