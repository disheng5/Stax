# 云资源与兼容边界

核对日期：2026-09-13；依据本地分支 `codex/friends-ledger-polish`，开发基线 `5e0b4ea`。本文不证明生产规则、索引和部署版本已与仓库一致。

本次已对七个相关现网函数下载源码并比较，结果及五个待更新函数见 [0.3.4 发布记录](RELEASE_0.3.4.md)。这不等于已核验所有集合权限、索引或触发器。

## 环境

`miniprogram/app.js` 当前配置：

```js
const ENV_ID = 'cloud1-d7gykoaktfc01fbf0'
```

这是共享生产环境，不是测试环境。普通本地开发、真机预览都可能读写真实数据；云函数部署立即影响所有线上客户端。任何部署、初始化、重算和权限变更都需单独确认范围。

导入包含 `project.config.json` 的仓库根目录，确认 AppID 与环境归属。只有 `ENV_ID` 为 `STAX_REPLACE_ME_BEFORE_DEPLOY` 才启用内存 Mock，详见 [演示说明](DEMO.md)。

## 集合与职责

当前代码使用八个集合。已有环境先核对，不重复初始化或清空。

| 集合 | 用途 | 写入责任 |
| --- | --- | --- |
| `users` | 身份、昵称头像、派生统计、统计计算令牌 | 用户及结算相关云函数 |
| `games` | 房间配置、成员、座位、结算、版本与待补算标记 | 创建、加入、记账、结算等云函数 |
| `transactions` | 买入、结算、费用、修正及撤销元数据 | 记账与结算云函数 |
| `circles` | 积分榜、成员和当前赛季 | 积分榜管理云函数 |
| `seasons` | 赛季结果、比赛摘要、计算版本 | 赛季计算与管理云函数 |
| `opReceipts` | 持久化操作回执 | 创建、记账与结算云函数 |
| `terms` | 术语种子内容 | `seedTerms` |
| `handRanks` | 起手参考种子内容 | `seedTerms` |

## 数据权限：不要照抄旧规则

**当前仓库没有一份经过生产核验、可直接套用的完整安全规则。** 旧文档曾把“登录用户可读整个集合”列为推荐设置；那只能解释历史兼容需求，不能作为隐私保证或本次变更指令。

- 业务写入走云函数鉴权，不开放前端直接写入。
- `opReceipts` 仅云函数读写，前端不可读写。
- 详情仍直接读取 `games/transactions`；部分积分榜页面仍有集合直读依赖。
- 当前积分榜详情通过 `getSeasonView` 获取裁剪视图，且校验赛季所属积分榜；这不能替代底层规则。
- 详情与积分榜有成员资料订阅需求。若现有 `users` 规则只允许本人读取，这些订阅可能受限；不能直接开放整份用户文档来换取同步。
- 不能一刀切收紧集合读权限，否则可能打断源码未完整留存的已发布客户端；也不能为排障盲目扩大权限。

