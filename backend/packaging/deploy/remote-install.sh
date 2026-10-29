#!/bin/bash
# 在服务器上安装 / 升级服务端（由 .github/workflows/deploy-server.yml 上传后执行，需 root）。
# 用法：bash remote-install.sh <bundle.tgz> [secrets.env]
#   secrets.env（可选，执行后删除）：ADMIN_EMAIL / ADMIN_PASSWORD（创建管理员）、PUBLIC_URL（首次生成配置用）
#
# 目录：
#   /opt/aigcpanel-server/releases/<版本>-<时间>   每次部署一份，保留最近 5 份
#   /opt/aigcpanel-server/current                  指向当前版本的软链接
#   /opt/aigcpanel-server/data                     数据库与生成文件（升级不动）
#   /opt/aigcpanel-server/data/backups             每次升级前的数据库备份，保留最近 10 份
#   /opt/aigcpanel-server/server.env               运行配置（首次生成，之后不覆盖，可手动修改）
set -euo pipefail

BUNDLE="$1"
SECRETS="${2:-}"
APP=/opt/aigcpanel-server
SERVICE=aigcpanel-server
PORT_DEFAULT=3100

ADMIN_EMAIL=""
ADMIN_PASSWORD=""
PUBLIC_URL=""
if [ -n "$SECRETS" ] && [ -f "$SECRETS" ]; then
    # shellcheck disable=SC1090
    source "$SECRETS"
    rm -f "$SECRETS"
fi

mkdir -p "$APP/releases" "$APP/data/files" "$APP/data/backups"

# 1. 解包到新的版本目录
STAGE=$(mktemp -d)
tar -xzf "$BUNDLE" -C "$STAGE"
rm -f "$BUNDLE"
VERSION=$(cat "$STAGE"/aigcpanel-server-linux-x64/server/VERSION 2>/dev/null || echo unknown)
REL="$APP/releases/${VERSION}-$(date +%Y%m%d%H%M%S)"
mv "$STAGE/aigcpanel-server-linux-x64" "$REL"
rm -rf "$STAGE"
echo "新版本：$VERSION → $REL"

# 2. 运行配置：只在首次生成。线上默认关闭模拟支付（否则任何人都能免费充值）
if [ ! -f "$APP/server.env" ]; then
    if [ -z "$PUBLIC_URL" ]; then
        PUBLIC_URL="http://$(curl -fsS -m 5 http://100.100.100.200/latest/meta-data/eipv4 2>/dev/null || hostname -I | awk '{print $1}'):$PORT_DEFAULT"
    fi
    cat > "$APP/server.env" <<EOF
PORT=$PORT_DEFAULT
HOST=0.0.0.0
DB_FILE=$APP/data/app.db
FILES_DIR=$APP/data/files
ADMIN_DIR=$APP/current/admin/dist
BASE_URL=$PUBLIC_URL
PAYMENT_MOCK=0
MOCK_PROVIDER=1
REQUIRE_EMAIL_CODE=0
EOF
    chmod 600 "$APP/server.env"
    echo "已生成 $APP/server.env（对外地址 $PUBLIC_URL）"
fi

# 3. systemd 服务
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=AigcPanel 电商版服务端
After=network.target

[Service]
Type=simple
EnvironmentFile=$APP/server.env
WorkingDirectory=$APP/current/server
ExecStart=$APP/current/node/bin/node --no-warnings server.mjs
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable $SERVICE >/dev/null 2>&1 || true

# 4. 停服务 → 备份数据库 → 切换版本
PREV=$(readlink "$APP/current" 2>/dev/null || true)
systemctl stop $SERVICE 2>/dev/null || true
if [ -f "$APP/data/app.db" ]; then
    B="$APP/data/backups/app-$(date +%Y%m%d%H%M%S)"
    for f in app.db app.db-wal app.db-shm; do
        [ -f "$APP/data/$f" ] && cp -p "$APP/data/$f" "$B.${f#app.}"
    done
    echo "数据库已备份：$B.db"
    ls -1t "$APP"/data/backups/app-*.db 2>/dev/null | tail -n +11 | while read -r old; do
        rm -f "$old" "${old%.db}.db-wal" "${old%.db}.db-shm"
    done
fi
ln -sfn "$REL" "$APP/current"

# 5. 管理员（可选，已存在只提升权限、不改密码）
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
    (cd "$APP/current/server" && DB_FILE="$APP/data/app.db" ../node/bin/node --no-warnings create-admin.mjs "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
fi

# 6. 启动并检查；失败回滚到上一个版本
systemctl start $SERVICE
PORT=$(grep -E '^PORT=' "$APP/server.env" | cut -d= -f2)
PORT=${PORT:-$PORT_DEFAULT}
for i in $(seq 1 30); do
    if curl -fsS -m 2 "http://127.0.0.1:$PORT/api/version" 2>/dev/null | grep -q "\"$VERSION\""; then
        echo "部署成功：版本 $VERSION 已在端口 $PORT 运行"
        ls -1dt "$APP"/releases/*/ | tail -n +6 | xargs -r rm -rf
        exit 0
    fi
    sleep 1
done
echo "新版本启动失败，最近日志："
journalctl -u $SERVICE -n 40 --no-pager || true
if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    echo "回滚到 $PREV"
    ln -sfn "$PREV" "$APP/current"
    systemctl restart $SERVICE
fi
exit 1
