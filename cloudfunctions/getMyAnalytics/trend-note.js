const { gameScore } = require('./stats.js')

const MIN_NOTE_SAMPLE = 5

// Alternate topics; all advice is conditional, never a diagnosis from score totals.
const TIPS = [
  '复盘一处犹豫的决定，先写当时的理由，再看最终结果。',
  '行动前确认还有谁没行动，别只看已经投入积分的人。',
  '估计改善概率前，先分清只看下一张，还是会看到全部公共牌。',
  '若发现自己急着追回积分，先离开一会，再决定是否继续。',
  '记一处具体行动和当时的局面，别用一次结果给朋友贴标签。',
  '下一次只选一个小目标，例如每次行动前确认人数和顺序。',
  '挑一场积分为正的记录复盘，也找找有没有只是结果碰巧有利的决定。',
  '座位号不等于行动位置；复盘时记下按钮在哪里、自己何时行动。',
  '把可能改善牌力的情况与真正能领先的情况分开，别把两者直接画等号。',
  '注意自己是否开始跳过平时的思考步骤；察觉到了，就慢一点。',
  '判断对方可能持有什么时，列出几种合理情况，不急着锁定一手牌。',
  '结束后只留一条值得回看的问题，不必把每一处波动都带回家。',
  '回看修改后的结算记录时，先确认积分口径一致，再比较场次。',
  '人数变化后，重新看行动顺序和后续可能的参与者，不照搬上一手的判断。',
  '连续几次没出现某种结果，不代表下一次就该轮到它。',
  '状态好的时候先定好休息时间，比疲惫后临时决定更从容。',
  '观察同一种行动是否在相似局面里反复出现，再考虑调整判断。',
  '给一次调整留足复盘空间，不因单场结果立刻推翻所有做法。',
  '复盘时分两列：当时知道什么、结束后才知道什么，避免事后替自己补信息。',
  '跟注前先确认需要追加多少积分，不把此前已投入的积分当作必须继续的理由。',
  '概率估计没有把握时，写下区间和假设，比给出一个过于精确的数更有用。',
  '若注意力已经离开当前局面，休息几分钟也是一次主动选择。',
  '有分歧时先把行动过程说清楚，讨论选择，不评价人。',
  '记下一次考虑充分的放弃；复盘不必只围着最大的积分变化转。',
  '比较两次相似决定时，先对齐人数、行动位置和当时已知的信息。',
  '准备采取行动前，想一句：如果后续情况变化，我接下来怎么应对？',
  '遇到小概率逆转，先核对原先的概率判断，不用一次结果否定全部过程。',
  '想改变节奏时，先分清是局面变了，还是心情变了。',
  '未参与当前一手时，可以留意行动顺序与投入规模，不干扰正在做决定的人。',
  '把今天值得保留的一处判断记下来，下次再看看能否重复做到。'
]

const PERSPECTIVES = {
  loss: [
    '最近不太顺时，不必急着证明什么。先把注意力放回下一次能想清楚的选择。',
    '积分落后是这段记录的结果，不是对能力的评语。复盘可以认真，也可以对自己温和一点。',
    '一次意外逆转值得理解，不必反复责备自己。回到当时的信息，才能判断哪里值得调整。',
    '想把结果追回来很自然，但下一次选择不需要替上一场负责。'
  ],
  up: [
    '结果向好值得开心，也可以留意哪些选择值得保留，而不只是记住最后的积分。',
    '顺利时也能做一次平静的复盘：哪些判断有依据，哪些只是结果恰好有利。',
    '好的结果是一份反馈，不必因此加快节奏。保持原本清楚的思考过程就好。',
    '与其急着给自己下结论，不如记住这段时间做对了哪些可以重复的事。'
  ],
  neutral: [
    '积分记录呈现结果，具体判断还需要回到当时的局面。两者一起看，复盘才更完整。',
    '相近的总分可能来自很不一样的过程。挑一两个记得清楚的决定，比笼统评价更有用。',
    '把注意力放在能解释清楚的选择上，结果可以观察，不必每次都急着定性。',
    '朋友局的乐趣和认真的思考并不冲突。留一点好奇，也给波动留一点空间。'
  ]
}

