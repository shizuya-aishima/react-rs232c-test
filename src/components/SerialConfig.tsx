/**
 * SerialConfig - シリアル通信パラメータの設定UIコンポーネント
 *
 * RS-232C 通信に必要な全パラメータ（ボーレート、データビット、ストップビット、
 * パリティ、フロー制御）と文字エンコーディングの設定を提供する。
 * また、ポートの接続/切断、ポート変更、ペアリング済みポートの管理を行う。
 *
 * 通信パラメータは接続前のみ変更可能（接続中は disabled にする）。
 * Web Serial API の port.open() に渡すパラメータは接続後に変更できないため、
 * パラメータを変更するには一度切断→再接続する必要がある。
 *
 * エンコーディングは接続中でも変更可能。
 * エンコーディング設定は useSerial フック内の encodingRef を即座に更新するため、
 * 変更後の受信データからは新しいエンコーディングでデコードされる。
 * 文字化けが発生した場合、エンコーディングを切り替えて正しい設定を見つけることが可能。
 */
import { useState } from "react";
import type { SerialOptions, EncodingType } from "../hooks/useSerial";

interface SerialConfigProps {
  isConnected: boolean;
  pairedPorts: SerialPort[];
  encoding: EncodingType;
  onConnect: (options: SerialOptions) => void;
  onDisconnect: () => void;
  onSelectPort: () => void;
  onForgetPort: (port: SerialPort) => void;
  onEncodingChange: (encoding: EncodingType) => void;
}

/**
 * RS-232C で一般的に使用されるボーレート一覧（単位: bps = bits per second）。
 *
 * ボーレートは1秒間に転送されるビット数を表す。
 * 実効データ速度はフレーム構造のオーバーヘッドにより、ボーレートより低くなる。
 * 例: 9600bps / 10ビット/フレーム（8N1の場合）= 960 バイト/秒
 *
 * 各ボーレートの用途:
 *   - 9600:   多くのレガシー機器のデフォルト。低速だがノイズ耐性が高い。
 *             PLC（プログラマブルロジックコントローラ）や計測器で一般的。
 *   - 19200:  9600の2倍速。産業機器で使用されることがある。
 *   - 38400:  中速通信。一部のGPSモジュールやバーコードリーダーで使用。
 *   - 57600:  高速通信。Bluetoothシリアルモジュール（HC-05等）のデフォルト。
 *   - 115200: USB-シリアル変換器やマイコン（Arduino等）で標準的な最大速度。
 *             Arduino Serial Monitor のデフォルト値。
 *
 * ボーレート不一致時の症状:
 *   受信データが完全に文字化けする（ランダムな文字列やバイナリノイズに見える）。
 *   HEXモードで見ても意味のあるパターンが見えない場合はボーレートの不一致を疑う。
 *
 * 製品版では、カスタムボーレート入力（300, 1200, 2400, 4800 等）も検討する。
 * 低速ボーレートは古い機器やモデム、高速値（230400, 460800, 921600）は
 * 一部の USB-シリアル変換器がサポートしている。
 */
const BAUD_RATES = [9600, 19200, 38400, 57600, 115200];

/**
 * データビット長。1フレームあたりのデータビット数。
 *
 * - 7ビット: ASCII テキストのみの通信（ASCII コード 0x00-0x7F）。
 *   古いテレタイプ端末や一部のレガシープロトコルで使用。
 *   最上位ビットがパリティに使われる場合がある。
 *
 * - 8ビット: バイナリデータやマルチバイト文字（Shift-JIS, UTF-8等）を扱う場合の標準。
 *   現代のほとんどの機器は 8ビットを使用する。
 *   SJIS の2バイト文字は 8ビット×2フレーム で1文字を表現する。
 *
 * 不一致時の症状:
 *   7ビット設定で8ビットデータを受信 → 最上位ビットが欠落し、
 *   0x80以上のバイト（日本語文字の一部）が正しく受信できない。
 */