权限迁移应先盘点实际部署规则、旧客户端请求和公开资料字段，再逐步切换受控读取及最小变更信号。详见 [修复边界](TRUST_SYNC_FIXES_2026-09-13.md#仍需明确的边界)。

## 索引核对

以下是当前代码的查询形状，需结合云控制台查询计划和缺索引提示核实。不是“一张表照填后就已验证”的生产索引清单；不要删除已有索引。

| 集合 | 过滤与排序 | 对应路径 |
| --- | --- | --- |
| `games` | 本人成员、已结束、本人可见；按结束时间分页 | 战绩、个人聚合 |
| `games` | 本人成员；`startedAt` 降序 | 可见页面近期记录订阅 |
| `games` | `status`、`players.openid`；`_id` 升序 | 派生个人统计重算 |
| `games` | `derivedPending`、`derivedRetryAfter` | 失败补算任务 |
| `games` | 已结束与赛季时间窗 | 赛季计分 |
| `games/circles` | `inviteCode` 与状态 | 分享加入及旧调用兼容 |
| `transactions` | `gameId`；`timestamp` 降序、`_id` 降序 | 全部流水稳定分页 |
| `users` | `_openid` | 身份、资料和统计查询 |
| `circles` | 活跃状态、成员；部分查询按 `_id` 分页 | 相关积分榜重算 |
| `seasons` | `circleId`、赛季状态与时间 | 赛季读取和结账 |
| `opReceipts` | `_id` | 操作回执查询 |

数组字段和多条件查询能否使用某个组合索引，以实际云环境验证为准。

## 云函数目录

当前共 22 个，不代表本次要重新部署全部函数。

| 职责 | 函数 |
| --- | --- |
| 用户与资料 | `whoami`、`getAvatars` |
| 积分记录 | `createGame`、`joinGame`、`recordTransaction`、`settleGame`、`deleteGameRecord` |
| 积分榜管理 | `createCircle`、`joinCircle`、`leaveCircle`、`dissolveCircle`、`removeCircleMember` |
| 赛季计算 | `calcSeasonScore`、`settleSeason`、`resetSeason`、`excludeGame` |
| 受控读取与聚合 | `getSeasonView`、`getMyAnalytics`、`getGameView` |
| 内容与兼容能力 | `seedTerms`、`aiReview`、`termAi` |

`getGameView` 已存在，但详情页尚未全部迁移到该入口。趋势解读当前本地同步生成；`getMyAnalytics` 保留云端镜像与旧返回字段。

`aiReview/termAi` 默认使用规则模板；混元和 CloudBase AI 分支仍是抛错后回退的占位实现，设置环境变量不会自动完成大模型接入。

## 本轮部署依赖

只有确认要部署后才执行；常规流程见 [部署指南](DEPLOY.md)。

1. 运行 `npm run check`、`npm run lint`、`git diff --check`。
2. 对照各函数实际“上次部署的 commit”检查差异；不能把本轮开发基线当作已知生产基线。
3. 相对开发基线 `5e0b4ea`，本轮先部署 `calcSeasonScore`，再部署 `recordTransaction`、`createGame`、`getSeasonView`、`deleteGameRecord`。这是代码增量，不证明其他函数已经在生产完成部署。
4. 上传完整函数目录并云端安装依赖。若前一轮尚未部署，另行核对全部增量；`settleGame` 不可漏 `derived-stats.js/config.json`，`getMyAnalytics` 不可漏 `analytics.js/stats.js/trend-note.js`。
5. 验证旧前端费用、加入、结算和修正，再上传新前端。保留旧字段和按载荷形状兼容 mode 的逻辑。

本轮不新增集合或触发器。`createGame` 的可选操作号复用已有 `opReceipts`，需要该集合可供云函数读写。回执使用 `_id` 查找，与房间及首条流水同事务提交；不得捕获回执读写异常后继续创建。赛季计算版本升为 6，但部署不会自动扫描并重算全部历史赛季。细节见 [本轮交接](FRIENDS_LEDGER_POLISH_2026-09-13.md)。

## 定时器与补算

| 函数 | 仓库配置 | 启用后职责 |
| --- | --- | --- |
| `settleGame` | `retryDerivedStats`，每分钟 | 每轮最多处理一场到期的待补算记录 |
| `settleSeason` | `settleExpiredSeasons`，cron 为 `0 0 4 * * * *` | 检查到期赛季并结账 |

必须在控制台核实触发器是否启用、时区、超时和执行日志，不能根据文件存在就认定定时任务已运行。

结算事务登记 `derivedPending/derivedVersion/derivedRetryAfter`。新前端先接收已确认结果，再调用 `syncDerived`；失败标记保留，供重试和定时器接续。此机制修复派生统计，不猜测或改写玩家填错的剩余积分，也不自动扫描所有历史数据。

## 种子数据

`seedTerms` 默认 `reset: true`：会清空所选内容集合后重建。**不要作为每次发版或排障的固定步骤。**

仅对空环境初始化或经明确确认的内容重建执行，先备份现有内容。例如分开调用：

```json
{ "reset": true, "only": "terms" }
```

```json
{ "reset": true, "only": "handRanks" }
```

种子数量以 `cloudfunctions/seedTerms/seed/` 中 JSON 数组为准。`reset: false` 是追加，不保证防重复。不得对业务集合用类似方式“初始化”。

## 排障顺序

- 环境错误：核对实际 AppID、环境 ID 与登录权限，不反复改配置试错。
- 函数不存在：核对函数名称、实际部署目录和依赖；仅部署已确认范围。
- 同步异常：查网络、watch 错误、权限和索引，验证断线恢复；不要简单改成全员可读。
- 新用户加入失败：检查原地资料弹框、`whoami` 和 `joinGame` 的实际云端版本。
- 流水不完整：核对分页失败日志、完整快照版本和复合排序；不要降低为只显示最近二十条。
- 结算后榜单未更新：检查待补算标记、函数超时、赛季计算和定时触发器；不要重复提交一笔新结算来“催更新”。
