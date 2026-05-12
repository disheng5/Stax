// pages/game-create/game-create.js — 创建牌局
const { BLIND_PRESETS } = require('../../utils/constants.js')
const { formatDate } = require('../../utils/format.js')

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
    this.setData({ name: formatDate(new Date()) + ' 牌局' })
  },
  onNameInput(e)  { this.setData({ name: e.detail.value }) },
  onBuyInChange(e){ this.setData({ buyIn: e.detail.value }) },
  onPresetTap(e)  { this.setData({ blindPreset: e.currentTarget.dataset.k }) },
  onSbChange(e)   { this.setData({ customSb: e.detail.value }) },
  onBbChange(e)   { this.setData({ customBb: e.detail.value }) },
  onUpChange(e)   { this.setData({ blindUpMinutes: e.detail.value }) },
  async onSubmit() {
    // TODO: 调用 cloudfunction createGame，返回邀请码后跳详情页
    wx.showToast({ title: '骨架阶段，待实现', icon: 'none' })
  }
})