const DATA_BITS = [7, 8] as const;

/**
 * ストップビット数。データフレームの終端を示す High レベルの信号。
 *
 * - 1ストップビット: 標準的な設定。ほとんどの機器で使用される。
 *   スタートビットとストップビットで 2ビットのオーバーヘッド（8N1 の場合 10ビット/フレーム）。
 *
 * - 2ストップビット: 低速ボーレート（300bps等）や長距離通信で使用されることがある。
 *   受信側のクロック同期に余裕を持たせる目的。
 *   3ビットのオーバーヘッドになり、実効速度がわずかに低下する。
 *
 * 不一致時の症状:
 *   フレーミングエラー（Framing Error）が発生する。
 *   送信側が1ストップビットで送信し、受信側が2ストップビットを期待している場合、
 *   2つ目のストップビット位置にデータが来てしまい、フレーム同期が崩れる。
 */
const STOP_BITS = [1, 2] as const;

/**
 * パリティビット。簡易的な誤り検出機構。
 *
 * パリティはデータビットの後、ストップビットの前に1ビット追加される。
 *
 * - none: パリティなし（最も一般的）。パリティビットは送信されない。
 *   現代の通信ではアプリケーション層のチェックサムや CRC で誤り検出を行うため、
 *   パリティは使わないことが多い。
 *
 * - even: 偶数パリティ。データビット中の1の数 + パリティビットの合計が偶数になるよう設定。
 *   例: データ 0b01010001 → 1が3個（奇数）→ パリティビット=1 で合計4個（偶数）。
 *
 * - odd: 奇数パリティ。データビット中の1の数 + パリティビットの合計が奇数になるよう設定。
 *
 * パリティの限界:
 *   - 1ビットエラーは検出可能だが、2ビットエラーは検出できない
 *   - エラーの訂正はできない（どのビットが化けたか分からない）
 *   - ノイズの多い環境では CRC（Cyclic Redundancy Check）等のより強力な方式を使用する
 *
 * 不一致時の症状:
 *   パリティエラーが発生し、データが破損して受信される。
 *   Web Serial API ではパリティエラーは通常アプリケーション層には通知されず、
 *   データの一部が化けるか欠落する形で影響が現れる。
 */
const PARITIES = ["none", "even", "odd"] as const;

/**
 * フロー制御。受信バッファのオーバーフローを防ぐための仕組み。
 *
 * シリアル通信では送信側と受信側の処理速度が異なる場合がある。
 * 受信側のバッファが満杯になるとデータが失われるため、フロー制御で送信を一時停止させる。
 *
 * - none: フロー制御なし。
 *   低速通信（9600bps等）や短いメッセージのやり取りでは通常不要。
 *   大量データを連続送信する場合にデータ欠落のリスクがある。
 *
 * - hardware: RTS/CTS 信号線によるハードウェアフロー制御。
 *   RS-232C の信号線のうち RTS（Request To Send）と CTS（Clear To Send）を使用する。
 *
 *   動作原理:
 *     1. 受信側はデータを受け付けられる状態では RTS を High（アクティブ）に保つ
 *     2. 送信側は CTS（= 相手の RTS）が High であることを確認してからデータを送信
 *     3. 受信バッファが満杯に近づくと、受信側は RTS を Low にする
 *     4. 送信側は CTS が Low になったのを検知し、送信を一時停止
 *     5. 受信側がバッファを処理して余裕ができたら RTS を High に戻す
 *     6. 送信側は CTS の High を検知し、送信を再開
 *
 *   ハードウェアフロー制御を使用するには、接続ケーブルに RTS/CTS 信号線が含まれている必要がある。
 *   3線式ケーブル（TX, RX, GND のみ）では使用できない。
 *
 * ※ ソフトウェアフロー制御（XON/XOFF）:
 *   データ中に制御文字 XON(0x11) / XOFF(0x13) を送り込んで送信を制御する方式。
 *   バイナリデータ中に制御文字と同じ値が含まれると誤動作するため、テキスト通信でのみ使える。
 *   Web Serial API は XON/XOFF を直接サポートしていない。
 */
