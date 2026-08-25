# Security Policy

## Supported scope

当前仓库是本地单用户 MVP，仅支持在可信设备上通过 `127.0.0.1` 运行。它不包含账号、权限隔离或面向公网部署所需的安全控制。

## Reporting a vulnerability

请不要在公开 Issue 中提交 API key、真实简历、岗位 JD、数据库文件或可复现的敏感数据。

如发现安全问题，请通过 GitHub 仓库的 **Security → Report a vulnerability** 私下提交，并说明：

- 受影响的版本或 commit
- 可复现步骤
- 可能暴露的数据或操作范围
- 建议的缓解方式（如有）

在修复发布前，请勿公开漏洞细节。

## Local data guidance

- 不要提交 `.env`、`app.db`、日志或真实候选人截图。
- 只为 DeepSeek key 配置完成当前流程所需的最小权限和额度。
- 使用完演示数据后，可在首页删除对应方案；数据库文件仍应按敏感个人数据处理。
- 不要将 API 或 Web 开发端口转发到公网。
