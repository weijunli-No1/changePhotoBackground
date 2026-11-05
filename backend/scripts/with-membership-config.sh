#!/bin/sh
# 只传递配置文件位置，密钥由 Spring 从私有文件读取。
set -eu

task_backend_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
task_member_config="$task_backend_dir/.secrets/application-membership.properties"

if [ "$#" -eq 0 ]; then
  echo '用法：backend/scripts/with-membership-config.sh <后端启动命令> [参数...]' >&2
  exit 2
fi
if [ ! -r "$task_member_config" ]; then
  echo '缺少可读取的本机会员支付配置。' >&2
  exit 1
fi

if [ -n "${SPRING_CONFIG_ADDITIONAL_LOCATION:-}" ]; then
  SPRING_CONFIG_ADDITIONAL_LOCATION="$SPRING_CONFIG_ADDITIONAL_LOCATION,file:$task_member_config"
else
  SPRING_CONFIG_ADDITIONAL_LOCATION="file:$task_member_config"
fi
export SPRING_CONFIG_ADDITIONAL_LOCATION
exec "$@"
