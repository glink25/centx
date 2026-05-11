## Cent CLI

首先，请先通过项目根目录的README了解整个Cent项目的具体详情

Cent CLI是一个用于将Cent Web，转换为纯npm包形式的项目，它将支持以npx方式进行调用，以实现web app的大部分功能，包括：
1，通过github/gitee/web dav/s3 登录/离线模式
2，查询账单列表
3，获取账单信息的分析数据
4，增删查改/导入账单
5，云同步（tidal）

通过设计一套命令，可以通过npx执行上述操作，并且允许**接入mcp/skill协议**，让AI agent工具直接使用，这也是cent-cli项目的核心
我要求的不是在cli中完全复刻web app的界面，而是需要将核心能力作为cli命令直接运行，类似于bash ls/cat这样的命令，直接执行然后给出结果即可。不应该在cli中照搬web项目交互，cli应该是直观的，直接执行即可得到结果，不应该存在任何modal/confirm之类的交互
例如
```bash
cent-cli login --github ## 登录
cent-cli search -q q:food ## 搜索
cent-cli analyze -q q:food ## 分析
cent-cli add -comment food -amount 100 ## 记录一笔
```

我希望项目中能最大程度复用Cent原有代码，以保证核心逻辑一致，并且能随着Cent本体项目更新，而能够让Cent CLI快速接入新的特性。

为整个cent-cli项目制定构建计划，从最小化验证开始，一步步接入更多其他功能，最终达到上述最终形态