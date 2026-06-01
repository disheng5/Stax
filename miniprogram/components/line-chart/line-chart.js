// components/line-chart/line-chart.js — 纯 WXML 折线图，无 Canvas
Component({
  properties: {
    points: { type: Array, value: [] },
    height: { type: Number, value: 180 },
    color: { type: String, value: '#2B6CB0' }
  },
  observers: {
    points: function (pts) {
      this._build(pts)
    },
    height: function (h) {
      this.setData({ heightRpx: (h || 180) * 2 })
    }
  },
  lifetimes: {
    attached() {
      this.setData({ heightRpx: (this.data.height || 180) * 2 })
    }
  },
  methods: {
    _build(pts) {
      if (!pts || !pts.length) {
        this.setData({ segments: [], dots: [], yLabels: [], xLabels: [], empty: true })
        return
      }

      const W = 300
      const H = 140
      const PAD_L = 36
      const PAD_R = 8
      const PAD_T = 10
      const PAD_B = 20
      const plotW = W - PAD_L - PAD_R
      const plotH = H - PAD_T - PAD_B

      const ys = pts.map(p => Number(p.y) || 0)
      const rawMax = Math.max(...ys)
      const rawMin = Math.min(...ys)
      const spread = rawMax - rawMin
      const pad = spread === 0 ? Math.max(Math.abs(rawMax) * 0.2, 10) : spread * 0.15
      const domainMax = rawMax + pad
      const domainMin = rawMin - pad
      const range = domainMax - domainMin

      const toX = i => PAD_L + (pts.length > 1 ? (i / (pts.length - 1)) * plotW : plotW / 2)
      const toY = v => PAD_T + plotH - ((v - domainMin) / range) * plotH

      const toXp = i => ((toX(i) / W) * 100).toFixed(2) + '%'
      const toYp = v => ((toY(v) / H) * 100).toFixed(2) + '%'

      const positive = ys[ys.length - 1] >= 0
      const lineColor = positive ? this.data.color : '#c8102e'

      // 折线 segments
      const segments = []
      for (let i = 0; i < pts.length - 1; i++) {
        const x1 = toX(i),
          y1 = toY(ys[i])
        const x2 = toX(i + 1),
          y2 = toY(ys[i + 1])
        const dx = x2 - x1,
          dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy)
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI
        segments.push({
          left: ((x1 / W) * 100).toFixed(2) + '%',
          top: ((y1 / H) * 100).toFixed(2) + '%',
          width: ((len / W) * 100).toFixed(2) + '%',
          angle: angle.toFixed(2),
          color: lineColor
        })
      }

      // 数据点
      const dots = pts.map((p, i) => ({
        left: toXp(i),
        top: toYp(ys[i]),
        color: lineColor
      }))

      // Y 轴标签
      const yLabelCandidates = [rawMax]
      if (rawMin < 0 && rawMax > 0) yLabelCandidates.push(0)
      if (rawMin !== rawMax) yLabelCandidates.push(rawMin)
      const yLabels = []
      for (const v of yLabelCandidates) {
        const yp = toY(v)
        if (yLabels.some(l => Math.abs(Number(l.topRaw) - yp) < 12)) continue
        yLabels.push({ label: String(v), top: ((yp / H) * 100).toFixed(2) + '%', topRaw: yp })
      }

      // X 轴标签（最多 5 个）
      const maxX = 5
      const step = Math.max(1, Math.ceil(pts.length / maxX))
      const xLabels = pts
        .map((p, i) => ({ left: toXp(i), label: p.x, i }))
        .filter((_, i) => i % step === 0 || i === pts.length - 1)

      this.setData({ segments, dots, yLabels, xLabels, empty: false })
    }
  },
  data: {
    segments: [],
    dots: [],
    yLabels: [],
    xLabels: [],
    empty: true,
    heightRpx: 360
  }
})
