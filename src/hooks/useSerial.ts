/**
 * useSerial - Web Serial API を React で扱うためのカスタムフック
 *
 * このフックは Web Serial API（https://wicg.github.io/serial/）のライフサイクル全体を管理する。
 * 主な責務:
 *   1. シリアルポートの選択・接続・切断
 *   2. 受信データの非同期読み取りループ（ReadableStream）
 *   3. 送信データの書き込み（WritableStream）
 *   4. encoding-japanese ライブラリを用いた文字コード変換（SJIS / EUC-JP / UTF-8）
 *   5. ペアリング済みポートの管理と自動再接続
 *
 * Web Serial API の制約:
 *   - 対応ブラウザ: Chrome 89+, Edge 89+（Firefox / Safari は未対応）
 *   - HTTPS または localhost でのみ動作（Secure Context が必要）
 *   - ポートへのアクセスにはユーザージェスチャー（クリック等）が必要
 *   - 一度ユーザーが許可したポートは navigator.serial.getPorts() で再取得可能（ペアリング）
 *
 * RS-232C シリアル通信の基本:
 *   シリアルポートはバイトストリームとしてデータを送受信する。
 *   1フレームの構造: [スタートビット(1)] [データビット(7or8)] [パリティビット(0or1)] [ストップビット(1or2)]
 *   例: 8N1（8データビット、パリティなし、1ストップビット）の場合、
 *       1バイト送信に 10ビット必要（スタート1 + データ8 + ストップ1）。
 *       ボーレート9600bps なら、最大 960バイト/秒 の実効速度になる。
 *
 *   Web Serial API はこのフレーム処理をハードウェア/ドライバ層で行い、
 *   アプリケーション側にはデータビット部分のみをバイト配列（Uint8Array）として渡す。
 *   スタートビット、パリティビット、ストップビットはアプリからは見えない。
 *
 * 製品版への移行時の考慮事項:
 *   - 状態管理を Context API や Zustand 等に移行し、複数コンポーネントから参照可能にする
 *   - エラーハンドリングの体系化（エラーコード、リトライ戦略）
 *   - 複数ポート同時接続のサポート
 *   - 受信データのバッファリングとパース処理の分離
 *   - 受信チャンク境界でのマルチバイト文字分断への対処（後述）
 */
import { useState, useRef, useCallback, useEffect } from "react";
import Encoding from "encoding-japanese";

/**
 * サポートする文字エンコーディング。
 * RS-232C 通信では接続先機器の仕様に合わせたエンコーディングが必要。
 * エンコーディングが不一致の場合、テキストが文字化けして表示される。
 * HEXモードで生バイト列を確認し、正しいエンコーディングを特定することが可能。
 *
 * - SJIS: Windows系機器や日本製産業機器で広く使われる。1バイト(ASCII)と2バイト(日本語)の混在。
 *         第1バイトが 0x81-0x9F, 0xE0-0xEF の範囲なら2バイト文字の先頭。
 * - EUCJP: Unix/Linux系機器で使われることがある。第1バイトが 0xA1-0xFE なら2バイト文字。
 * - UTF8: 最近の機器やマイコン（Arduino等）で標準的。1〜4バイトの可変長エンコーディング。
 *
 * 注意: 現在の実装ではチャンク境界でマルチバイト文字が分断される可能性がある。
 * 例: SJIS の2バイト文字 "あ"(0x82 0xA0) が2つのチャンクに分割された場合、
 * 最初のチャンク末尾の 0x82 が不正なバイトとして処理される。
 * 製品版ではバッファリングによるマルチバイト文字境界の処理が必要。
 */
export type EncodingType = "SJIS" | "EUCJP" | "UTF8";

