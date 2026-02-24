/**
 * SerialMonitor - シリアル通信のデータ送受信を行うモニタコンポーネント
 *
 * 機能:
 *   - 受信データのリアルタイム表示（TEXT モードと HEX モードの切替）
 *   - ミリ秒精度のタイムスタンプ付きログ表示
 *   - 新規データ受信時の自動スクロール
 *   - テキストデータの送信入力欄（Enter キーまたはボタンで送信）
 *
 * 表示モード:
 *   - TEXT: エンコーディング変換後の文字列を表示。通常のテキスト通信の確認に使用。
 *   - HEX: 生バイト列を16進数で表示。以下の場面で活用:
 *     - バイナリプロトコルのデバッグ（独自プロトコルのフレーム構造確認）
 *     - 文字化け時のエンコーディング調査（実際のバイト値から正しいエンコーディングを推定）
 *     - 制御文字の確認（CR: 0x0D, LF: 0x0A, ACK: 0x06, NAK: 0x15 等）
 *     - 通信パラメータ不一致時の症状確認（全バイトが不規則ならボーレート不一致）
 *
 * データの単位:
 *   1行 = Web Serial API の reader.read() が返した1チャンク分のデータ。
 *   チャンクの区切りはメッセージ境界と一致しないため、1つのメッセージが複数行に分かれたり、
 *   複数メッセージが1行にまとまることがある（useSerial.ts のコメント参照）。
 *
 * 製品版への移行時の考慮事項:
 *   - 大量データ受信時のパフォーマンス（仮想スクロール / react-window 等の導入）
 *   - ログの検索・フィルタ機能
 *   - ログのファイルエクスポート機能（CSV, テキスト）
 *   - 送信履歴の保持とリプレイ機能
 *   - 改行コード（CR/LF/CRLF）の表示・送信設定
 *   - バイナリ（HEX値）の直接送信モード
 *   - 受信データの行分割（改行文字で区切る）オプション
 */
import { useState, useEffect, useRef } from "react";
import type { ReceivedData } from "../hooks/useSerial";

interface SerialMonitorProps {
  receivedData: ReceivedData[];
  onClear: () => void;
  onSend: (text: string) => void;
  isConnected: boolean;
}

/** TEXT / HEX の表示モード。HEX はバイナリプロトコルのデバッグ時に使用 */
type DisplayMode = "text" | "hex";

/**
 * 受信時刻を日本語ロケールでミリ秒精度までフォーマットする。
 *
 * シリアル通信のデバッグではミリ秒単位のタイミング把握が重要。
 * 主な用途:
 *   - コマンド送信からレスポンス受信までの応答時間の測定
 *   - データの到着間隔からボーレートの推定（期待値との比較）
 *   - 間欠的な通信エラーの時間パターン分析
 *
 * fractionalSecondDigits: 3 で小数点以下3桁（ミリ秒精度）まで表示する。
 * 例: "14:30:25.123"
 *
 * 注意: タイムスタンプは reader.read() の完了時点で記録される。
 * チャンク内の個々のバイトの実際の受信時刻とは異なる場合がある。
 * USB-シリアル変換器の内部バッファリングにより、数ms〜数十msの遅延が生じうる。
 */
function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

/**
 * バイト配列を16進数文字列に変換する（HEXダンプ表示用）。
 * 各バイトを2桁の大文字16進数に変換し、スペース区切りで連結する。
 * 例: [0x48, 0x65, 0x6C, 0x6C, 0x6F] → "48 65 6C 6C 6F"
 *
 * HEXダンプ表示の活用例:
 *   - "48 65 6C 6C 6F 0D 0A" → ASCII で "Hello\r\n" と判読可能
 *   - "82 B1 82 F1 82 C9 82 BF 82 CD" → SJIS で "こんにちは"
 *   - "E3 81 93 E3 82 93 E3 81 AB E3 81 A1 E3 81 AF" → UTF-8 で "こんにちは"
 *   - 通信パラメータ不一致時は規則性のないランダムなバイト値が並ぶ
 *
 * 製品版では、ASCII 対応表示（右端に対応する ASCII 文字を表示）や
 * アドレス付き表示（xxd コマンド風）を追加するとデバッグ効率が向上する。
 */
