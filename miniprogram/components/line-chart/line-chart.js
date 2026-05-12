// components/line-chart/line-chart.js — 零依赖折线图（Canvas 2d）
Component({
  properties: {
    // [{ x: '5/1', y: 100 }, ...]
    points: { type: Array, value: [], observer: '_render' },
    height: { type: Number, value: 200 },
    color:  { type: String, value: '#0B6E4F' }
  },
  data: { canvasId: 'lineChart_' + Math.random().toString(36).slice(2, 8) },
  lifetimes: {
    attached() { setTimeout(() => this._render(), 50) }
  },
  methods: {
    _render() {
      const id = this.data.canvasId
      const query = this.createSelectorQuery()
      query.select('#' + id).fields({ node: true, size: true }).exec(res => {
        if (!res || !res[0] || !res[0].node) return
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getSystemInfoSync().pixelRatio || 2
        const cssW = res[0].width
        const cssH = res[0].height
        canvas.width = cssW * dpr
        canvas.height = cssH * dpr
        ctx.scale(dpr, dpr)
        this._draw(ctx, cssW, cssH)
      })
    },
    _draw(ctx, W, H) {
      const pts = this.data.points || []
      ctx.clearRect(0, 0, W, H)
      // 背景网格
      ctx.strokeStyle = '#E5E0D3'; ctx.lineWidth = 0.5
      for (let i = 0; i <= 4; i++) {
        const y = (H - 30) * i / 4 + 10
        ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W - 10, y); ctx.stroke()
      }
      // 0 线
      if (!pts.length) {
        ctx.fillStyle = '#999'; ctx.font = '12px sans-serif'
        ctx.fillText('暂无数据', W / 2 - 30, H / 2)
        return
      }
      const xs = pts.map(p => p.x)
      const ys = pts.map(p => Number(p.y) || 0)
      const maxY = Math.max(...ys, 0)
      const minY = Math.min(...ys, 0)
      const rangeY = maxY - minY || 1
      const plotH = H - 50
      const plotW = W - 50
      const stepX = pts.length > 1 ? plotW / (pts.length - 1) : 0
      // y 轴标签
      ctx.fillStyle = '#999'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right'
      ctx.fillText(maxY, 36, 14)
      ctx.fillText(0,    36, 10 + plotH * (maxY / rangeY))
      ctx.fillText(minY, 36, 10 + plotH)
      ctx.textAlign = 'start'
      // x 轴标签（最多 6 个）
      const xLabelStep = Math.ceil(pts.length / 6)
      pts.forEach((p, i) => {
        if (i % xLabelStep !== 0 && i !== pts.length - 1) return
        const x = 40 + i * stepX
        ctx.fillStyle = '#999'; ctx.fillText(p.x, x - 12, H - 8)
      })
      // 折线
      ctx.strokeStyle = this.data.color
      ctx.lineWidth = 2; ctx.lineJoin = 'round'
      ctx.beginPath()
      pts.forEach((p, i) => {
        const x = 40 + i * stepX
        const y = 10 + plotH - ((Number(p.y) - minY) / rangeY) * plotH
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      })
      ctx.stroke()
      // 数据点
      pts.forEach((p, i) => {
        const x = 40 + i * stepX
        const y = 10 + plotH - ((Number(p.y) - minY) / rangeY) * plotH
        ctx.fillStyle = this.data.color
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill()
      })
    }
  }
})
