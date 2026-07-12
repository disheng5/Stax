const assert = require('assert')
const {
  buildSeasonView,
  pickHonors,
  sanitizeMembers,
  buildOwnerReview
} = require('../miniprogram/utils/season-view.js')

// === 荣誉只取有效参与者(games>0)前三，仅暴露安全字段 ===
const rankings = [
  {
    openid: 'a',
    nickname: 'Alice',
    avatar: 'av_a',
    profileUpdatedAt: '2025',
    rank: 1,
    profitBB: 100,
    games: 5,
    wins: 3,
    winRate: 60
  },
  {
    openid: 'b',
    nickname: 'Bob',
    avatar: 'av_b',
    profileUpdatedAt: '2025',
    rank: 2,
    profitBB: 50,
    games: 3,
    wins: 2,
    winRate: 66
  },
  {
    openid: 'c',
    nickname: 'Carol',
    avatar: 'av_c',
    profileUpdatedAt: '2025',
    rank: 3,
    profitBB: 10,
    games: 1,
    wins: 0,
    winRate: 0
  },
  {
    openid: 'd',
    nickname: 'Dan',
    avatar: 'av_d',
    profileUpdatedAt: '2025',
    rank: 0,
    profitBB: 0,
    games: 0,
    wins: 0,
    winRate: 0
  }
]

const honors = pickHonors(rankings)
assert.strictEqual(honors.length, 3, '有效参与者恰好3位应取3')
assert.deepStrictEqual(
  Object.keys(honors[0]).sort(),
  ['avatar', 'nickname', 'openid', 'profileUpdatedAt', 'rank'].sort()
)
assert.strictEqual(honors[0].openid, 'a')
assert.strictEqual(honors[0].profitBB, undefined, '不得暴露 profitBB')
assert.strictEqual(honors[0].games, undefined, '不得暴露 games')

// === 成员脱敏 ===
const profiles = [
  {
    openid: 'a',
    nickname: 'Alice',
    avatar: 'av_a',
    profileUpdatedAt: '2025',
    rank: 1,
    profitBB: 100
  }
]
const members = sanitizeMembers(['a', 'b'], profiles)
assert.strictEqual(members.length, 2)
assert.strictEqual(members[0].rank, undefined, '不得暴露 rank')
assert.strictEqual(members[0].profitBB, undefined, '不得暴露 profitBB')

// === owner 异常处理短视图不含 name/players/结果 ===
const summaries = [
  {
    _id: 'g1',
    name: '友谊赛',
    playerCount: 5,
    startedAt: '2025-07-01T20:00:00Z',
    endedAt: '2025-07-01T23:00:00Z',
    excluded: false
  }
]
const ownerView = buildOwnerReview(summaries, new Set())
assert.strictEqual(ownerView[0].name, undefined, 'owner 不得看到牌局名称')
assert.ok(ownerView[0].shortId, '应有短记录号')
assert.ok(typeof ownerView[0].durationMin === 'number')
assert.ok(typeof ownerView[0].compliant === 'boolean')

// === buildSeasonView 非成员返回拒绝 ===
const result = buildSeasonView({
  season: { rankings: [], gameSummaries: [], excludedGameIds: [] },
  circle: { memberOpenids: ['a', 'b'], ownerOpenid: 'a' },
  memberProfiles: [],
  myGames: [],
  viewerOpenid: 'z'
})
assert.strictEqual(result.isMember, false)
assert.strictEqual(result.me, null)
assert.deepStrictEqual(result.myGames, [])
assert.strictEqual(result.ownerReview, null)

console.log('season-view.test.js passed')
