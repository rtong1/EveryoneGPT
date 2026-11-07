#!/bin/zsh
# 双击运行；关闭终端窗口即停止本机服务。
set -u
cd -- "${0:a:h}" || exit 1
node_path="$(command -v node || true)"
if [[ -z "$node_path" ]]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node \
    "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"; do
    if [[ -x "$candidate" ]]; then node_path="$candidate"; break; fi
  done
fi
if [[ -z "$node_path" ]] || ! "$node_path" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)'; then
  print '请先安装 Node.js 22.12 或更新版本，再双击启动知伴。'
  read -r '?按回车关闭。'
  exit 1
fi
export HOST=127.0.0.1 PORT=8787
args=()
[[ -f .env ]] && args+=(--env-file=.env)
"$node_path" "${args[@]}" server.mjs &
app_pid=$!
trap 'kill "$app_pid" 2>/dev/null; wait "$app_pid" 2>/dev/null' EXIT
trap 'exit 0' INT TERM
for attempt in {1..60}; do
  sleep 0.15
  if ! kill -0 "$app_pid" 2>/dev/null; then
    print '启动失败。请查看上方提示；如果端口已占用，可以关闭已有服务后再试。'
    read -r '?按回车关闭。'
    exit 1
  fi
  if /usr/bin/curl --noproxy '*' --silent --fail --max-time 1 -o /dev/null http://127.0.0.1:8787/api/config; then
    /usr/bin/open 'http://127.0.0.1:8787/'
    print '知伴已打开。保留这个窗口即可继续使用；按 Control-C 可结束。'
    wait "$app_pid"
    exit $?
  fi
done
print '服务启动时间较长。请查看上方提示。'
exit 1
