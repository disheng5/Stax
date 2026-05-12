// components/empty-state/empty-state.js — 空状态
Component({
  properties: {
    icon:  { type: String, value: '/images/empty.png' },
    title: { type: String, value: '暂无数据' },
    desc:  { type: String, value: '' },
    actionText: { type: String, value: '' }
  },
  methods: {
    onAction() { this.triggerEvent('action') }
  }
})
