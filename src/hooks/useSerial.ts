import { useState, useRef, useCallback, useEffect } from "react";
import Encoding from "encoding-japanese";

export type EncodingType = "SJIS" | "EUCJP" | "UTF8";

export interface SerialOptions {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: ParityType;
  flowControl: FlowControlType;
}

export interface ReceivedData {
  timestamp: Date;
  text: string;
  raw: Uint8Array;
}

const DEFAULT_OPTIONS: SerialOptions = {
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  flowControl: "none",
};

export function useSerial() {
  const [isConnected, setIsConnected] = useState(false);
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
  const [receivedData, setReceivedData] = useState<ReceivedData[]>([]);
  const [portInfo, setPortInfo] = useState<SerialPortInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairedPorts, setPairedPorts] = useState<SerialPort[]>([]);
  const [encoding, setEncodingState] = useState<EncodingType>("SJIS");

  const portRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(
    null
  );
  const readLoopActiveRef = useRef(false);
  const encodingRef = useRef<EncodingType>("SJIS");

  const setEncoding = useCallback((enc: EncodingType) => {
    encodingRef.current = enc;
    setEncodingState(enc);
  }, []);

  const isSupported = "serial" in navigator;

  const loadPairedPorts = useCallback(async () => {
    if (!("serial" in navigator)) return;
    const ports = await navigator.serial.getPorts();
    setPairedPorts(ports);
  }, []);

  const readLoop = useCallback(async () => {
    if (!portRef.current?.readable) return;

    readLoopActiveRef.current = true;

    while (portRef.current.readable && readLoopActiveRef.current) {
      const reader = portRef.current.readable.getReader();
      readerRef.current = reader;

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            const raw = new Uint8Array(value);
            const converted = Encoding.convert(raw, {
              to: "UNICODE",
              from: encodingRef.current,
            });
            const text = Encoding.codeToString(converted);
            setReceivedData((prev) => [
              ...prev,
              { timestamp: new Date(), text, raw },
            ]);
          }
        }
      } catch (err) {
        if (readLoopActiveRef.current) {
          console.error("Read error:", err);
          setError(`読み取りエラー: ${err}`);
        }
      } finally {
        reader.releaseLock();
        readerRef.current = null;
      }
    }
  }, []);

  const connect = useCallback(
    async (options: SerialOptions = DEFAULT_OPTIONS) => {
      try {
        setError(null);
        let port = portRef.current;
        if (!port) {
          const ports = await navigator.serial.getPorts();
          port = ports.length > 0 ? ports[0] : await navigator.serial.requestPort();
        }
        await port.open({
          baudRate: options.baudRate,
          dataBits: options.dataBits,
          stopBits: options.stopBits,
          parity: options.parity,
          flowControl: options.flowControl,
        });

        portRef.current = port;
        setPortInfo(port.getInfo());
        setIsConnected(true);

        readLoop();
        await loadPairedPorts();
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotFoundError") {
          // User cancelled port selection
          return;
        }
        console.error("Connection error:", err);
        setError(`接続エラー: ${err}`);
        setIsConnected(false);
      }
    },
    [readLoop, loadPairedPorts]
  );

  const selectPort = useCallback(async () => {
    try {
      setError(null);
      if (portRef.current) {
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
      const port = await navigator.serial.requestPort();
      portRef.current = port;
      await loadPairedPorts();
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotFoundError") {
        // User cancelled port selection
        return;
      }
      console.error("Port selection error:", err);
      setError(`ポート選択エラー: ${err}`);
    }
  }, [loadPairedPorts]);

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
      console.error("Disconnect error:", err);
    } finally {
      setIsConnected(false);
      setPortInfo(null);
    }
  }, []);

  const forgetPort = useCallback(async (port: SerialPort) => {
    try {
      setError(null);
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
      await port.forget();
      await loadPairedPorts();
    } catch (err) {
      console.error("Forget port error:", err);
      setError(`ポート削除エラー: ${err}`);
    }
  }, [loadPairedPorts]);

  const sendData = useCallback(async (text: string) => {
    if (!portRef.current?.writable) {
      setError("ポートが書き込み可能ではありません");
      return;
    }

    const writer = portRef.current.writable.getWriter();
    try {
      const encoded = new Uint8Array(
        Encoding.convert(Encoding.stringToCode(text), {
          to: encodingRef.current,
          from: "UNICODE",
        })
      );
      await writer.write(encoded);
    } catch (err) {
      console.error("Write error:", err);
      setError(`送信エラー: ${err}`);
    } finally {
      writer.releaseLock();
    }
  }, []);

  const clearData = useCallback(() => {
    setReceivedData([]);
  }, []);

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
