const ENV_ID = 'cloud1-d7gykoaktfc01fbf0'
const {
  isMeaningfulNickname,
  readLocalProfile,
  writeLocalProfile
} = require('./utils/user.js')
const avatarCache = require('./utils/avatar.js')

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('[Stax] 当前基础库不支持云开发，请升级微信开发者工具')
      return
    }

    const localProfile = readLocalProfile()
    if (localProfile.nickname || localProfile.avatar) {
      this.globalData.userDoc = {
        nickname: localProfile.nickname,
        avatar: localProfile.avatar,
        updatedAt: localProfile.updatedAt || ''
      }
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
      this.refreshCurrentUser()
      setTimeout(() => this._warmAvatarUrls(), 800)
    } else {
      wx.cloud.init({ env: ENV_ID, traceUser: true })
      this.refreshCurrentUser()
      setTimeout(() => this._warmAvatarUrls(), 800)
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

  _warmAvatarUrls() {
    try {
      const { getCachedAvatarFileIDs } = require('./utils/game-data.js')
      const fileIDs = getCachedAvatarFileIDs()
      if (fileIDs.length) avatarCache.resolveDisplayUrls(fileIDs)
    } catch (_) {}
  },

  applyCurrentUser(openid, user = {}) {
    const local = readLocalProfile()
    const localMatches = !openid || (!!local.openid && local.openid === openid)
    if (openid) {
      this.globalData.openid = openid
      try {
        wx.setStorageSync('last_openid', openid)
      } catch (_) {}
    }
    const nickname = isMeaningfulNickname(user.nickname)
      ? user.nickname.trim()
      : localMatches
        ? local.nickname || ''
        : ''
    const avatar = user.avatar || (localMatches ? local.avatar || '' : '')
    const merged = { ...user, nickname, avatar }
    this.globalData.userDoc = merged
    this.globalData.needProfile = !isMeaningfulNickname(nickname)
    this.globalData.profileRevision++
    if (nickname || avatar) {
      writeLocalProfile({
        nickname,
        avatar,
        updatedAt: user.updatedAt || (localMatches ? local.updatedAt : '') || '',
        openid
      })
    }
    if (this.globalData.openid) {
      avatarCache.putProfiles(
        [
          {
            openid: this.globalData.openid,
            nickname,
            avatar,
            updatedAt: user.updatedAt || ''
          }
        ],
        { source: 'self', authoritative: true }
      )
    }
    if (avatar && avatar.startsWith('cloud://')) {
      avatarCache.resolveDisplayUrls([avatar])
    }
    return merged
  },

  async refreshCurrentUser(options = {}) {
    if (
      !options.force &&
      this.globalData.openid &&
      this._identityAt &&
      Date.now() - this._identityAt < 5 * 60 * 1000
    ) {
      return this.globalData.userDoc
    }
    if (this._identityPromise) return this._identityPromise
    const task = this._whoami()
    this._identityPromise = task
    try {
      return await task
    } finally {
      if (this._identityPromise === task) this._identityPromise = null
    }
  },

  async _whoami(retry = 0) {
    try {
      const cached = readLocalProfile()
      const res = await wx.cloud.callFunction({
        name: 'whoami',
        data: {
          // 仅用于修复历史空资料；云端已有真资料时绝不会用本机旧缓存覆盖。
          bootstrapNickname: cached.nickname || undefined,
          bootstrapAvatar: cached.avatar || undefined,
          bootstrapOpenid: cached.openid || undefined
        }
      })
      if (res && res.result && res.result.ok) {
        const user = this.applyCurrentUser(res.result.openid, res.result.user || {})
        this._identityAt = Date.now()
        this._resolveIdentityReady()
        return user
      }
      throw new Error((res && res.result && res.result.error) || 'WHOAMI_FAILED')
    } catch (err) {
      console.error('[whoami]', err)
      if (retry < 2) {
        await new Promise(resolve => setTimeout(resolve, 500 * (retry + 1)))
        return this._whoami(retry + 1)
      }
    }
    this._resolveIdentityReady()
    return null
  },

  _resolveIdentityReady() {
    if (this._resolveOpenid) {
      this._resolveOpenid(this.globalData.openid)
      this._resolveOpenid = null
    }
  },

  resetDemo() {
    if (this.globalData.demoMode) {
      require('./utils/cloud-mock.js').reset()
      this.refreshCurrentUser()
    }
  },

  globalData: {
    userInfo: null,
    openid: null,
    userDoc: null,
    profileRevision: 0,
    needProfile: false,
    openidReady: null,
    demoMode: false,
    defaultBuyIn: 500,
    defaultBlind: { sb: 5, bb: 5, blindUpMinutes: 999 }
  }
})
