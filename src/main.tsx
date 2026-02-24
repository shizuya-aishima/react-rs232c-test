/**
 * アプリケーションのエントリーポイント。
 *
 * Vite が index.html の <script type="module" src="/src/main.tsx"> から
 * このファイルをロードし、React アプリケーションを初期化する。
 *
 * StrictMode について:
 *   開発環境でのみ有効になる React の検証モード。以下の動作を行う:
 *   - コンポーネントを2回レンダリングし、副作用の不整合を検出する
 *   - useEffect を2回実行し、クリーンアップ関数の正しさを検証する
 *   - 非推奨APIの使用を警告する
 *
 *   useSerial フックでは StrictMode の二重実行に対応するため、
 *   useEffect 内で cancelled フラグを使用している（useSerial.ts 参照）。
 *
 *   本番ビルドでは StrictMode の追加チェックは全て無効化され、パフォーマンス影響はない。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/**
 * createRoot は React 18+ の Concurrent Mode 対応 API。
 * document.getElementById('root')! の ! は TypeScript の Non-null assertion で、
 * index.html に <div id="root"> が存在することを前提としている。
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
