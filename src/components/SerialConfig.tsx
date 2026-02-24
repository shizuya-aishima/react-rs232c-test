import { useState } from "react";
import type { SerialOptions } from "../hooks/useSerial";

interface SerialConfigProps {
  isConnected: boolean;
  pairedPorts: SerialPort[];
  onConnect: (options: SerialOptions) => void;
  onDisconnect: () => void;
  onSelectPort: () => void;
  onForgetPort: (port: SerialPort) => void;
}

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200];
const DATA_BITS = [7, 8] as const;
const STOP_BITS = [1, 2] as const;
const PARITIES = ["none", "even", "odd"] as const;
const FLOW_CONTROLS = ["none", "hardware"] as const;

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
  onConnect,
  onDisconnect,
  onSelectPort,
  onForgetPort,
}: SerialConfigProps) {
  const [baudRate, setBaudRate] = useState(9600);
  const [dataBits, setDataBits] = useState<7 | 8>(8);
  const [stopBits, setStopBits] = useState<1 | 2>(1);
  const [parity, setParity] = useState<ParityType>("none");
  const [flowControl, setFlowControl] = useState<FlowControlType>("none");

  const handleConnect = () => {
    onConnect({ baudRate, dataBits, stopBits, parity, flowControl });
  };

  return (
    <div className="serial-config">
      <h2>通信設定</h2>
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
      </div>

      <div className="connect-actions">
        <button
          className={`connect-btn ${isConnected ? "disconnect" : "connect"}`}
          onClick={isConnected ? onDisconnect : handleConnect}
        >
          {isConnected ? "切断" : "接続"}
        </button>
        <button
          className="select-port-btn"
          onClick={onSelectPort}
        >
          ポートを変更
        </button>
      </div>

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
