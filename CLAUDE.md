# StaxKit

开工前必读 [AGENTS.md](AGENTS.md) —— 云函数契约红线与多 Agent 协作规则(来自真实线上事故)。

核心一句话:本地直连生产云环境,云函数部署即全网生效;**只加不删、不按枚举名拒绝、不收紧老校验**,改云函数必同步 cloud-mock 并 `npm run check` 全绿后再部署,先函数后前端。

维护日期：2026-09-13。

- 优先级：数据准确 > 体验 > 性能；完整缓存一次呈现、全部流水、静默校准不能退化。
- 当前功能和开发状态以 [README](README.md) 为入口，不把本地完成写成已上线。
- 云资源与旧客户端权限边界见 [CLOUD_SETUP](docs/CLOUD_SETUP.md)；发布按 [RELEASE_CHECKLIST](docs/RELEASE_CHECKLIST.md) 验收。
- 当前版本标识仍需发布前核对，定时器文件存在不代表线上已启用。未经单独确认，不部署、不初始化或改写生产数据。
- 本轮位置维度与三十条趋势技巧详见 [实现说明](docs/ANALYTICS_POSITION_TRENDS.md)，统计纯函数的前后端镜像需同步维护。