const FLOW_CONTROLS = ["none", "hardware"] as const;

/**
 * サポートする文字エンコーディング。
 * encoding-japanese ライブラリの EncodingType に対応する値とUIラベルのマッピング。
 *
 * 機器のエンコーディングが不明な場合の調査手順:
 *   1. HEX モードで生バイト列を確認
 *   2. 日本語文字のバイトパターンからエンコーディングを推定
 *      - SJIS: 日本語の第1バイトが 0x82-0x9F or 0xE0-0xEF の範囲
 *      - EUC-JP: 日本語の第1バイトが 0xA1-0xFE の範囲
 *      - UTF-8: マルチバイトの先頭が 0xC0-0xFD の範囲
 *   3. TEXT モードでエンコーディングを切り替えて正しく表示されるか確認
 */
const ENCODINGS: { value: EncodingType; label: string }[] = [
  { value: "SJIS", label: "Shift-JIS (SJIS)" },
  { value: "EUCJP", label: "EUC-JP" },
  { value: "UTF8", label: "UTF-8" },
];

/**
 * シリアルポートの表示用ラベルを生成。
 *
 * USB-シリアル変換器を使用している場合は Vendor ID (VID) / Product ID (PID) を
 * 16進数4桁で表示する。これにより複数ポート接続時にデバイスを識別できる。
 *
 * VID/PID は USB-IF（USB Implementers Forum）が管理する識別子で、
 * デバイスメーカーとデバイス種別を一意に特定する。
 *
 * 代表的な USB-シリアル変換器チップの VID:
 *   - FTDI FT232R: VID=0x0403, PID=0x6001
 *   - Silicon Labs CP210x: VID=0x10C4, PID=0xEA60
 *   - Prolific PL2303: VID=0x067B, PID=0x2303
 *   - CH340/CH341: VID=0x1A86, PID=0x7523
 *   - Arduino Uno/Mega: VID=0x2341
 *
 * PC 内蔵のシリアルポート（COM1 等）やBluetooth SPP では
 * VID/PID が取得できない（getInfo() の値が undefined になる）。
 * その場合は "ポート N" という連番ラベルを表示する。
 */
function formatPortLabel(port: SerialPort, index: number): string {
  const info = port.getInfo();
  if (info.usbVendorId !== undefined && info.usbProductId !== undefined) {
    const vid = info.usbVendorId.toString(16).toUpperCase().padStart(4, "0");
    const pid = info.usbProductId.toString(16).toUpperCase().padStart(4, "0");
    return `VID: 0x${vid} / PID: 0x${pid}`;
  }
  return `ポート ${index + 1}`;
}

