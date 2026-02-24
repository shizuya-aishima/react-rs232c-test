/**
 * ConnectionStatus - シリアルポートの接続状態を表示するヘッダーコンポーネント
 *
 * 3段階の接続状態を視覚的に表示する:
 *   - connected (緑): ポートがオープンされ、データの送受信が可能な状態。
 *     readLoop がバックグラウンドで動作しており、受信データがあれば即座に表示される。
 *   - connecting (黄): 初回マウント時の自動接続処理中（ペアリング済みポートへの再接続）。
 *     getPorts() → port.open() → readLoop 起動の一連の処理が進行中。
 *   - disconnected (赤): ポートが未接続またはクローズ済みの状態。
 *     readLoop は停止しており、データの送受信はできない。
 *
 * USB-シリアル変換器を使用している場合は、デバイスの Vendor ID / Product ID も表示する。
 * これにより接続先デバイスの種類を識別できる。
 *
 * 通信トラブルシューティング時のチェックポイント:
 *   - "接続中" 表示なのにデータが受信できない → ボーレート/パラメータ不一致の可能性
 *   - "切断中" に勝手に変わる → USB ケーブルの接触不良やデバイスの電源断
 *   - エラーメッセージ表示 → 具体的なエラー内容を確認（接続エラー、読み取りエラー等）
 */
interface ConnectionStatusProps {
  isConnected: boolean;
  /** 初回マウント時の自動接続中フラグ。通常の手動接続では false のまま */
  isAutoConnecting: boolean;
  /**
   * 接続中ポートの情報。Web Serial API の SerialPortInfo 型。
   * USB デバイスの場合は usbVendorId / usbProductId を含む。
   * PC内蔵のシリアルポートやBluetooth SPP 経由の場合は undefined になる。
   *
   * ポート情報が取得できない場合は、OS のデバイスマネージャー（Windows）や
   * ls /dev/tty*（Linux/Mac）でポートを確認する。
   */
  portInfo: SerialPortInfo | null;
  error: string | null;
}

export function ConnectionStatus({
  isConnected,
  isAutoConnecting,
  portInfo,
  error,
}: ConnectionStatusProps) {
  return (
    <div className="connection-status">
      {/* 接続状態インジケーター: CSS クラスで色（緑/黄/赤）を切り替え */}
      <div className="status-indicator">
        <span className={`status-dot ${isConnected ? "connected" : isAutoConnecting ? "connecting" : "disconnected"}`} />
        <span className="status-text">
          {isAutoConnecting ? "自動接続中..." : isConnected ? "接続中" : "切断中"}
        </span>
      </div>

      {/*
        USB デバイス情報の表示。
        VID (Vendor ID) / PID (Product ID) は USB-IF が管理するデバイス識別子。
        16進数4桁（0x0000〜0xFFFF）で表す。

        VID/PID の確認方法:
          - Windows: デバイスマネージャー → ポート → プロパティ → 詳細 → ハードウェア ID
          - Linux: lsusb コマンド
          - macOS: system_profiler SPUSBDataType

        代表的な VID:
          - 0x0403: FTDI
          - 0x10C4: Silicon Labs
          - 0x067B: Prolific
          - 0x1A86: QinHeng (CH340/CH341)
          - 0x2341: Arduino
      */}
      {portInfo && (
        <div className="port-info">
          {portInfo.usbVendorId !== undefined && (
            <span>Vendor ID: 0x{portInfo.usbVendorId.toString(16).toUpperCase().padStart(4, "0")}</span>
          )}
          {portInfo.usbProductId !== undefined && (
            <span>Product ID: 0x{portInfo.usbProductId.toString(16).toUpperCase().padStart(4, "0")}</span>
          )}
        </div>
      )}

      {/* エラーメッセージ: 直近の操作で発生したエラーを表示。次の正常操作でクリアされる */}
      {error && <div className="error-message">{error}</div>}
    </div>
  );
}
