import { useSerial } from "./hooks/useSerial";
import { SerialConfig } from "./components/SerialConfig";
import { SerialMonitor } from "./components/SerialMonitor";
import { ConnectionStatus } from "./components/ConnectionStatus";
import "./App.css";

function App() {
  const {
    isConnected,
    isSupported,
    receivedData,
    portInfo,
    error,
    connect,
    disconnect,
    sendData,
    clearData,
  } = useSerial();

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
          portInfo={portInfo}
          error={error}
        />
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <SerialConfig
            isConnected={isConnected}
            onConnect={connect}
            onDisconnect={disconnect}
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