export function SerialConfig({
  isConnected,
  pairedPorts,
  encoding,
  onConnect,
  onDisconnect,
  onSelectPort,
  onForgetPort,
  onEncodingChange,
}: SerialConfigProps) {
  // 各通信パラメータのローカル state。接続ボタン押下時に onConnect へまとめて渡す。
  // デフォルト値は "9600 8N1 フロー制御なし" で、最も一般的な設定。
  const [baudRate, setBaudRate] = useState(9600);
  const [dataBits, setDataBits] = useState<7 | 8>(8);
  const [stopBits, setStopBits] = useState<1 | 2>(1);
  const [parity, setParity] = useState<ParityType>("none");
  const [flowControl, setFlowControl] = useState<FlowControlType>("none");

  /** ローカル state の通信パラメータをまとめて useSerial の connect() に渡す */
  const handleConnect = () => {
    onConnect({ baudRate, dataBits, stopBits, parity, flowControl });
  };

  return (
    <div className="serial-config">
      <h2>通信設定</h2>
      {/*
        通信パラメータ設定グリッド。
        接続中は変更不可（disabled）。変更するには一度切断が必要。
        port.open() のパラメータは接続後に変更できない Web Serial API の制約による。
      */}
      <div className="config-grid">
        <label>
          ボーレート
          <select
            value={baudRate}
            onChange={(e) => setBaudRate(Number(e.target.value))}
            disabled={isConnected}
          >
            {BAUD_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate}
              </option>
            ))}
          </select>
        </label>

        <label>
          データビット
          <select
            value={dataBits}
            onChange={(e) =>
              setDataBits(Number(e.target.value) as 7 | 8)
            }
            disabled={isConnected}
          >
            {DATA_BITS.map((bits) => (
              <option key={bits} value={bits}>
                {bits}
              </option>
            ))}
          </select>
        </label>

        <label>
          ストップビット
          <select
            value={stopBits}
            onChange={(e) =>
              setStopBits(Number(e.target.value) as 1 | 2)
            }
            disabled={isConnected}
          >
            {STOP_BITS.map((bits) => (
              <option key={bits} value={bits}>
                {bits}
              </option>
            ))}
          </select>
        </label>

        <label>
          パリティ
          <select
            value={parity}
            onChange={(e) => setParity(e.target.value as ParityType)}
            disabled={isConnected}
          >
            {PARITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label>
          フロー制御
          <select
            value={flowControl}
            onChange={(e) =>
              setFlowControl(e.target.value as FlowControlType)
            }
            disabled={isConnected}
          >
            {FLOW_CONTROLS.map((fc) => (
              <option key={fc} value={fc}>
                {fc}
              </option>
            ))}
          </select>
        </label>

        {/*
          エンコーディングは接続中でも変更可能。
          変更すると useSerial の encodingRef が即座に更新され、
          次に受信するチャンクから新しいエンコーディングでデコードされる。
          文字化け時にリアルタイムで切り替えて正しい設定を探すことが可能。
        */}
        <label>
          文字コード
          <select
            value={encoding}
            onChange={(e) => onEncodingChange(e.target.value as EncodingType)}
          >
            {ENCODINGS.map((enc) => (
              <option key={enc.value} value={enc.value}>
                {enc.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="connect-actions">
        {/* 接続/切断トグルボタン。接続中は「切断」、切断中は「接続」と表示 */}
        <button
          className={`connect-btn ${isConnected ? "disconnect" : "connect"}`}
          onClick={isConnected ? onDisconnect : handleConnect}
        >
          {isConnected ? "切断" : "接続"}
        </button>
        {/*
          ポート変更ボタン。
          ブラウザのポート選択ダイアログを表示する。
          既存接続がある場合は自動的にクリーンアップ（切断）してから表示する。
          選択後は connect() で明示的に接続する必要がある。
        */}
        <button
          className="select-port-btn"
          onClick={onSelectPort}
        >
          ポートを変更
        </button>
      </div>

      {/*
        ペアリング済みポート一覧。
        Web Serial API では requestPort() で一度許可されたポートはブラウザのオリジン単位で記憶される。
        ブラウザを閉じて再度開いても、ペアリング情報は永続化されている。

        各ポートに「削除」ボタンがあり、forget() でペアリングを解除できる。
        デバイスを物理的に取り外した後もペアリング情報が残るため、
        不要なエントリをクリーンアップするために使用する。
      */}
      <div className="paired-ports">
        <h3>ペアリング済みポート</h3>
        {pairedPorts.length === 0 ? (
          <p className="no-ports">なし</p>
        ) : (
          <ul className="port-list">
            {pairedPorts.map((port, index) => (
              <li key={index} className="port-item">
                <span className="port-label">{formatPortLabel(port, index)}</span>
                <button
                  className="forget-port-btn"
                  onClick={() => onForgetPort(port)}
                  title="このポートのペアリングを解除"
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
