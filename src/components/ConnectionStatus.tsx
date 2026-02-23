interface ConnectionStatusProps {
  isConnected: boolean;
  portInfo: SerialPortInfo | null;
  error: string | null;
}

export function ConnectionStatus({
  isConnected,
  portInfo,
  error,
}: ConnectionStatusProps) {
  return (
    <div className="connection-status">
      <div className="status-indicator">
        <span className={`status-dot ${isConnected ? "connected" : "disconnected"}`} />
        <span className="status-text">
          {isConnected ? "接続中" : "切断中"}
        </span>
      </div>

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

      {error && <div className="error-message">{error}</div>}
    </div>
  );
}
