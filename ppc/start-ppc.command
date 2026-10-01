#!/bin/sh
# PPC 프로토타입 실행 파일 (macOS/Linux). macOS에서는 더블클릭, 그 밖에는 `sh start-ppc.command`.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS(22 이상)를 설치한 뒤 다시 실행하세요."
  exit 1
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "설치된 Node.js 버전이 낮습니다 ($(node -v)). 22 이상으로 업데이트한 뒤 다시 실행하세요."
  exit 1
fi

if [ ! -x node_modules/.bin/vite ]; then
  echo "[1/2] 처음 실행이라 필요한 패키지를 설치합니다. 1~2분 걸립니다..."
  npm install --no-audit --no-fund || { echo "패키지 설치에 실패했습니다. 인터넷 연결을 확인하세요."; exit 1; }
fi

echo "[2/2] PPC를 시작합니다. 잠시 뒤 브라우저가 자동으로 열립니다. (끝내려면 Ctrl+C)"
exec npm run dev -- --open
