// scripts/stats-all-users.js — 全体用户战绩统计（只读离线分析）
//
// 用法：node scripts/stats-all-users.js <games导出文件> [users导出文件]
//   导出方式：云开发控制台 → 数据库 → games 集合 → 导出（JSON，不加筛选）
//   支持 JSON 数组与 JSON Lines 两种导出格式。
//
// 两套口径（2026-07-28 已与真机核对通过）：
//  · 自见口径 = App「我的 / 战绩」页所见：排除该用户自己删掉的记录(hiddenForOpenids)，
//    且不排除 eliminatedAt（与 utils/stats.js 的 gameScore 行为一致）——用于与手机核对
//  · 全量口径 = 运营视角：不管谁删过都算，仅排除被踢/淘汰的玩家
// 计算函数直接复用 miniprogram/utils/stats.js，保证与 App 内显示同源。

const fs = require('fs')
const path = require('path')
const { computeGameStats } = require('../miniprogram/utils/stats.js')

const GENERIC_NICKNAMES = new Set(['玩家', '庄家', '微信用户', '未设置昵称'])
const meaningful = v => {
  const s = typeof v === 'string' ? v.trim() : ''
  return !!s && !GENERIC_NICKNAMES.has(s)
}

// 云导出可能把日期序列化成 ISO 字符串或 {$date:...}
function toTime(value) {
  if (!value) return 0
  if (typeof value === 'object') {
    const inner = value.$date || value.$$date || value.date
    return inner ? toTime(inner) : 0
  }
  const n = +new Date(value)
  return Number.isFinite(n) ? n : 0
}

function readCollection(file) {
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.data)) return parsed.data
    return [parsed]
  } catch (_) {
    return raw
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map((l, i) => {
        try {
          return JSON.parse(l)
        } catch (err) {
          console.warn(`  ! 第 ${i + 1} 行解析失败，已跳过`)
          return null
        }
      })
      .filter(Boolean)
  }
}

const width = s => [...String(s)].reduce((w, ch) => w + (/[一-龥＀-￯—·]/.test(ch) ? 2 : 1), 0)
const pad = (s, n, right = false) => {
  const gap = ' '.repeat(Math.max(0, n - width(s)))
  return right ? gap + s : s + gap
}
const signed = n => (n > 0 ? `+${n}` : String(n))
const fmtDate = t => (t ? new Date(t).toISOString().slice(0, 10) : '—')

