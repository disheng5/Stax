// utils/constants.js — 全局常量
module.exports = {
  COLLECTIONS: {
    USERS: 'users',
    GAMES: 'games',
    TRANSACTIONS: 'transactions',
    TERMS: 'terms',
    HAND_RANKS: 'handRanks'
  },
  GAME_STATUS: {
    ONGOING: 'ongoing',
    ENDED: 'ended'
  },
  TX_TYPE: {
    BUY_IN: 'buyIn',
    REBUY: 'rebuy',
    ADD_ON: 'addOn',
    ELIMINATE: 'eliminate',
    SETTLE: 'settle'
  },
  BLIND_PRESETS: {
    fast:     { sb: 5,  bb: 10, label: '快速局 5/10' },
    standard: { sb: 10, bb: 20, label: '标准局 10/20' }
  },
  TERM_CATEGORIES: ['rule', 'action', 'position', 'hand', 'concept'],
  HAND_TIERS: ['premium', 'strong', 'playable', 'marginal', 'trash']
}