/**
 * シリアルポートの通信パラメータ。
 * 接続先機器と完全に一致させる必要がある（不一致だと文字化けや通信エラーが発生する）。
 *
 * RS-232C のデータフレーム構造:
 *   ┌──────┬─────────────┬──────────┬──────────┐
 *   │Start │ Data Bits   │ Parity   │ Stop     │
 *   │ (1)  │ (7 or 8)    │ (0 or 1) │ (1 or 2) │
 *   └──────┴─────────────┴──────────┴──────────┘
 *   アイドル状態は High(1)。Start bit で Low(0) に変化し、データ転送が開始される。
 *
 * トラブルシューティング:
 *   - 文字化け → ボーレートまたはエンコーディングの不一致を疑う
 *   - データが全く受信できない → ボーレート、データビット、パリティ、ストップビットの不一致
 *   - フレーミングエラー → ストップビットの設定不一致（受信側でストップビットを検出できない）
 *   - オーバーランエラー → フロー制御なしで高速送信し、受信バッファがあふれている
 *
 * @property baudRate    - ボーレート（bps）。1秒間に転送されるビット数。送受信双方で一致が必須。
 *                         ボーレートが異なると全てのデータが文字化けする（最も一般的なトラブル原因）。
 * @property dataBits    - データビット長。1フレームあたりのデータビット数。
 *                         7: ASCII のみの場合に使用（7ビットで 0x00-0x7F を表現）。
 *                         8: バイナリデータやマルチバイト文字（SJIS等）を扱う場合の標準。
 * @property stopBits    - ストップビット。フレーム終端を示すビット数。
 *                         1: 標準的。2: 低速通信や長距離通信で同期余裕を持たせる。
 *                         送受信で不一致の場合、フレーミングエラーが発生する。
 * @property parity      - パリティビット。誤り検出用。
 *                         "none": パリティなし（最も一般的）。
 *                         "even": 偶数パリティ。データビット+パリティビットの1の総数が偶数になる。
 *                         "odd": 奇数パリティ。データビット+パリティビットの1の総数が奇数になる。
 *                         パリティエラーが頻発する場合、ノイズ環境か設定不一致の可能性がある。
 * @property flowControl - フロー制御。受信バッファのオーバーフローを防ぐ。
 *                         "none": フロー制御なし。低速通信や短いメッセージでは通常不要。
 *                         "hardware": RTS/CTS 信号線による制御。
 *                           送信側は CTS(Clear To Send) が High の時のみデータを送信。
 *                           受信側はバッファに余裕がなくなると RTS(Request To Send) を Low にする。
 *                           高速通信や大量データ転送時に、データ欠落を防ぐために使用する。
 *                         ※ ソフトウェアフロー制御（XON/XOFF: 0x11/0x13）は Web Serial API 非対応。
 */
export interface SerialOptions {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: ParityType;
  flowControl: FlowControlType;
}

/**
 * 受信データ1チャンク分の構造体。
 *
 * Web Serial API はバイトストリームとしてデータを受信する。
 * reader.read() が返す1回分のデータが1チャンクに対応する。
 *
 * 重要: チャンクの区切りはアプリケーション層のメッセージ境界とは一致しない。
 * OSのシリアルドライバのバッファリングや USB転送タイミングに依存する。
 * 例:
 *   - 機器が "HELLO\r\n" を送信した場合、"HEL" と "LO\r\n" の2チャンクに分割されることがある
 *   - 逆に、複数メッセージが1チャンクにまとまることもある
 *   - SJIS等のマルチバイト文字がチャンク境界で分断されると文字化けの原因になる
 *
 * 製品版では、区切り文字（改行等）やメッセージ長に基づくバッファリング/パース処理が必要。
 *
 * @property timestamp - 受信時刻。ミリ秒精度でシリアル通信のタイミング分析に使用。
 *                       チャンク単位のタイムスタンプであり、個々のバイトの受信時刻ではない。
 * @property text      - encodingRef に基づいて Unicode に変換済みのテキスト。
 *                       エンコーディング不一致時は文字化けする。HEXモードで raw を確認して判断する。
 * @property raw       - 変換前の生バイト配列。HEXダンプ表示やバイナリプロトコル解析用。
 *                       エンコーディングに依存しない実際の受信バイト列。
 */
export interface ReceivedData {
  timestamp: Date;
  text: string;
  raw: Uint8Array;
}

/**
 * RS-232C で最も一般的なデフォルト通信設定。
 * "9600 8N1" と表記される構成:
 *   - 9600bps: 多くのレガシー機器のデフォルト
 *   - 8データビット: バイナリ・マルチバイト文字対応
 *   - N(None): パリティなし
 *   - 1ストップビット
 *   - フロー制御なし
 *
 * 接続先機器のマニュアルで通信パラメータを確認し、
 * 必要に応じて SerialConfig コンポーネントから変更する。
 */