function buildTrendSignals(games, openid) {
  const ordered = (games || [])
    .filter(g => g.status === 'ended' && gameScore(g, openid) !== null)
    .slice()
    .sort(
      (a, b) =>
        new Date(a.endedAt || a.startedAt) - new Date(b.endedAt || b.startedAt) ||
        String(a._id || '').localeCompare(String(b._id || ''))
    )
  const scores = ordered.map(g => gameScore(g, openid))
  const recent = scores.slice(-5)
  const previous = scores.slice(-10, -5)
  const sum = values => values.reduce((total, value) => total + value, 0)
  const recentSum = sum(recent),
    prevSum = sum(previous)
  let lossStreak = 0
  for (let i = scores.length - 1; i >= 0 && scores[i] < 0; i--) lossStreak++
  return {
    sampleCount: scores.length,
    recentSum,
    prevSum,
    best: scores.length ? Math.max(...scores) : 0,
    worst: scores.length ? Math.min(...scores) : 0,
    direction: recentSum > prevSum ? 'up' : recentSum < prevSum ? 'down' : 'flat',
    recentWins: recent.filter(score => score > 0).length,
    recentLosses: recent.filter(score => score < 0).length,
    recentBest: recent.length ? Math.max(...recent) : 0,
    recentWorst: recent.length ? Math.min(...recent) : 0,
    lossStreak
  }
}

function buildTrendNote(signals, { variation = 0 } = {}) {
  if (!signals || (signals.sampleCount || 0) < MIN_NOTE_SAMPLE) return { enough: false }
  const {
    sampleCount,
    recentSum,
    prevSum,
    recentWins,
    recentLosses,
    recentBest,
    recentWorst,
    lossStreak
  } = signals
  const index = Number.isSafeInteger(variation) && variation >= 0 ? variation : 0
  const comparable = sampleCount >= 10
  const rising = comparable && recentSum > prevSum
  const falling = comparable && recentSum < prevSum
  const fmt = value => `${value >= 0 ? '+' : ''}${value}`
  const total = `近 5 场合计 ${fmt(recentSum)} 分。`
  let observation = total
  if (comparable) {
    observation =
      `近 5 场合计 ${fmt(recentSum)} 分，` +
      (rising
        ? `高于前 5 场的 ${fmt(prevSum)} 分。`
        : falling
          ? `低于前 5 场的 ${fmt(prevSum)} 分。`
          : '与前 5 场合计相同。')
  }
  // Only use richer observations when their source signals exist (old callers remain supported).
  if (lossStreak >= 3) {
    observation = `最近连续 ${lossStreak} 场积分为负，` + total
  } else if (index % 3 === 1 && Number.isInteger(recentWins) && Number.isInteger(recentLosses)) {
    const even = 5 - recentWins - recentLosses
    observation =
      `近 5 场中，${recentWins} 场积分为正，${recentLosses} 场为负` +
      (even > 0 ? `，${even} 场持平。` : '。') +
      total
  } else if (index % 3 === 2 && Number.isFinite(recentBest) && Number.isFinite(recentWorst)) {
    observation =
      recentBest === recentWorst
        ? `近 5 场每场均为 ${fmt(recentBest)} 分。`
        : `近 5 场单场结果在 ${fmt(recentWorst)} 至 ${fmt(recentBest)} 分之间。`
    observation += total
  }
  const context = recentSum < 0 || lossStreak >= 3 ? 'loss' : rising ? 'up' : 'neutral'
  return {
    enough: true,
    observation,
    perspective: PERSPECTIVES[context][index % PERSPECTIVES[context].length],
    action: TIPS[index % TIPS.length]
  }
}

module.exports = { buildTrendSignals, buildTrendNote, MIN_NOTE_SAMPLE, TIP_COUNT: TIPS.length }
