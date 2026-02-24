# =============================================================================
# マルチステージビルド構成
#
# ステージ1 (builder): Node.js 環境で npm install + ビルド
# ステージ2 (本番):     nginx で静的ファイルを配信
#
# マルチステージビルドの利点:
#   - ビルド時の依存（node_modules等）が本番イメージに含まれない
#   - 本番イメージサイズの大幅削減（Node.js ~1GB → nginx Alpine ~30MB）
#   - セキュリティ面でも攻撃対象面が減少する
# =============================================================================

# ---- ビルドステージ ----
# Node.js Alpine イメージをベースに、アプリケーションをビルドする
FROM node:22-alpine AS builder
WORKDIR /app

# package*.json を先にコピーして依存解決（Docker レイヤーキャッシュの活用）
# ソースコード変更時に npm ci の再実行を回避できる
COPY package*.json ./

# npm ci は package-lock.json に基づいて厳密に依存を解決する（CI/CD 向け）。
# npm install と異なり、package-lock.json と package.json の不整合時にエラーになる。
# また node_modules を削除してからクリーンインストールするため再現性が高い。
RUN npm ci

COPY . .
# Vite のプロダクションビルド。dist/ ディレクトリに静的ファイルを生成する
RUN npm run build

# ---- 本番ステージ ----
# nginx Alpine で静的ファイルを配信（軽量イメージ）
FROM nginx:alpine
# ビルド成果物のみをビルドステージからコピー
COPY --from=builder /app/dist /usr/share/nginx/html
# カスタム nginx 設定（SPA ルーティング、キャッシュ、gzip 等）
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