const DEFAULT_OPTIONS: SerialOptions = {
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  flowControl: "none",
};

export function useSerial() {
  // ===========================================================================
  // React State
  // UI の再レンダリングに関わる状態は useState で管理
  // ===========================================================================
  /** ポートが open 状態かどうか。true の間は readLoop が動作し、sendData が使用可能 */
  const [isConnected, setIsConnected] = useState(false);
  /** 初回マウント時の自動接続処理中フラグ。UI に "自動接続中..." と表示するために使用 */
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
  /** 受信データのログ。チャンク単位で追加される。クリア操作で空配列にリセット */
  const [receivedData, setReceivedData] = useState<ReceivedData[]>([]);
  /** 接続中ポートの情報（VID/PID等）。ConnectionStatus コンポーネントで表示 */
  const [portInfo, setPortInfo] = useState<SerialPortInfo | null>(null);
  /** 直近のエラーメッセージ。接続・読み取り・書き込み各操作で発生したエラーを表示 */
  const [error, setError] = useState<string | null>(null);
  /** ブラウザにペアリング済みのポート一覧。SerialConfig で表示・管理 */
  const [pairedPorts, setPairedPorts] = useState<SerialPort[]>([]);
  /** 現在のエンコーディング設定（UI 表示用） */
  const [encoding, setEncodingState] = useState<EncodingType>("SJIS");

  // ===========================================================================
  // Refs
  // readLoop 内の非同期処理はクロージャが古い state を参照する（stale closure 問題）ため、
  // 非同期ループから参照が必要な値は useRef で管理し、常に最新値を読み取れるようにする。
  // ===========================================================================

  /**
   * 現在接続中のシリアルポートインスタンス（Web Serial API の SerialPort オブジェクト）。
   * port.readable / port.writable でそれぞれ読み取り/書き込みストリームにアクセスする。
   * ポートは open() で開き、close() で閉じる。open 中は他のアプリからアクセスできない（排他ロック）。
   */
  const portRef = useRef<SerialPort | null>(null);

  /**
   * ReadableStream から取得したリーダー（ReadableStreamDefaultReader）。
   *
   * Web Serial API の読み取りモデル:
   *   port.readable → ReadableStream<Uint8Array>
   *   stream.getReader() → ReadableStreamDefaultReader（ストリームにロックがかかる）
   *   reader.read() → { value: Uint8Array, done: boolean }（1チャンク分のデータ）
   *
   * ロックの重要性:
   *   - getReader() するとストリームがロックされ、別のリーダーを取得できなくなる
   *   - reader.releaseLock() でロックを解放する必要がある
   *   - ポートを close() する前に、必ずリーダーのロックを解放する必要がある
   *
   * 切断時のシーケンス:
   *   reader.cancel() → readLoop 内の reader.read() が { done: true } を返す
   *   → finally ブロックで reader.releaseLock() が呼ばれる → ポートの close() が可能になる
   */
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(
    null
  );

  /**
   * 読み取りループの制御フラグ。false にすると外側の while ループが停止する。
   *
   * state ではなく ref を使う理由:
   *   readLoop は非同期 while ループで、次の reader.read() の await 中は
   *   React のレンダリングサイクルの外にいる。useState の値変更は再レンダリングで
   *   反映されるが、ループ内のクロージャは古い値を参照し続ける。
   *   ref なら .current への代入が即座に反映され、次のループ判定で停止できる。
   */
  const readLoopActiveRef = useRef(false);

  /**
   * 現在選択中のエンコーディング（readLoop 内参照用）。
   *
   * readLoop 内で encoding state を直接参照すると、useCallback のクロージャに
   * 初回レンダリング時の値が閉じ込められ、ユーザーがエンコーディングを変更しても
   * 読み取り処理に反映されない。ref を使うことで、常に最新のエンコーディング設定で
   * 受信データを変換できる。
   *
   * setEncoding() で state（UI表示用）と ref（readLoop参照用）を同時に更新する。
   */
  const encodingRef = useRef<EncodingType>("SJIS");

  /** エンコーディング変更。state と ref を同期的に更新する */
  const setEncoding = useCallback((enc: EncodingType) => {
    encodingRef.current = enc;
    setEncodingState(enc);
  }, []);

  /**
   * Web Serial API のブラウザサポートチェック。
   * navigator.serial が存在するかどうかで判定する。
   * 非対応ブラウザ: Firefox, Safari, 古い Chrome/Edge。
   * HTTP（非HTTPS）アクセスの場合も Secure Context でないため navigator.serial が存在しない。
   */
  const isSupported = "serial" in navigator;

  /**
   * ブラウザにペアリング済み（ユーザーが過去に許可した）ポートの一覧を取得する。
   *
   * Web Serial API のペアリングモデル:
   *   1. requestPort() でユーザーがポート選択ダイアログから許可する → ペアリング成立
   *   2. ペアリング情報はブラウザのオリジン単位で永続化される
   *   3. getPorts() でユーザー操作なしにペアリング済みポートを取得可能
   *   4. forget() でペアリングを明示的に解除可能
   *
   * ペアリング済みポートが存在する場合、ページロード時に自動接続を試みる（後述の useEffect）。
   */
  const loadPairedPorts = useCallback(async () => {
    if (!("serial" in navigator)) return;
    const ports = await navigator.serial.getPorts();
    setPairedPorts(ports);
  }, []);

  /**
   * シリアルポートからのデータ受信ループ。
   *
   * Web Serial API の ReadableStream を使って、ポートからバイトデータを継続的に読み取る。
   * この関数は connect() から呼ばれ、ポートが閉じられるか readLoopActiveRef が false になるまで
   * バックグラウンドで実行され続ける（await されずに Promise が浮いた状態で実行される）。
   *
   * ■ 二重 while ループ構造の意図:
   *
   * 外側ループ: while (portRef.current.readable && readLoopActiveRef.current)
   *   - ポートの readable ストリームが有効かつ readLoopActive な間継続する
   *   - 内側ループで reader がエラーや done で解放された後、ポートがまだ readable であれば
   *     新たなリーダーを取得して読み取りを再開する
   *   - これにより、一時的なストリームエラー後の自動復帰が可能
   *
   * 内側ループ: while (true) ... reader.read()
   *   - 1つのリーダーからチャンク単位でデータを逐次読み取る
   *   - reader.read() は受信データがあるまで非同期にブロックする（await）
   *   - done=true はストリームの終了（reader.cancel() が呼ばれた場合など）を意味する
   *   - value は Uint8Array で、OSのシリアルドライバが内部バッファから渡す1チャンク分のデータ
   *
   * ■ encoding-japanese によるバイト列変換パイプライン:
   *
   *   受信バイト列（Uint8Array）
   *     ↓ Encoding.convert(raw, { to: "UNICODE", from: "SJIS" })
   *   Unicode コード配列（number[]）
   *     ↓ Encoding.codeToString(converted)
   *   JavaScript 文字列（string）
   *
   *   Encoding.convert() は内部でバイト列を解析し、指定エンコーディングのバイトシーケンスを
   *   Unicode コードポイントに変換する。不正なバイトシーケンスは置換文字（U+FFFD）になる。
   *
   * ■ チャンク境界の注意事項:
   *   reader.read() が返すチャンクの区切りは、OSのドライババッファやUSB転送タイミングに依存する。
   *   マルチバイト文字（SJIS: 2バイト、UTF-8: 1〜4バイト）がチャンク境界で分断されると、
   *   Encoding.convert() が不正バイトとして処理し、文字化けの原因になる。
   *   製品版では未完成のマルチバイトシーケンスをバッファに保持し、
   *   次のチャンクと結合してからデコードする処理が必要。
   */
  const readLoop = useCallback(async () => {
    if (!portRef.current?.readable) return;

    readLoopActiveRef.current = true;

    while (portRef.current.readable && readLoopActiveRef.current) {
      // ReadableStream からリーダーを取得（ストリームにロックがかかる）。
      // リーダー取得後は、releaseLock() するまで他のリーダーを取得できない。
      const reader = portRef.current.readable.getReader();
      readerRef.current = reader;

      try {
        while (true) {
          // reader.read() はデータ受信まで非同期にブロックする。
          // 受信データがあると { value: Uint8Array, done: false } を返す。
          // reader.cancel() が呼ばれると { value: undefined, done: true } を返す。
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            // value は OS のシリアルドライバから渡された生バイト列。
            // チャンクサイズはドライバのバッファサイズや受信タイミングに依存する。
            // 通常 1〜数百バイト程度だが、保証されたサイズではない。
            const raw = new Uint8Array(value);

            // encoding-japanese で受信バイト列を Unicode に変換。
            // encodingRef.current を使うことで、ループ中のエンコーディング変更が即座に反映される。
            // 変換できないバイトシーケンスは置換文字（U+FFFD: "�"）になる。
            const converted = Encoding.convert(raw, {
              to: "UNICODE",
              from: encodingRef.current,
            });
            // Unicode コード配列を JavaScript の文字列に変換。
            // JavaScript の string は内部的に UTF-16 で、ここで Uint8Array → string の変換が完了する。
            const text = Encoding.codeToString(converted);

            // 関数型 setState で前回の配列に新しいチャンクを追加する。
            // スプレッド構文による新配列生成のため、大量データ蓄積時はパフォーマンスに注意。
            // 製品版ではリングバッファや最大保持件数の制限を検討する。
            setReceivedData((prev) => [
              ...prev,
              { timestamp: new Date(), text, raw },
            ]);
          }
        }
      } catch (err) {
        // readLoopActive が false の場合は disconnect() 等による意図的なキャンセル。
        // reader.cancel() → read() が reject する → ここに到達するが、正常な切断フローなのでエラー表示しない。
        // readLoopActive が true の場合は予期せぬエラー（USB ケーブルの抜去、デバイスの電源断等）。
        if (readLoopActiveRef.current) {
          console.error("Read error:", err);
          setError(`読み取りエラー: ${err}`);
        }
      } finally {
        // リーダーのロックを必ず解放する。
        // ロック解放しないと:
        //   - 外側ループでの新しいリーダー取得が失敗する
        //   - port.close() が "port is locked" エラーになる
        reader.releaseLock();
        readerRef.current = null;
      }
    }
  }, []);

  /**
   * シリアルポートへの接続。
   *
   * ■ ポート選択の優先順位:
   *   1. portRef に既にポートが設定済み → そのポートを使用（selectPort() で事前選択済みの場合）
   *   2. getPorts() でペアリング済みポートが存在 → 最初のポートを自動選択
   *   3. いずれもなし → requestPort() でユーザーにポート選択ダイアログを表示
   *
   * ■ requestPort() の制約:
   *   ブラウザのセキュリティポリシーにより、ユーザージェスチャー（クリック等）のコンテキストで
   *   呼ぶ必要がある。setTimeout や setInterval 内、ページロード時の自動実行では
   *   SecurityError が発生する場合がある。
   *   一方、getPorts() はユーザージェスチャー不要で呼べるため、自動接続に使用可能。
   *
   * ■ port.open() のパラメータ:
   *   Web Serial API が OS のシリアルドライバに渡すハードウェア設定。
   *   これらのパラメータは接続先機器と完全に一致させる必要がある。
   *   open() が成功すると、ポートは排他的にロックされ、他のアプリ（他のブラウザタブ含む）
   *   からはアクセスできなくなる。
   *
   * ■ readLoop の非同期起動:
   *   readLoop() は await せずに呼び出す。Promise が返されるが意図的に無視する。
   *   これにより readLoop はバックグラウンドで独立して動作し、connect() は即座に完了する。
   *   readLoop の停止は readLoopActiveRef を false にすることで制御する。
   */
  const connect = useCallback(
    async (options: SerialOptions = DEFAULT_OPTIONS) => {
      try {
        setError(null);
        let port = portRef.current;
        if (!port) {
          // ペアリング済みポートがあればダイアログなしで自動選択、なければダイアログ表示
          const ports = await navigator.serial.getPorts();
          port = ports.length > 0 ? ports[0] : await navigator.serial.requestPort();
        }

        // port.open() でシリアルポートを開く。
        // OS のシリアルドライバに通信パラメータを設定し、送受信バッファを確保する。
        // 既に他のアプリが使用中の場合は "port is already open" エラーが発生する。
        // パラメータ不一致でもopen自体は成功する（データの送受信時に初めて問題が顕在化する）。
        await port.open({
          baudRate: options.baudRate,
          dataBits: options.dataBits,
          stopBits: options.stopBits,
          parity: options.parity,
          flowControl: options.flowControl,
        });

        portRef.current = port;
        // port.getInfo() は USB デバイスの場合に usbVendorId / usbProductId を返す。
        // Bluetooth や内蔵シリアルポートの場合はこれらの値が undefined になる。
        setPortInfo(port.getInfo());
        setIsConnected(true);

        // readLoop() を await せずに起動（バックグラウンドで非同期に実行し続ける）。
        // この Promise は readLoop の外側 while ループが終了するまで resolve されない。
        readLoop();
        // ペアリング済みポート一覧を更新（新しいポートが追加された可能性がある）
        await loadPairedPorts();
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotFoundError") {
          // ユーザーがポート選択ダイアログをキャンセルした場合。
          // これはエラーではなく正常なユーザー操作なので、エラー表示しない。
          return;
        }
        // その他のエラー:
        //   - NetworkError: ポートが既に使用中（他のタブ/アプリが占有）
        //   - InvalidStateError: ポートが既に open されている
        //   - SecurityError: ユーザージェスチャーなしで requestPort() を呼んだ
        console.error("Connection error:", err);
        setError(`接続エラー: ${err}`);
        setIsConnected(false);
      }
    },
    [readLoop, loadPairedPorts]
  );

  /**
   * ポートの変更（再選択）。
   * 既存の接続がある場合は、リーダーのキャンセル → ポートのクローズ の順で
   * クリーンアップしてから、新しいポートの選択ダイアログを表示する。
   *
   * ■ クリーンアップの順序（厳守）:
   *   1. readLoopActiveRef = false → 外側 while ループの次の反復で停止
   *   2. reader.cancel() → 内側 while ループの reader.read() が done=true を返す
   *      → finally で reader.releaseLock() が実行される
   *   3. port.close() → OS のシリアルドライバにポートを返却
   *
   *   この順序を守らないと:
   *   - releaseLock() 前に close() → "Cannot close a locked port" エラー
   *   - cancel() 前に releaseLock() → 読み取り中のデータが不正に中断
   *
   * ■ selectPort() と connect() の関係:
   *   selectPort() はポートの選択のみを行い、open() はしない。
   *   ユーザーは selectPort() でポートを選んだ後、connect() で接続する。
   *   これにより接続パラメータの設定→ポート選択→接続 の順序を柔軟に変えられる。
   */
  const selectPort = useCallback(async () => {
    try {
      setError(null);
      // 既存接続がある場合は安全にクリーンアップ
      if (portRef.current) {
        readLoopActiveRef.current = false;
        if (readerRef.current) {
          // cancel() を await することで、readLoop 内の finally ブロック
          // （releaseLock）が確実に実行されてから次の処理に進む
          await readerRef.current.cancel();
          readerRef.current = null;
        }
        await portRef.current.close();
        portRef.current = null;
        setIsConnected(false);
        setPortInfo(null);
      }
      // requestPort() でブラウザのポート選択ダイアログを表示。
      // ユーザーが選択すると、そのポートへのアクセス権が付与される（ペアリング）。
      // ダイアログには接続されている全てのシリアルポートが一覧表示される。
      const port = await navigator.serial.requestPort();
      portRef.current = port;
      await loadPairedPorts();
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotFoundError") {
        // ユーザーがダイアログをキャンセルした。既存のポート選択は維持される。
        return;
      }
      console.error("Port selection error:", err);
      setError(`ポート選択エラー: ${err}`);
    }
  }, [loadPairedPorts]);

  /**
   * シリアルポートの切断。
   *
   * ■ リソース解放の順序（selectPort と同様に厳守）:
   *   1. readLoopActiveRef = false → ループ停止フラグ
   *   2. reader.cancel() → ReadableStream の読み取りを中断。
   *      内部で read() の Promise を reject し、readLoop の catch/finally に遷移させる。
   *   3. port.close() → OS のシリアルポートを閉じる。
   *      ポートの排他ロックが解除され、他のアプリからアクセス可能になる。
   *
   * ■ finally ブロック:
   *   close() でエラーが発生した場合（USB ケーブル抜去済み等）でも、
   *   UI の状態は必ず「切断」にリセットする。
   *   エラー後に isConnected が true のまま残ると、ユーザーが再接続できなくなる。
   */
  const disconnect = useCallback(async () => {
    readLoopActiveRef.current = false;

    try {
      if (readerRef.current) {
        await readerRef.current.cancel();
        readerRef.current = null;
      }
      if (portRef.current) {
        await portRef.current.close();
        portRef.current = null;
      }
    } catch (err) {
      // 切断時のエラーはログのみ。USB ケーブルが既に抜かれている場合など、
      // close() が失敗することがあるが、UI 上は切断扱いで問題ない。
      console.error("Disconnect error:", err);
    } finally {
      setIsConnected(false);
      setPortInfo(null);
    }
  }, []);

  /**
   * ペアリング済みポートの削除（forget）。
   *
   * Web Serial API の forget() メソッドにより、ブラウザに保存されたポートの許可を取り消す。
   * 対象ポートが現在接続中であれば、先に切断処理（readLoopActiveRef→cancel→close）を行う。
   *
   * forget() 後のポートの状態:
   *   - getPorts() のリストから削除される
   *   - 次回アクセス時には requestPort() でユーザーの再許可が必要
   *   - ポートのハードウェア自体は影響を受けない（ブラウザの許可情報のみ削除）
   *
   * 使用シーン:
   *   - 不要なデバイスの許可をクリーンアップしたい場合
   *   - デバイスを別のポートに移した場合に古いペアリングを削除
   */
  const forgetPort = useCallback(async (port: SerialPort) => {
    try {
      setError(null);
      // 削除対象が現在接続中のポートなら先にクリーンアップ
      if (portRef.current === port) {
        readLoopActiveRef.current = false;
        if (readerRef.current) {
          await readerRef.current.cancel();
          readerRef.current = null;
        }
        await portRef.current.close();
        portRef.current = null;
        setIsConnected(false);
        setPortInfo(null);
      }
      // ブラウザのペアリング情報を削除
      await port.forget();
      await loadPairedPorts();
    } catch (err) {
      console.error("Forget port error:", err);
      setError(`ポート削除エラー: ${err}`);
    }
  }, [loadPairedPorts]);

  /**
   * シリアルポートへのデータ送信。
   *
   * ■ 文字コード変換パイプライン（受信の逆方向）:
   *
   *   JavaScript 文字列（UTF-16 内部表現）
   *     ↓ Encoding.stringToCode(text)
   *   Unicode コード配列（number[]）
   *     ↓ Encoding.convert(codes, { to: "SJIS", from: "UNICODE" })
   *   指定エンコーディングのバイト配列（number[]）
   *     ↓ new Uint8Array(...)
   *   Uint8Array
   *     ↓ writer.write(encoded)
   *   OS のシリアルドライバ → ハードウェア（UART）→ 信号線
   *
   * ■ WritableStream のロックモデル:
   *   port.writable.getWriter() でライターを取得するとストリームがロックされる。
   *   writer.write() でデータを書き込んだ後、必ず writer.releaseLock() でロックを解放する。
   *   ロック解放を忘れると:
   *     - 次回の sendData() 呼び出しで "writable stream is locked" エラー
   *     - port.close() が "port is locked" エラー
   *
   * ■ 送信データに関する注意:
   *   - 機器によっては改行コード（CR: 0x0D, LF: 0x0A, CRLF: 0x0D 0x0A）が必要
   *   - 現在の実装では改行コードの自動付与はしていない（ユーザーが入力テキストに含める必要がある）
   *   - 製品版では改行コード設定（CR/LF/CRLF/なし）を追加するとよい
   *   - バイナリデータの送信にも対応する場合は HEX 入力モードの追加を検討する
   */
  const sendData = useCallback(async (text: string) => {
    if (!portRef.current?.writable) {
      setError("ポートが書き込み可能ではありません");
      return;
    }

    // WritableStream からライターを取得（ストリームにロックがかかる）
    const writer = portRef.current.writable.getWriter();
    try {
      // JavaScript 文字列 → 指定エンコーディングのバイト配列に変換
      const encoded = new Uint8Array(
        Encoding.convert(Encoding.stringToCode(text), {
          to: encodingRef.current,
          from: "UNICODE",
        })
      );
      // バイト配列をシリアルポートに書き込む。
      // write() は OS のシリアルドライバの送信バッファにデータを書き込む。
      // ハードウェアフロー制御が有効な場合、CTS が Low の間は write() がブロック（await）される。
      await writer.write(encoded);
    } catch (err) {
      // 送信エラーの原因:
      //   - ポートが切断された（USB ケーブル抜去）
      //   - ストリームが既にクローズされている
      //   - エンコーディング変換でサポートされていない文字が含まれていた
      console.error("Write error:", err);
      setError(`送信エラー: ${err}`);
    } finally {
      // ライターのロックを必ず解放。これがないと次の write やポートの close が失敗する。
      writer.releaseLock();
    }
  }, []);

  /** 受信データのクリア */
  const clearData = useCallback(() => {
    setReceivedData([]);
  }, []);

  /**
   * 初回マウント時の自動接続処理。
   *
   * ■ 自動接続の流れ:
   *   1. getPorts() でペアリング済みポートを取得（ユーザー操作不要）
   *   2. ポートが1つ以上あれば、最初のポートに DEFAULT_OPTIONS で自動接続
   *   3. isAutoConnecting フラグで UI に接続中状態を表示
   *
   * ■ getPorts() vs requestPort():
   *   - getPorts(): ペアリング済みポートの取得。ユーザージェスチャー不要。ページロード時に使用可能。
   *   - requestPort(): 新しいポートの選択ダイアログ。ユーザージェスチャー必須。
   *   自動接続では getPorts() のみを使用するため、SecurityError にならない。
   *
   * ■ cancelled フラグ:
   *   React StrictMode（開発環境）ではコンポーネントが2回マウント/アンマウントされる。
   *   1回目のマウントで開始した非同期処理が、アンマウント後に完了した場合に
   *   unmount 済みコンポーネントの setState を呼ぶことを防止する。
   *
   * ■ deps 除外の理由:
   *   connect は useCallback で安定しているが、connect → readLoop → ... と
   *   依存チェーンが長く、deps に含めると不要な再実行が発生する可能性がある。
   *   初回マウント時の1回のみ実行すればよいため、空の deps で固定。
   */
  useEffect(() => {
    if (!("serial" in navigator)) return;
    let cancelled = false;

    (async () => {
      const ports = await navigator.serial.getPorts();
      if (!cancelled) setPairedPorts(ports);
      if (cancelled || ports.length === 0) return;

      setIsAutoConnecting(true);
      try {
        await connect(DEFAULT_OPTIONS);
      } finally {
        if (!cancelled) setIsAutoConnecting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  // connect は useCallback で安定しているが deps に含めると循環するため除外
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * コンポーネントアンマウント時のクリーンアップ。
   *
   * SPA のページ遷移やコンポーネントのアンマウント時に、シリアルポートのリソースを解放する。
   * 解放しないと:
   *   - ブラウザがポートを排他ロックし続け、他のタブ/アプリからアクセスできない
   *   - readLoop が永久に動き続け、メモリリークやCPU使用率の増加を引き起こす
   *   - ブラウザを閉じるまでポートが占有され続ける
   *
   * catch(()=>{}) でエラーを無視する理由:
   *   アンマウント時は UI が既に破棄されているため、エラーを表示する先がない。
   *   また、USB ケーブルが既に抜かれている場合など、close() 自体が失敗することがあるが、
   *   アンマウント処理としては問題ない。
   */
  useEffect(() => {
    return () => {
      readLoopActiveRef.current = false;
      if (readerRef.current) {
        readerRef.current.cancel().catch(() => {});
      }
      if (portRef.current) {
        portRef.current.close().catch(() => {});
      }
    };
  }, []);

  return {
    isConnected,
    isAutoConnecting,
    isSupported,
    receivedData,
    portInfo,
    pairedPorts,
    error,
    encoding,
    setEncoding,
    connect,
    disconnect,
    selectPort,
    forgetPort,
    sendData,
    clearData,
  };
}
