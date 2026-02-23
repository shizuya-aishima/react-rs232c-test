import { useState, useEffect, useRef } from "react";
import type { ReceivedData } from "../hooks/useSerial";

interface SerialMonitorProps {
  receivedData: ReceivedData[];
  onClear: () => void;
  onSend: (text: string) => void;
  isConnected: boolean;
}

type DisplayMode = "text" | "hex";

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

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
  const monitorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (monitorRef.current) {
      monitorRef.current.scrollTop = monitorRef.current.scrollHeight;
    }
  }, [receivedData]);

  const handleSend = () => {
    if (sendText.trim()) {
      onSend(sendText);
      setSendText("");
    }
  };

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
