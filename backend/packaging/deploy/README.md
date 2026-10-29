# 服务端自动部署（已停用）

> 目前改用本地包试用，GitHub 自动部署流程（deploy-server.yml）已删除。以后需要上云时，
> 从 git 历史恢复该文件即可；`remote-install.sh` 保留，也可以手动上传后执行。

推送 `backend/`、`admin/` 的改动后，GitHub Actions（`.github/workflows/deploy-server.yml`）会：
跑后端测试 → 打包 linux-x64 服务端 → 通过 SSH 上传 → 在服务器上执行 `remote-install.sh`。
也可以在 Actions 页面手动运行「Deploy Server」。

## 一次性准备

1. 仓库 Settings → Secrets and variables → Actions → **Secrets**：

   | 名称 | 内容 |
   |---|---|
   | `SERVER_HOST` | 服务器公网 IP |
   | `SERVER_PASSWORD` | root 密码（或用 `SERVER_SSH_KEY` 放私钥，推荐） |
   | `SERVER_HOST_FINGERPRINT` | 主机指纹，如 `SHA256:xxxx`（防止连到假冒的服务器） |
   | `ADMIN_EMAIL` / `ADMIN_PASSWORD` | 管理后台账号（每次部署确保存在；已存在不会改密码） |

   配置了 `SERVER_HOST` 后，桌面端安装包也会自动改为连接 `http://SERVER_HOST:3100`；
   以后有域名 / HTTPS 时，在 **Variables** 里加 `SERVER_URL`（如 `https://api.example.com`）覆盖。

2. 云服务器安全组放行入方向 **TCP 3100**。

## 服务器上的布局

- 服务：`systemctl status|restart aigcpanel-server`，日志 `journalctl -u aigcpanel-server -f`
- 配置：`/opt/aigcpanel-server/server.env`（首次部署生成，之后不再覆盖；改完 `systemctl restart aigcpanel-server`）
  - 线上默认 `PAYMENT_MOCK=0`（关闭模拟支付，否则任何人都能免费充值），充值请用后台兑换码或调额
  - 没配发信邮箱前 `REQUIRE_EMAIL_CODE=0`，注册不需要邮箱验证码
- 数据：`/opt/aigcpanel-server/data`（数据库与生成文件，升级不动）
- 备份：每次升级前自动备份数据库到 `data/backups`，保留最近 10 份
- 版本：`releases/` 保留最近 5 个版本，`current` 指向当前版本；新版本启动失败会自动回滚

## 手动回滚到某个版本

```bash
ln -sfn /opt/aigcpanel-server/releases/<版本目录> /opt/aigcpanel-server/current
systemctl restart aigcpanel-server
```
