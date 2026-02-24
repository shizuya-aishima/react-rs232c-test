/**
 * Vite ビルド設定。
 *
 * Vite は ESModules ベースの高速フロントエンドビルドツール。
 * 開発時は ESM ネイティブの HMR（Hot Module Replacement）で高速リロードを実現し、
 * 本番ビルドでは Rollup をベースにバンドルを生成する。
 *
 * @see https://vite.dev/config/
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  /** @vitejs/plugin-react: JSX変換（React Fast Refresh による HMR を有効化） */
  plugins: [react()],
  server: {
    /**
     * host: true により 0.0.0.0 でリッスンし、全ネットワークインターフェースからの接続を許可。
     * Docker コンテナや Dev Container 内で実行する場合、
     * デフォルトの localhost (127.0.0.1) ではホストマシンからアクセスできないため必須。
     */
    host: true,
  },
})
