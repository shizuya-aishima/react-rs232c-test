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
