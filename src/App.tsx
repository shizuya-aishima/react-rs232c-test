/**
 * App - アプリケーションのルートコンポーネント
 *
 * レイアウト構成:
 *   - header: アプリタイトルと接続状態表示（ConnectionStatus）
 *   - aside (sidebar): シリアル通信パラメータの設定UI（SerialConfig）
 *   - section (content): シリアルモニタ本体（SerialMonitor）
 *
 * 状態管理:
 *   useSerial フックが全てのシリアル通信関連の状態とロジックを保持し、
 *   各子コンポーネントには Props で必要な値とコールバックを渡す（Props Drilling パターン）。
 *
 * 製品版への移行時の考慮事項:
 *   - Props Drilling が深くなる場合は、Context API や状態管理ライブラリ（Zustand 等）を導入する
 *   - 複数ポート同時接続が必要な場合は useSerial をポート単位でインスタンス化する
 *   - ルーティング導入時は React Router 等でページ分割を検討する
 */
import { useSerial } from "./hooks/useSerial";
import { SerialConfig } from "./components/SerialConfig";
import { SerialMonitor } from "./components/SerialMonitor";
import { ConnectionStatus } from "./components/ConnectionStatus";
import "./App.css";

function App() {
  const {
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
  } = useSerial();

  /**
   * Web Serial API 非対応ブラウザへのフォールバック表示。
   * navigator.serial が存在しない場合（Firefox, Safari, 古いブラウザ）に表示する。
   * Web Serial API は Secure Context（HTTPS or localhost）でのみ利用可能なため、
   * HTTP でアクセスした場合もこの分岐に入る。
   */
  if (!isSupported) {
    return (
      <div className="app">
        <div className="unsupported">
          <h1>Web Serial API 非対応</h1>
          <p>
            このブラウザはWeb Serial APIに対応していません。
            <br />
            Chrome または Edge の最新版をご使用ください。
          </p>
          <p className="hint">
            また、HTTPS または localhost でアクセスする必要があります。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>RS-232C シリアルモニタ</h1>
        <ConnectionStatus
          isConnected={isConnected}
          isAutoConnecting={isAutoConnecting}
          portInfo={portInfo}
          error={error}
        />
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <SerialConfig
            isConnected={isConnected}
            pairedPorts={pairedPorts}
            encoding={encoding}
            onConnect={connect}
            onDisconnect={disconnect}
            onSelectPort={selectPort}
            onForgetPort={forgetPort}
            onEncodingChange={setEncoding}
          />
        </aside>

        <section className="content">
          <SerialMonitor
            receivedData={receivedData}
            onClear={clearData}
            onSend={sendData}
            isConnected={isConnected}
          />
        </section>
      </main>
    </div>
  );
}

export default App;