function main() {
  const [gamesFile, usersFile] = process.argv.slice(2)
  if (!gamesFile) {
    console.error('用法: node scripts/stats-all-users.js <games导出文件> [users导出文件]')
    process.exit(1)
  }

  const allGames = readCollection(path.resolve(gamesFile))
  const userDocs = usersFile ? readCollection(path.resolve(usersFile)) : []

  // users 表昵称优先（权威资料），games 里的快照兜底
  const authoritative = {}
  userDocs.forEach(u => {
    const openid = u._openid || u.openid
    if (!openid || !meaningful(u.nickname)) return
    const t = toTime(u.updatedAt || u.profileUpdatedAt || u.createdAt)
    if (!authoritative[openid] || t >= authoritative[openid].t) {
      authoritative[openid] = { nickname: u.nickname.trim(), t }
    }
  })

  const ended = allGames.filter(g => g.status === 'ended')
  const ongoing = allGames.filter(g => g.status === 'ongoing')
  const active = g => (g.players || []).filter(p => !p.eliminatedAt)

  const users = new Map()
  ended.forEach(g => {
    const at = toTime(g.endedAt || g.startedAt)
    const hidden = Array.isArray(g.hiddenForOpenids) ? g.hiddenForOpenids : []
    ;(g.players || [])
      .filter(p => p && p.openid)
      .forEach(p => {
        if (!users.has(p.openid)) {
          users.set(p.openid, {
            openid: p.openid,
            nickname: '',
            nickAt: -1,
            selfGames: [],
            allGames: [],
            hiddenCount: 0,
            lastAt: 0
          })
        }
        const u = users.get(p.openid)
        if (hidden.includes(p.openid)) u.hiddenCount++
        else u.selfGames.push(g)
        if (!p.eliminatedAt) {
          u.allGames.push(g)
          u.lastAt = Math.max(u.lastAt, at)
        }
        if (meaningful(p.nickname) && at >= u.nickAt) {
          u.nickname = p.nickname.trim()
          u.nickAt = at
        }
      })
  })

  const rows = [...users.values()]
    .map(u => {
      const s = computeGameStats(u.selfGames, u.openid)
      const all = computeGameStats(u.allGames, u.openid)
      return {
        nickname: authoritative[u.openid]?.nickname || u.nickname || '(未设置昵称)',
        games: s.totalGames,
        profit: s.totalProfit,
        winRate: s.winRate,
        avg: s.totalGames ? Math.round(s.totalProfit / s.totalGames) : 0,
        best: s.biggestWin,
        worst: s.biggestLoss,
        allProfit: all.totalProfit,
        hiddenCount: u.hiddenCount,
        lastAt: u.lastAt
      }
    })
    .sort((a, b) => b.profit - a.profit || b.games - a.games)

  // ===== 概览 =====
  const slots = ended.reduce((n, g) => n + active(g).length, 0)
  const durations = ended
    .map(g => toTime(g.endedAt) - toTime(g.startedAt))
    .filter(ms => ms > 0 && ms < 24 * 3600 * 1000)
  const hours = durations.reduce((s, ms) => s + ms, 0) / 3600000

  console.log('\n════════ StaxKit 全体用户战绩统计 ════════\n')
  console.log(`  已结束记录   ${ended.length} 场（进行中 ${ongoing.length} 场）`)
  console.log(`  参与用户     ${rows.length} 人`)
  console.log(`  平均每场人数 ${ended.length ? (slots / ended.length).toFixed(1) : 0} 人`)
  if (durations.length) {
    console.log(
      `  累计牌局时长 ${hours.toFixed(1)} 小时（均场 ${((hours / durations.length) * 60).toFixed(0)} 分钟）`
    )
  }
  const span = ended.map(g => toTime(g.endedAt || g.startedAt)).filter(Boolean)
  if (span.length) {
    console.log(`  数据区间     ${fmtDate(Math.min(...span))} ~ ${fmtDate(Math.max(...span))}`)
  }

  // ===== 用户明细 =====
  console.log('\n──────── 用户明细（自见口径 = 与用户手机所见一致）────────\n')
  const head =
    pad('昵称', 16) +
    pad('局数', 6, true) +
    pad('累计盈亏', 12, true) +
    pad('胜率', 8, true) +
    pad('场均', 10, true) +
    pad('最大赢', 10, true) +
    pad('最大输', 10, true) +
    pad('已删', 6, true) +
    pad('全量盈亏', 12, true) +
    '  最近参与'
  console.log(head)
  console.log('─'.repeat(width(head) + 2))
  rows.forEach(r => {
    console.log(
      pad(r.nickname.slice(0, 8), 16) +
        pad(String(r.games), 6, true) +
        pad(signed(r.profit), 12, true) +
        pad(`${r.winRate}%`, 8, true) +
        pad(signed(r.avg), 10, true) +
        pad(signed(r.best), 10, true) +
        pad(signed(r.worst), 10, true) +
        pad(r.hiddenCount ? String(r.hiddenCount) : '-', 6, true) +
        pad(r.allProfit === r.profit ? '同左' : signed(r.allProfit), 12, true) +
        '  ' +
        fmtDate(r.lastAt)
    )
  })
  console.log('\n  「已删」= 该用户在自己端删除的场次；「全量盈亏」= 含已删场次的运营口径')

  // ===== 真实牌局（积分榜合规口径：≥4人 且 ≥20分钟）=====
  const real = ended.filter(
    g => active(g).length >= 4 && toTime(g.endedAt) - toTime(g.startedAt) >= 20 * 60000
  )
  console.log('\n──────── 真实牌局（≥4人 且 ≥20分钟，并排除各自已删除的场次）────────\n')
  console.log(`  ${real.length} 场 / 共 ${ended.length} 场已结束`)
  const realDur = real.map(g => toTime(g.endedAt) - toTime(g.startedAt))
  if (realDur.length) {
    console.log(`  均场时长 ${(realDur.reduce((a, b) => a + b, 0) / realDur.length / 60000).toFixed(0)} 分钟`)
  }
  const RU = new Map()
  real.forEach(g => {
    const at = toTime(g.endedAt)
    const hidden = Array.isArray(g.hiddenForOpenids) ? g.hiddenForOpenids : []
    active(g).forEach(p => {
      if (!p.openid) return
      // 谁删了就不计入谁的统计（删除即"这是测试局/不算数"的意思表示）。
      // 注意：线上积分榜 calcSeasonScore 不做此过滤（个人删除不应能改共享榜单，
      // 否则删掉输的局就能刷排名）；共享口径由榜主的 excludeGame 控制。
      if (hidden.includes(p.openid)) return
      if (!RU.has(p.openid)) RU.set(p.openid, { n: '', t: -1, gs: [] })
      const u = RU.get(p.openid)
      u.gs.push(g)
      if (meaningful(p.nickname) && at >= u.t) {
        u.n = p.nickname.trim()
        u.t = at
      }
    })
  })
  const realRows = [...RU.entries()]
    .map(([o, u]) => ({ n: u.n || '(未设置)', ...computeGameStats(u.gs, o) }))
    .sort((a, b) => b.totalProfit - a.totalProfit)
  console.log('\n' + pad('昵称', 16) + pad('局数', 6, true) + pad('累计盈亏', 12, true) + pad('胜率', 8, true))
  realRows.forEach(r =>
    console.log(
      pad(r.n.slice(0, 8), 16) +
        pad(String(r.totalGames), 6, true) +
        pad(signed(r.totalProfit), 12, true) +
        pad(`${r.winRate}%`, 8, true)
    )
  )

  // ===== 数据校验 =====
  console.log('\n──────── 数据校验 ────────\n')
  const diffOf = g => active(g).reduce((s, p) => s + (Number(p.finalProfit ?? p.profit) || 0), 0)
  const unbalanced = ended.filter(g => diffOf(g) !== 0)
  if (!unbalanced.length) {
    console.log('  ✓ 全部已结束记录账面平衡（每场 Σ盈亏 = 0）')
  } else {
    const soloDiff = unbalanced.filter(g => active(g).length <= 2).reduce((s, g) => s + diffOf(g), 0)
    const realDiff = unbalanced.filter(g => active(g).length >= 4).reduce((s, g) => s + diffOf(g), 0)
    console.log(`  ${unbalanced.length} 场账不平，其中：`)
    console.log(
      `    · 1~2 人空局/测试局 ${unbalanced.filter(g => active(g).length <= 2).length} 场，虚假账差合计 ${signed(soloDiff)}`
    )
    console.log(
      `    · 真实多人局 ${unbalanced.filter(g => active(g).length >= 4).length} 场，账差合计 ${signed(realDiff)} ← 只有这个值得关注`
    )
    unbalanced
      .filter(g => active(g).length >= 4)
      .sort((a, b) => Math.abs(diffOf(b)) - Math.abs(diffOf(a)))
      .forEach(g =>
        console.log(`      ${fmtDate(toTime(g.endedAt))}  ${g.name}  账差 ${signed(diffOf(g))}`)
      )
  }
  const total = rows.reduce((s, r) => s + r.allProfit, 0)
  console.log(`  全员盈亏合计 ${signed(total)}（全量口径，按记分比例折算后理论应接近 0）`)
  const hidden = ended.filter(g => (g.hiddenForOpenids || []).length).length
  if (hidden) console.log(`  注：${hidden} 场记录被部分用户在自己端删除（不影响他人战绩）`)
  console.log('')
}

main()