function toHexString(data: Uint8Array): string {
  return Array.from(data)
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ");
}

export function SerialMonitor({
  receivedData,
  onClear,
  onSend,
  isConnected,
}: SerialMonitorProps) {
  const [displayMode, setDisplayMode] = useState<DisplayMode>("text");
  const [sendText, setSendText] = useState("");
  /** モニタ出力エリアの DOM 参照。自動スクロールに使用 */
  const monitorRef = useRef<HTMLDivElement>(null);

  /**
   * 新しいデータが追加されるたびに、モニタ出力エリアを最下部にスクロール。
   * scrollTop を scrollHeight に設定することで、
   * ターミナルのように常に最新のデータが見える状態を維持する。
   *
   * receivedData が依存配列に入っているため、新しいチャンクの受信ごとに実行される。
   * 大量データ受信時にレンダリング負荷が高くなる可能性があるため、
   * 製品版ではスクロール位置をユーザーが固定できるオプション
   * （自動スクロールのオン/オフ）を設けるとよい。
   */
  useEffect(() => {
    if (monitorRef.current) {
      monitorRef.current.scrollTop = monitorRef.current.scrollHeight;
    }
  }, [receivedData]);

  /**
   * テキストの送信処理。
   * 入力欄の内容を useSerial の sendData() に渡し、送信後に入力欄をクリアする。
   * trim() で前後の空白を除去し、空文字列の送信を防止する。
   *
   * 注意: 現在の実装では改行コードの自動付与はしていない。
   * 機器によっては "\r\n" や "\r" を末尾に期待するため、
   * 必要に応じてユーザーが入力に含める必要がある。
   */
  const handleSend = () => {
    if (sendText.trim()) {
      onSend(sendText);
      setSendText("");
    }
  };

  /** Enter キーで送信（シリアルターミナルの標準的な UX） */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSend();
    }
  };

  return (
    <div className="serial-monitor">
      <div className="monitor-header">
        <h2>シリアルモニタ</h2>
        <div className="monitor-controls">
          {/*
            TEXT/HEX モード切替ボタン。
            ReceivedData は text（変換済み文字列）と raw（生バイト列）の両方を保持しているため、
            モード切替時にデータの再取得や再変換は不要。即座に表示を切り替えられる。

            デバッグ手順の例:
              1. TEXT モードで通信内容を確認
              2. 文字化けが見えたら HEX モードに切り替え
              3. バイトパターンからエンコーディングを推定
              4. SerialConfig でエンコーディングを変更
              5. TEXT モードに戻して正しく表示されるか確認
          */}
          <div className="mode-toggle">
            <button
              className={displayMode === "text" ? "active" : ""}
              onClick={() => setDisplayMode("text")}
            >
              TEXT
            </button>
            <button
              className={displayMode === "hex" ? "active" : ""}
              onClick={() => setDisplayMode("hex")}
            >
              HEX
            </button>
          </div>
          <button className="clear-btn" onClick={onClear}>
            クリア
          </button>
        </div>
      </div>

      {/* 受信データ表示エリア。overflow: auto でスクロール可能 */}
      <div className="monitor-output" ref={monitorRef}>
        {receivedData.length === 0 ? (
          <div className="placeholder">
            受信データがありません。シリアルポートに接続してください。
          </div>
        ) : (
          receivedData.map((data, index) => (
            <div key={index} className="data-line">
              <span className="timestamp">
                [{formatTimestamp(data.timestamp)}]
              </span>{" "}
              <span className="data-content">
                {displayMode === "text" ? data.text : toHexString(data.raw)}
              </span>
            </div>
          ))
        )}
      </div>

      {/*
        送信エリア。接続中のみ入力・送信可能。
        テキスト入力 + 送信ボタンのシンプルな構成。
        Enter キーでも送信可能（handleKeyDown）。
      */}
      <div className="send-area">
        <input
          type="text"
          value={sendText}
          onChange={(e) => setSendText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="送信データを入力..."
          disabled={!isConnected}
        />
        <button onClick={handleSend} disabled={!isConnected || !sendText.trim()}>
          送信
        </button>
      </div>
    </div>
  );
}
