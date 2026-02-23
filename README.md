# RS-232C シリアルモニタ

Web Serial API を使ったブラウザベースの RS-232C シリアル通信モニタです。

## 機能

- **接続設定** — ボーレート、データビット、ストップビット、パリティ、フロー制御を指定して接続
- **リアルタイム受信** — TEXT / HEX 表示を切り替えてデータを確認
- **データ送信** — 接続中のシリアルポートへテキストデータを送信
- **接続状態表示** — ポート情報・エラーをリアルタイムで表示

## 技術スタック

- React 19 / TypeScript / Vite

## 必要環境

- Node.js 22 以上
- Web Serial API 対応ブラウザ（Chrome / Edge）
  - HTTPS または localhost でのアクセスが必要

## セットアップ

```bash
npm install
npm run dev
```

DevContainer にも対応しているため、VS Code の **Dev Containers** 拡張機能でそのまま開発環境を起動できます。

## npm スクリプト

| コマンド          | 説明                       |
| ----------------- | -------------------------- |
| `npm run dev`     | 開発サーバーを起動         |
| `npm run build`   | TypeScript 型チェック＋ビルド |
| `npm run lint`    | ESLint による静的解析      |
| `npm run preview` | ビルド成果物をプレビュー   |

## プロジェクト構成

```
src/
├── App.tsx                       # アプリケーションルート
├── main.tsx                      # エントリポイント
├── hooks/
│   └── useSerial.ts              # Web Serial API ラッパー
└── components/
    ├── SerialConfig.tsx           # 接続設定パネル
    ├── SerialMonitor.tsx          # 受信データ表示・送信
    └── ConnectionStatus.tsx       # 接続状態インジケータ
```
