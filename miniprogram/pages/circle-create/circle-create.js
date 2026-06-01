const CIRCLE_NAMES = [
  '江湖夜雨',
  '风林火山',
  '月下切磋',
  '长亭短打',
  '竹林七贤',
  '梅花三弄',
  '醉卧沙场',
  '华山论剑',
  '清风明月',
  '卧虎藏龙',
  '高山流水',
  '烟雨江南',
  '松下问童',
  '沧海一粟',
  '浮生若梦',
  '踏雪寻梅',
  '临风把盏',
  '听雨楼台',
  '对弈青山',
  '煮酒论道'
]

Page({
  data: { name: '', submitting: false },

  onLoad() {
    this.setData({ name: CIRCLE_NAMES[Math.floor(Math.random() * CIRCLE_NAMES.length)] })
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value })
  },

  async onCreate() {
    const name = (this.data.name || '').trim()
    if (!name || name.length > 12) {
      wx.showToast({ title: '圈名 1-12 个字', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'createCircle', data: { name } })
      if (res.result?.ok) {
        wx.showToast({ title: '创建成功' })
        wx.redirectTo({ url: '/pages/circle-detail/circle-detail?id=' + res.result.circleId })
      } else {
        wx.showToast({ title: res.result?.error || '创建失败', icon: 'none' })
      }
    } catch (err) {
      console.error('[createCircle]', err)
      wx.showToast({ title: '网络异常，请确认云函数已部署', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
