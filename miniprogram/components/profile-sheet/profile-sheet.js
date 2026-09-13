const { readLocalProfile, isMeaningfulNickname } = require('../../utils/user.js')
const avatarCache = require('../../utils/avatar.js')

Component({
  data: { visible: false, nickname: '', avatar: '', avatarDisplay: '', hands: 1, buyIn: 0, saving: false },
  lifetimes: {
    detached() {
      this._detached = true
      this._finish(null)
    }
  },
  methods: {
    request({ hands = 1, buyIn = 0 } = {}) {
      if (this._request) return this._request
      const profile = readLocalProfile(getApp().globalData.openid)
      this.setData({ visible: true, nickname: isMeaningfulNickname(profile.nickname) ? profile.nickname : '',
        avatar: profile.avatar, avatarDisplay: avatarCache.displayCached(profile.avatar) || profile.avatar || '/images/default-avatar.png',
        hands, buyIn, saving: false })
      this._avatarChosen = false
      this._request = new Promise(resolve => { this._resolve = resolve })
      return this._request
    },
    _finish(value) {
      const resolve = this._resolve
      this._resolve = null
      this._request = null
      if (!this._detached) this.setData({ visible: false })
      if (resolve) resolve(value)
    },
    onCancel() { if (!this.data.saving) this._finish(null) },
    onStop() {},
    onAvatar(e) {
      if (this.data.saving || !e.detail.avatarUrl) return
      this._avatarChosen = true
      this.setData({ avatar: e.detail.avatarUrl, avatarDisplay: e.detail.avatarUrl })
    },
    onNickname(e) { this.setData({ nickname: e.detail.value }) },
    onHands(e) { this.setData({ hands: e.detail.value }) },
    onStep(e) {
      this.setData({ hands: Math.min(99, Math.max(1, (Number(this.data.hands) || 1) + Number(e.currentTarget.dataset.delta))) })
    },
    async onSubmit(e) {
      if (this.data.saving) return
      const nickname = String(e.detail.value.nickname || this.data.nickname || '').trim()
      const hands = Number(e.detail.value.hands ?? this.data.hands)
      if (!isMeaningfulNickname(nickname) || nickname.length > 24) {
        wx.showToast({ title: '请输入昵称（不超过24个字）', icon: 'none' }); return
      }
      if (!Number.isInteger(hands) || hands < 1 || hands > 99) {
        wx.showToast({ title: '请输入1至99之间的整数', icon: 'none' }); return
      }
      this.setData({ saving: true, nickname, hands })
      try {
        const app = getApp()
        await app.globalData.openidReady
        if (!app.globalData.openid) throw new Error('IDENTITY_UNAVAILABLE')
        let avatar = this.data.avatar
        if (this._avatarChosen) {
          const upload = await wx.cloud.uploadFile({
            cloudPath: `avatars/${app.globalData.openid}_${Date.now()}.jpg`, filePath: avatar
          })
          avatar = upload.fileID
          if (!avatar) throw new Error('UPLOAD_FAILED')
          this._avatarChosen = false
          if (!this._detached) this.setData({ avatar })
        }
        const { result } = await wx.cloud.callFunction({ name: 'whoami', data: {
          upsertNickname: nickname, upsertAvatar: avatar || undefined, clientProfileUpdatedAt: Date.now()
        } })
        if (!result?.ok) throw new Error('PROFILE_SAVE_FAILED')
        const user = result.user || { nickname, avatar }
        if (!isMeaningfulNickname(user.nickname)) throw new Error('PROFILE_SAVE_FAILED')
        app.applyCurrentUser(result.openid || app.globalData.openid, user)
        this._finish({ profile: user, hands })
      } catch (_) {
        if (!this._detached) wx.showToast({ title: '资料未保存，请稍后重试', icon: 'none' })
      } finally {
        if (!this._detached) this.setData({ saving: false })
      }
    }
  }
})
