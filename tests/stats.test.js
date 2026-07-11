const assert = require('assert')
const { sortDimensionRows } = require('../miniprogram/utils/stats.js')

assert.deepStrictEqual(
  sortDimensionRows([{ key: '10 人' }, { key: '3 人' }, { key: '6 人' }], 'players').map(
    item => item.key
  ),
  ['3 人', '6 人', '10 人']
)

assert.deepStrictEqual(
  sortDimensionRows([{ key: '3+ 次' }, { key: '1 次' }, { key: '2 次' }], 'rebuys').map(
    item => item.key
  ),
  ['1 次', '2 次', '3+ 次']
)

assert.deepStrictEqual(
  sortDimensionRows([{ key: '周日' }, { key: '周三' }, { key: '周一' }], 'weekday').map(
    item => item.key
  ),
  ['周一', '周三', '周日']
)

assert.deepStrictEqual(
  sortDimensionRows(
    [
      { key: '对手甲', games: 2 },
      { key: '对手乙', games: 5 },
      { key: '对手丙', games: 1 }
    ],
    'opponents'
  ).map(item => item.games),
  [5, 2, 1]
)

console.log('stats.test.js passed')
