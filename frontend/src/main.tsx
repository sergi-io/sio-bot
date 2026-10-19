import {
  memo,
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';

type PositionSide = 'long' | 'short';

type Position = {
  id: string;
  symbol: string;
  side: PositionSide;
  entryPrice: number;
  quantity: number;
  margin: number;
  leverage: number;
  openTimestamp: number;
  unrealizedPnl: number;
  realizedPnl: number;
  mae: number;
  minRealizedPnl?: number;
  maxRealizedPnl?: number;
  riskStrategiesExecuted?: RiskStrategyActionExecuted[];
};

type RiskStrategyActionExecuted = {
  action: string;
  params: {
    trailingPnl?: number;
  };
};

type BalanceSnapshot = {
  total: number;
  available: number;
  locked: number;
};

type MarketScannerSymbolStats = {
  exchangeId: string;
  symbol: string;
  lastPrice: number;
  timestamp: number;
  lastTradeTimestamp: number;
  tradeCount: number;
  tradesPerSecond: number;
  buyCount: number;
  sellCount: number;
  buyCost: number;
  sellCost: number;
  buyVolume: number;
  sellVolume: number;
  totalCost: number;
  totalVolume: number;
  netCost: number;
  volumeDelta?: number;
  costDelta?: number;
  volumeDeltaImbalance?: number;
  costDeltaImbalance?: number;
  vwap: number;
  open: number;
  high: number;
  low: number;
  priceChangeAbs: number;
  priceChangePct: number;
  priceChange1mAbs?: number;
  priceChange1mPct?: number;
  priceChange5mAbs?: number;
  priceChange5mPct?: number;
  priceChange15mAbs?: number;
  priceChange15mPct?: number;
};

type MarketScannerSnapshot = {
  type: 'market-scanner-snapshot';
  exchangeId: string;
  timestamp: number;
  windowMs: number;
  symbolsCount: number;
  activeSymbolsCount: number;
  symbols: MarketScannerSymbolStats[];
};

type CommandCenterSnapshot = {
  updatedAt: number;
  bot: {
    state: string;
    mode: string;
    assetSymbol: string;
    timeframe: string;
    marketScannerFeedEnabled: boolean;
    marketScannerAutotradingEnabled: boolean;
    assetAutoReentryCooldownSeconds: number;
  };
  balance: BalanceSnapshot;
  positions: Position[];
  positionHistory: PositionHistoryEntry[];
  marketScannerSnapshot: MarketScannerSnapshot | null;
};

type PositionHistoryEntry = {
  id: string;
  symbol: string;
  side: PositionSide;
  entryPrice: number;
  closePrice: number;
  quantity: number;
  margin: number;
  leverage: number;
  openTimestamp: number;
  closeTimestamp: number;
  realizedPnl: number;
  mae: number;
  minPnl: number;
  maxPnl: number;
};

type JournalPosition = {
  id: string;
  symbol: string;
  side: PositionSide;
  entryPrice: number;
  closePrice: number;
  quantity: number;
  margin: number;
  leverage: number;
  openTimestamp: number;
  closeTimestamp: number;
  enterFee: number;
  exitFee: number;
  realizedPnl: number;
  mae: number;
  minPnl: number;
  maxPnl: number;
  openedByStrategies: string;
  closedByStrategy: string;
  botConfigJson: string;
};

type JournalDayStats = {
  date: string;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  totalPnl: number;
  positions: JournalPosition[];
};

type JournalMetrics = {
  netPnl: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  avgWinLossRatio: number;
  largestWin: number;
  largestLoss: number;
  avgTradePnl: number;
  avgMae: number;
};

type JournalData = {
  generatedAt: string;
  metrics: JournalMetrics;
  dailyStats: Record<string, JournalDayStats>;
  cumulativePnl: Array<{ date: string; pnl: number }>;
  positions: JournalPosition[];
};

type ServerMessage =
  | {
      type: 'snapshot';
      payload: CommandCenterSnapshot;
    }
  | {
      type: 'marketScannerSnapshot';
      payload: MarketScannerSnapshot | null;
    }
  | {
      type: 'commandResult';
      requestId?: string;
      ok: boolean;
      positionId?: string;
      error?: string;
    };

type PendingCommand = {
  positionId?: string;
  label: string;
};

type PendingCommands = Record<string, PendingCommand>;
type ConnectionStatus = 'connecting' | 'online' | 'offline';
type Theme = 'dark' | 'light';
type RightPanel = 'history' | 'journal' | null;
type JournalPeriod = 'today' | '7d' | '30d' | '1y' | 'all';
type ScannerSortKey =
  | 'priceChange15mPct'
  | 'priceChange1mPct'
  | 'priceChange5mPct'
  | 'volumeDeltaImbalance'
  | 'tradesPerSecond'
  | 'totalVolume';
type ScannerTimeframeMetricKey = 'priceChange1mPct' | 'priceChange5mPct' | 'priceChange15mPct';
type CloseEffect = {
  id: string;
  left: number;
  top: number;
  gifUrl: string;
};

type ToastTone = 'positive' | 'negative';

type Toast = {
  id: string;
  tone: ToastTone;
  message: string;
};

const THEME_STORAGE_KEY = 'sio-command-center-theme';
const SPLIT_RATIO_STORAGE_KEY = 'sio-command-center-split-ratio';
const MIN_SPLIT_RATIO = 28;
const MAX_SPLIT_RATIO = 72;
const CLOSE_EFFECT_DURATION_MS = 2000;
const CLOSE_EFFECT_SIZE_PX = 100;
const TOAST_DURATION_MS = 10000;
const CLOSE_POSITIVE_GIF_URL = 'https://c.tenor.com/QgTx6fv4IpAAAAAd/tenor.gif';
const CLOSE_NEGATIVE_GIF_URL = 'https://c.tenor.com/aeYd3mqD2McAAAAC/tenor.gif';
const COMMAND_TIMEOUT_MS = 15_000;
const SCANNER_ROWS_LIMIT = 8;
const SCANNER_RANK_REFRESH_MS = 2000;
const SCANNER_SORT_OPTIONS: Array<{ value: ScannerSortKey; label: string }> = [
  { value: 'priceChange15mPct', label: '15m' },
  { value: 'priceChange1mPct', label: '1m' },
  { value: 'priceChange5mPct', label: '5m' },
  { value: 'volumeDeltaImbalance', label: 'Delta imbalance' },
  { value: 'tradesPerSecond', label: 'Trades/s' },
  { value: 'totalVolume', label: 'Volume' },
];
const SCANNER_TIMEFRAME_COLUMNS: Array<{ key: ScannerTimeframeMetricKey; label: string }> = [
  { key: 'priceChange1mPct', label: '1m' },
  { key: 'priceChange5mPct', label: '5m' },
  { key: 'priceChange15mPct', label: '15m' },
];
const JOURNAL_PERIOD_OPTIONS: Array<{ value: JournalPeriod; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
];

const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const JOURNAL_FETCH_ERROR = 'Could not fetch journal data';

function App(): ReactNode {
  const socketRef = useRef<WebSocket | null>(null);
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);
  const uiFlushFrameRef = useRef<number | null>(null);
  const pendingSnapshotRef = useRef<CommandCenterSnapshot | null>(null);
  const pendingScannerSnapshotRef = useRef<MarketScannerSnapshot | null | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<CommandCenterSnapshot | null>(null);
  const [journalData, setJournalData] = useState<JournalData | null>(null);
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalLoadError, setJournalLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [lastError, setLastError] = useState<string | null>(null);
  const [pendingCommands, setPendingCommands] = useState<PendingCommands>({});
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [splitRatio, setSplitRatio] = useState(getInitialSplitRatio);
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const [rightPanel, setRightPanel] = useState<RightPanel>('journal');
  const [closeEffects, setCloseEffects] = useState<CloseEffect[]>([]);
  const [scannerSortKey, setScannerSortKey] = useState<ScannerSortKey>('priceChange15mPct');
  const [scannerDisplaySnapshot, setScannerDisplaySnapshot] =
    useState<MarketScannerSnapshot | null>(null);
  const closeEffectTimersRef = useRef<Record<string, number>>({});
  const pendingCommandTimersRef = useRef<Record<string, number>>({});
  const toastTimersRef = useRef<Record<string, number>>({});
  const previousPositionsRef = useRef<Position[]>([]);
  const manualCloseRequestsRef = useRef<Map<string, string>>(new Map());
  const [toasts, setToasts] = useState<Toast[]>([]);

  const flushPendingUiUpdates = useEffectEvent(() => {
    uiFlushFrameRef.current = null;

    const nextSnapshot = pendingSnapshotRef.current;
    if (nextSnapshot !== null) {
      pendingSnapshotRef.current = null;
      startTransition(() => {
        setSnapshot(nextSnapshot);
      });
    }

    const nextScannerSnapshot = pendingScannerSnapshotRef.current;
    if (nextScannerSnapshot !== undefined) {
      pendingScannerSnapshotRef.current = undefined;
      applyIncomingScannerSnapshot(nextScannerSnapshot);
    }
  });

  const scheduleUiFlush = useEffectEvent(() => {
    if (uiFlushFrameRef.current !== null) {
      return;
    }

    uiFlushFrameRef.current = window.requestAnimationFrame(() => {
      flushPendingUiUpdates();
    });
  });

  const applyIncomingScannerSnapshot = useEffectEvent(
    (nextSnapshot: MarketScannerSnapshot | null) => {
      setScannerDisplaySnapshot(nextSnapshot);
    }
  );

  const onServerMessage = useEffectEvent((message: ServerMessage) => {
    if (message.type === 'snapshot') {
      pendingSnapshotRef.current = message.payload;
      if (message.payload.marketScannerSnapshot !== null) {
        pendingScannerSnapshotRef.current = message.payload.marketScannerSnapshot;
      } else if (!message.payload.bot.marketScannerFeedEnabled) {
        pendingScannerSnapshotRef.current = null;
      }
      scheduleUiFlush();
      return;
    }

    if (message.type === 'marketScannerSnapshot') {
      pendingScannerSnapshotRef.current = message.payload;
      scheduleUiFlush();
      return;
    }

    if (message.type === 'commandResult' && message.requestId && !message.ok) {
      manualCloseRequestsRef.current.delete(message.requestId);
    }

    if (message.requestId) {
      clearPendingCommandTimer(message.requestId);
      setPendingCommands((current) => omitKey(current, message.requestId!));
    }

    if (!message.ok) {
      setLastError(message.error ?? 'Command failed');
    }
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SPLIT_RATIO_STORAGE_KEY, String(splitRatio));
    } catch {
      return;
    }
  }, [splitRatio]);

  useEffect(() => {
    if (!isResizingSplit) {
      return;
    }

    const handlePointerMove = (event: PointerEvent): void => {
      const layout = splitLayoutRef.current;

      if (!layout) {
        return;
      }

      const rect = layout.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }

      const nextRatio = ((event.clientX - rect.left) / rect.width) * 100;
      setSplitRatio(clamp(nextRatio, MIN_SPLIT_RATIO, MAX_SPLIT_RATIO));
    };

    const stopResizing = (): void => {
      setIsResizingSplit(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
    };
  }, [isResizingSplit]);

  useEffect(() => {
    let reconnectTimer: number | null = null;
    let stopped = false;

    const connect = (): void => {
      setStatus('connecting');

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        setStatus('online');
        setLastError(null);
      });

      socket.addEventListener('message', (event) => {
        onServerMessage(JSON.parse(event.data) as ServerMessage);
      });

      socket.addEventListener('close', () => {
        if (stopped) {
          return;
        }

        setStatus('offline');
        reconnectTimer = window.setTimeout(connect, 1500);
      });

      socket.addEventListener('error', () => {
        setStatus('offline');
        setLastError('Could not connect to the websocket');
      });
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
  }, [rightPanel, status]);

  useEffect(() => {
    return () => {
      if (uiFlushFrameRef.current !== null) {
        window.cancelAnimationFrame(uiFlushFrameRef.current);
        uiFlushFrameRef.current = null;
      }

      Object.values(closeEffectTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      closeEffectTimersRef.current = {};

      Object.values(pendingCommandTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      pendingCommandTimersRef.current = {};

      Object.values(toastTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      toastTimersRef.current = {};
    };
  }, []);

  const removeManualCloseRequest = useEffectEvent((positionId: string): boolean => {
    let wasManualClose = false;

    manualCloseRequestsRef.current.forEach((storedPositionId, requestId) => {
      if (storedPositionId === positionId) {
        manualCloseRequestsRef.current.delete(requestId);
        wasManualClose = true;
      }
    });

    return wasManualClose;
  });

  const pushPositionCloseToast = useEffectEvent((position: Position): void => {
    const toastId = createClientId();
    const tone: ToastTone = position.realizedPnl >= 0 ? 'positive' : 'negative';
    const outcome =
      position.realizedPnl > 0 ? 'profit' : position.realizedPnl < 0 ? 'loss' : 'breakeven';

    setToasts((current) => [
      ...current,
      {
        id: toastId,
        tone,
        message: `${position.symbol} closed with ${outcome} ${money(position.realizedPnl)}`,
      },
    ]);

    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== toastId));
      delete toastTimersRef.current[toastId];
    }, TOAST_DURATION_MS);

    toastTimersRef.current[toastId] = timer;
  });

  useEffect(() => {
    if (snapshot === null) {
      previousPositionsRef.current = [];
      return;
    }

    const previousPositions = previousPositionsRef.current;

    if (previousPositions.length === 0) {
      previousPositionsRef.current = snapshot.positions;
      return;
    }

    const currentPositionIds = new Set(snapshot.positions.map((position) => position.id));
    const closedPositions = previousPositions.filter(
      (position) => !currentPositionIds.has(position.id)
    );

    for (const closedPosition of closedPositions) {
      const wasManualClose = removeManualCloseRequest(closedPosition.id);

      if (!wasManualClose) {
        pushPositionCloseToast(closedPosition);
      }
    }

    previousPositionsRef.current = snapshot.positions;
  }, [snapshot, pushPositionCloseToast, removeManualCloseRequest]);

  const positions = snapshot?.positions ?? [];
  const positionHistory = snapshot?.positionHistory ?? [];
  const totalPnl = positions.reduce((acc, position) => acc + position.realizedPnl, 0);
  const isOnline = status === 'online';
  const marketScannerFeedEnabled = snapshot?.bot.marketScannerFeedEnabled ?? false;
  const marketScannerAutotradingEnabled =
    snapshot?.bot.marketScannerAutotradingEnabled ?? false;
  const marketScannerFeedCommandPending = Object.values(pendingCommands).some(
    (command) => command.label === 'market-scanner-feed'
  );
  const marketScannerAutotradingCommandPending = Object.values(pendingCommands).some(
    (command) => command.label === 'market-scanner-autotrading'
  );

  const toggleTheme = (): void => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  };

  const beginSplitResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizingSplit(true);
  };

  const toggleRightPanel = (panel: Exclude<RightPanel, null>): void => {
    setRightPanel((current) => (current === panel ? null : panel));
  };

  const sendCommand = (command: {
    requestId?: string;
    type:
      | 'closePosition'
      | 'syncPositions'
      | 'setMarketScannerFeed'
      | 'setMarketScannerMode'
      | 'openManualScannerPosition';
    positionId?: string;
    enabled?: boolean;
    symbol?: string;
    side?: PositionSide;
  }): boolean => {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setLastError('Websocket disconnected');
      return false;
    }

    socket.send(JSON.stringify(command));
    return true;
  };

  const fetchJournalData = useEffectEvent(async (): Promise<void> => {
    setJournalLoading(true);
    setJournalLoadError(null);

    try {
      const response = await fetch('/api/trading-journal', {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      setJournalData((await response.json()) as JournalData);
    } catch (err) {
      setJournalLoadError(err instanceof Error ? err.message : JOURNAL_FETCH_ERROR);
    } finally {
      setJournalLoading(false);
    }
  });

  const clearPendingCommandTimer = (requestId: string): void => {
    const timer = pendingCommandTimersRef.current[requestId];

    if (timer === undefined) {
      return;
    }

    window.clearTimeout(timer);
    delete pendingCommandTimersRef.current[requestId];
  };

  const trackPendingCommand = (requestId: string, command: PendingCommand): void => {
    clearPendingCommandTimer(requestId);
    setPendingCommands((current) => ({
      ...current,
      [requestId]: command,
    }));

    pendingCommandTimersRef.current[requestId] = window.setTimeout(() => {
      delete pendingCommandTimersRef.current[requestId];
      manualCloseRequestsRef.current.delete(requestId);
      setPendingCommands((current) => omitKey(current, requestId));
      setLastError(`${command.label} command timed out`);
    }, COMMAND_TIMEOUT_MS);
  };

  const triggerCloseEffect = (button: HTMLButtonElement, gifUrl: string): void => {
    const rect = button.getBoundingClientRect();
    const effectId = createClientId();
    const left = rect.left + rect.width / 2 - CLOSE_EFFECT_SIZE_PX / 2;
    const top = rect.top - CLOSE_EFFECT_SIZE_PX + 8;

    setCloseEffects((current) => [...current, { id: effectId, left, top, gifUrl }]);

    const timer = window.setTimeout(() => {
      setCloseEffects((current) => current.filter((effect) => effect.id !== effectId));
      delete closeEffectTimersRef.current[effectId];
    }, CLOSE_EFFECT_DURATION_MS);

    closeEffectTimersRef.current[effectId] = timer;
  };

  const syncPositions = (): void => {
    const requestId = createClientId();

    if (
      sendCommand({
        type: 'syncPositions',
        requestId,
      })
    ) {
      trackPendingCommand(requestId, { label: 'sync' });
    }
  };

  const closePosition = (position: Position, event?: ReactMouseEvent<HTMLButtonElement>): void => {
    const requestId = createClientId();

    if (event) {
      triggerCloseEffect(
        event.currentTarget,
        position.realizedPnl >= 0 ? CLOSE_POSITIVE_GIF_URL : CLOSE_NEGATIVE_GIF_URL
      );
    }

    manualCloseRequestsRef.current.set(requestId, position.id);

    if (
      sendCommand({
        type: 'closePosition',
        requestId,
        positionId: position.id,
      })
    ) {
      trackPendingCommand(requestId, {
        positionId: position.id,
        label: position.symbol,
      });
    } else {
      manualCloseRequestsRef.current.delete(requestId);
    }
  };

  const toggleMarketScannerMode = (): void => {
    const requestId = createClientId();

    if (
      sendCommand({
        type: 'setMarketScannerMode',
        requestId,
        enabled: !marketScannerAutotradingEnabled,
      })
    ) {
      trackPendingCommand(requestId, { label: 'market-scanner-autotrading' });
    }
  };

  const toggleMarketScannerFeed = (): void => {
    const requestId = createClientId();

    if (
      sendCommand({
        type: 'setMarketScannerFeed',
        requestId,
        enabled: !marketScannerFeedEnabled,
      })
    ) {
      trackPendingCommand(requestId, { label: 'market-scanner-feed' });
    }
  };

  const openManualScannerPosition = (symbol: string, side: PositionSide): void => {
    const requestId = createClientId();

    if (
      sendCommand({
        type: 'openManualScannerPosition',
        requestId,
        symbol,
        side,
      })
    ) {
      trackPendingCommand(requestId, { label: `scanner:${symbol}:${side}` });
    }
  };

  return (
    <main className="app-shell">
      <div className="toast-layer" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>
            <span className="toast-dot" aria-hidden="true" />
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
      <div className="close-effects-layer" aria-hidden="true">
        {closeEffects.map((effect) => (
          <img
            key={effect.id}
            className="close-effect"
            src={effect.gifUrl}
            style={
              {
                left: `${effect.left}px`,
                top: `${effect.top}px`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div
        ref={splitLayoutRef}
        className={`dashboard-layout ${isResizingSplit ? 'is-resizing' : ''}`}
        style={{ '--dashboard-pane-width': `${splitRatio}%` } as CSSProperties}
      >
        <section className="dashboard-pane" aria-label="Command Center">
          <section className="topbar">
            <div>
              <p className="eyebrow">SioBot</p>
              <h1>Command Center</h1>
            </div>
            <div className="topbar-actions">
              <button
                className={`tragaperras-button ${marketScannerAutotradingEnabled ? 'on' : 'off'}`}
                disabled={!isOnline || marketScannerAutotradingCommandPending}
                onClick={toggleMarketScannerMode}
                title={marketScannerAutotradingEnabled ? 'Pause bot' : 'Resume bot'}
              >
                {marketScannerAutotradingEnabled ? 'PAUSE BOT' : 'RESUME BOT'}
              </button>
              <button
                className="icon-button theme-button"
                title="Toggle theme"
                onClick={toggleTheme}
              >
                {theme === 'dark' ? 'Light' : 'Dark'}
              </button>
              <span className={`status ${status}`}>{statusLabel(status)}</span>
              <button
                className="icon-button"
                title="Sync positions"
                disabled={!isOnline}
                onClick={syncPositions}
              >
                ↻
              </button>
            </div>
          </section>

          <section className="metrics-grid">
            <MetricCard
              label="Balance"
              value={money(snapshot?.balance.total)}
              detail="USDT total"
            />
            <MetricCard
              label="Open PnL"
              value={money(totalPnl)}
              detail={`${positions.length} positions`}
            />
          </section>

          {lastError ? <section className="alert">{lastError}</section> : null}

          <section className="positions-panel">
            <div className="panel-header">
              <div>
                <h2>Open positions</h2>
                <p>{snapshot ? formatTime(snapshot.updatedAt) : '-'}</p>
              </div>
              <span>
                {snapshot?.bot.mode ?? '-'} · {snapshot?.bot.state ?? '-'}
              </span>
            </div>
            {positions.length > 0 ? (
              <PositionsTable
                positions={positions}
                pendingCommands={pendingCommands}
                isOnline={isOnline}
                onClosePosition={closePosition}
              />
            ) : (
              <EmptyState />
            )}
            <MarketScannerPanel
              snapshot={scannerDisplaySnapshot}
              isEnabled={marketScannerFeedEnabled}
              togglePending={marketScannerFeedCommandPending}
              isOnline={isOnline}
              onToggleEnabled={toggleMarketScannerFeed}
              openPositions={positions}
              positionHistory={positionHistory}
              cooldownSeconds={snapshot?.bot.assetAutoReentryCooldownSeconds ?? 0}
              sortKey={scannerSortKey}
              onSortKeyChange={setScannerSortKey}
              pendingCommands={pendingCommands}
              onOpenManualPosition={openManualScannerPosition}
            />
          </section>
        </section>

        <div
          className="split-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize command center and side panels"
          onPointerDown={beginSplitResize}
        />

        <aside
          className={`right-rail ${rightPanel === null ? 'panel-closed' : ''}`}
          aria-label="Right side toolbar"
        >
          <div className="side-toolbar" role="toolbar" aria-label="Command Center side panels">
            <button
              className={`side-toolbar-button ${rightPanel === 'journal' ? 'active' : ''}`}
              type="button"
              title="Abrir trading journal"
              aria-label="Abrir trading journal"
              aria-pressed={rightPanel === 'journal'}
              onClick={() => toggleRightPanel('journal')}
            >
              <i className="fa-solid fa-book-open" aria-hidden="true" />
            </button>
            <button
              className={`side-toolbar-button ${rightPanel === 'history' ? 'active' : ''}`}
              type="button"
              title="Abrir histórico de posiciones"
              aria-label="Abrir histórico de posiciones"
              aria-pressed={rightPanel === 'history'}
              onClick={() => toggleRightPanel('history')}
            >
              <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
            </button>
          </div>

          <section className={`side-panel ${rightPanel === null ? 'is-collapsed' : ''}`}>
            {rightPanel === 'journal' ? (
              <JournalPanel
                journalData={journalData}
                isLoading={journalLoading}
                loadError={journalLoadError}
                isOnline={isOnline}
                onRefresh={fetchJournalData}
              />
            ) : null}
            {rightPanel === 'history' ? <PositionHistoryPanel positions={positionHistory} /> : null}
          </section>
        </aside>
      </div>
    </main>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}): ReactNode {
  const valueClass = value.startsWith('-') ? 'negative' : value.startsWith('+') ? 'positive' : '';

  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong className={valueClass}>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function MarketScannerPanel({
  snapshot,
  isEnabled,
  togglePending,
  isOnline,
  onToggleEnabled,
  openPositions,
  positionHistory,
  cooldownSeconds,
  sortKey,
  onSortKeyChange,
  pendingCommands,
  onOpenManualPosition,
}: {
  snapshot: MarketScannerSnapshot | null;
  isEnabled: boolean;
  togglePending: boolean;
  isOnline: boolean;
  onToggleEnabled: () => void;
  openPositions: Position[];
  positionHistory: PositionHistoryEntry[];
  cooldownSeconds: number;
  sortKey: ScannerSortKey;
  onSortKeyChange: (value: ScannerSortKey) => void;
  pendingCommands: PendingCommands;
  onOpenManualPosition: (symbol: string, side: PositionSide) => void;
}): ReactNode {
  const latestSnapshotRef = useRef<MarketScannerSnapshot | null>(snapshot);
  const [lockedWinners, setLockedWinners] = useState<string[]>([]);
  const [lockedLosers, setLockedLosers] = useState<string[]>([]);
  const symbolsOnCooldown = new Set<string>();
  const cooldownMs = Math.max(0, cooldownSeconds) * 1000;
  const now = Date.now();

  if (cooldownMs > 0) {
    for (const position of positionHistory) {
      if (position.closeTimestamp + cooldownMs <= now) {
        continue;
      }

      const normalizedSymbol = normalizeSymbolString(position.symbol) ?? position.symbol;
      symbolsOnCooldown.add(normalizedSymbol);
    }
  }

  const excludedSymbols = new Set(
    openPositions.map((position) => normalizeSymbolString(position.symbol) ?? position.symbol)
  );

  for (const symbol of symbolsOnCooldown) {
    excludedSymbols.add(symbol);
  }

  useEffect(() => {
    latestSnapshotRef.current = snapshot;

    if (snapshot === null) {
      setLockedWinners([]);
      setLockedLosers([]);
    }
  }, [snapshot]);

  useEffect(() => {
    const syncRankedSymbols = (): void => {
      const currentSnapshot = latestSnapshotRef.current;
      const symbols = (currentSnapshot?.symbols ?? []).filter((symbol) => {
        const normalizedSymbol = normalizeSymbolString(symbol.symbol) ?? symbol.symbol;
        return !excludedSymbols.has(normalizedSymbol);
      });

      setLockedWinners(
        getSortedScannerSymbols(symbols, sortKey, 'desc')
          .slice(0, SCANNER_ROWS_LIMIT)
          .map((symbol) => symbol.symbol)
      );
      setLockedLosers(
        getSortedScannerSymbols(symbols, sortKey, 'asc')
          .slice(0, SCANNER_ROWS_LIMIT)
          .map((symbol) => symbol.symbol)
      );
    };

    syncRankedSymbols();

    const timer = window.setInterval(syncRankedSymbols, SCANNER_RANK_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [cooldownSeconds, openPositions, positionHistory, sortKey]);

  const symbols = snapshot?.symbols ?? [];
  const symbolsByKey = new Map(symbols.map((symbol) => [symbol.symbol, symbol]));
  const winners = lockedWinners
    .map((symbolKey) => symbolsByKey.get(symbolKey))
    .filter((symbol) => {
      if (!symbol) {
        return false;
      }

      const normalizedSymbol = normalizeSymbolString(symbol.symbol) ?? symbol.symbol;
      return !excludedSymbols.has(normalizedSymbol);
    })
    .filter((symbol): symbol is MarketScannerSymbolStats => Boolean(symbol));
  const losers = lockedLosers
    .map((symbolKey) => symbolsByKey.get(symbolKey))
    .filter((symbol) => {
      if (!symbol) {
        return false;
      }

      const normalizedSymbol = normalizeSymbolString(symbol.symbol) ?? symbol.symbol;
      return !excludedSymbols.has(normalizedSymbol);
    })
    .filter((symbol): symbol is MarketScannerSymbolStats => Boolean(symbol));

  return (
    <section className="scanner-panel">
      <div className="panel-header scanner-panel-header">
        <div>
          <h2>Market scanner</h2>
          <p>
            {!isEnabled
              ? 'Desactivado'
              : snapshot
              ? `${snapshot.activeSymbolsCount}/${snapshot.symbolsCount} activos · ${formatTime(snapshot.timestamp)}`
              : 'Esperando snapshot del scanner'}
          </p>
        </div>
        <div className="scanner-controls">
          <button
            className={`tragaperras-button ${isEnabled ? 'on' : 'off'}`}
            disabled={!isOnline || togglePending}
            onClick={onToggleEnabled}
            title="Activar o desactivar el Market Scanner"
          >
            {isEnabled ? 'ON' : 'OFF'}
          </button>
          <label className="scanner-sort">
            <span>Orden</span>
            <select
              value={sortKey}
              disabled={!isEnabled}
              onChange={(event) => onSortKeyChange(event.target.value as ScannerSortKey)}
            >
              {SCANNER_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {isEnabled && snapshot ? (
        <div className="scanner-grid">
          <ScannerTable
            title="Winners"
            tone="positive"
            symbols={winners}
            sortKey={sortKey}
            pendingCommands={pendingCommands}
            isOnline={isOnline}
            onOpenManualPosition={onOpenManualPosition}
          />
          <ScannerTable
            title="Losers"
            tone="negative"
            symbols={losers}
            sortKey={sortKey}
            pendingCommands={pendingCommands}
            isOnline={isOnline}
            onOpenManualPosition={onOpenManualPosition}
          />
        </div>
      ) : (
        <div className="empty-state scanner-empty-state">
          <h3>{isEnabled ? 'Sin datos del scanner' : 'Market scanner desactivado'}</h3>
        </div>
      )}
    </section>
  );
}

function ScannerTable({
  title,
  tone,
  symbols,
  sortKey,
  pendingCommands,
  isOnline,
  onOpenManualPosition,
}: {
  title: string;
  tone: 'positive' | 'negative';
  symbols: MarketScannerSymbolStats[];
  sortKey: ScannerSortKey;
  pendingCommands: PendingCommands;
  isOnline: boolean;
  onOpenManualPosition: (symbol: string, side: PositionSide) => void;
}): ReactNode {
  const secondaryMetrics = getScannerSecondaryMetrics(sortKey);

  return (
    <section className="scanner-table-card">
      <div className="scanner-table-header">
        <h3>{title}</h3>
        <span className={`scanner-tone ${tone}`}>{getScannerSortLabel(sortKey)}</span>
      </div>
      <div className="table-wrap">
        <table className="scanner-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>{getScannerSortLabel(sortKey)}</th>
              {secondaryMetrics.map((metric) => (
                <th key={metric.key}>{metric.label}</th>
              ))}
              <th>Trades/s</th>
              <th>Imb / Δ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {symbols.map((symbol) => {
              const primaryValue = getScannerMetricValue(symbol, sortKey);
              const primaryClass = primaryValue >= 0 ? 'positive' : 'negative';
              const flowMetrics = getScannerFlowMetrics(symbol);
              const normalizedSymbol = normalizeSymbolString(symbol.symbol) ?? symbol.symbol;
              const isLongPending = hasScannerCommandPending(
                pendingCommands,
                normalizedSymbol,
                'long'
              );
              const isShortPending = hasScannerCommandPending(
                pendingCommands,
                normalizedSymbol,
                'short'
              );
              const actionButtonsDisabled = !isOnline;

              return (
                <tr key={`${title}-${symbol.symbol}`}>
                  <td>
                    <strong>{symbol.symbol}</strong>
                    <span className="muted">{money(symbol.lastPrice)}</span>
                  </td>
                  <td className={primaryClass}>{formatScannerMetric(sortKey, primaryValue)}</td>
                  {secondaryMetrics.map((metric) => {
                    const value = getScannerMetricValue(symbol, metric.key);

                    return (
                      <td key={metric.key} className={value >= 0 ? 'positive' : 'negative'}>
                        {formatPercent(value)}
                      </td>
                    );
                  })}
                  <td>{formatCompactNumber(symbol.tradesPerSecond)}</td>
                  <td className={flowMetrics.imbalance >= 0 ? 'positive' : 'negative'}>
                    {`${formatPercent(flowMetrics.imbalance * 100)} / ${formatSignedCompactNumber(flowMetrics.delta)}`}
                  </td>
                  <td className="scanner-actions-cell">
                    <div
                      className="scanner-actions"
                      role="group"
                      aria-label={`Manual trade ${symbol.symbol}`}
                    >
                      <button
                        className="scanner-action-button long"
                        title={`Abrir LONG manual en ${normalizedSymbol}`}
                        disabled={actionButtonsDisabled || isLongPending}
                        onClick={() => onOpenManualPosition(normalizedSymbol, 'long')}
                      >
                        {isLongPending ? '…' : '🟢'}
                      </button>
                      <button
                        className="scanner-action-button short"
                        title={`Abrir SHORT manual en ${normalizedSymbol}`}
                        disabled={actionButtonsDisabled || isShortPending}
                        onClick={() => onOpenManualPosition(normalizedSymbol, 'short')}
                      >
                        {isShortPending ? '…' : '🔴'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PositionsTable({
  positions,
  pendingCommands,
  isOnline,
  onClosePosition,
}: {
  positions: Position[];
  pendingCommands: PendingCommands;
  isOnline: boolean;
  onClosePosition: (position: Position, event?: ReactMouseEvent<HTMLButtonElement>) => void;
}): ReactNode {
  return (
    <div className="table-wrap">
      <table className="positions-table">
        <colgroup>
          <col className="positions-col-symbol" />
          <col className="positions-col-side" />
          <col className="positions-col-entry" />
          <col className="positions-col-size" />
          <col className="positions-col-margin" />
          <col className="positions-col-pnl" />
          <col className="positions-col-tsl" />
          <col className="positions-col-range" />
          <col className="positions-col-mae" />
          <col className="positions-col-time" />
          <col className="positions-col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Entry</th>
            <th>Size</th>
            <th>Margin</th>
            <th>PnL</th>
            <th>TSL</th>
            <th>Max / Min</th>
            <th>MAE</th>
            <th>Time</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <PositionRow
              key={position.id}
              position={position}
              isOnline={isOnline}
              isPending={isPositionPending(pendingCommands, position.id)}
              onClose={onClosePosition}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const JournalPanel = memo(function JournalPanel({
  journalData,
  isLoading,
  loadError,
  isOnline,
  onRefresh,
}: {
  journalData: JournalData | null;
  isLoading: boolean;
  loadError: string | null;
  isOnline: boolean;
  onRefresh: () => void;
}): ReactNode {
  const [period, setPeriod] = useState<JournalPeriod>('30d');

  const filteredPositions = filterJournalPositionsByPeriod(journalData?.positions ?? [], period);
  const metrics = calculateJournalMetrics(filteredPositions);
  const cumulativePnl = calculateJournalCumulativePnl(filteredPositions);
  const dailyStats = groupJournalPositionsByDay(filteredPositions);
  const dailyEntries = Object.values(dailyStats).sort((left, right) =>
    right.date.localeCompare(left.date)
  );

  return (
    <>
      <div className="side-panel-header journal-panel-header">
        <div>
          <p className="eyebrow">Journal</p>
          <h2>Trading journal</h2>
        </div>
        <div className="journal-panel-actions">
          <button
            className="icon-button journal-refresh-button"
            type="button"
            disabled={!isOnline || isLoading}
            onClick={onRefresh}
            title={journalData ? 'Refresh trading journal' : 'Load trading journal'}
          >
            <i
              className={`fa-solid ${isLoading ? 'fa-spinner fa-spin' : 'fa-rotate-right'}`}
              aria-hidden="true"
            />
            <span>{journalData ? 'Refresh' : 'Load'}</span>
          </button>
          {journalData ? <span>{formatIsoDateTime(journalData.generatedAt)}</span> : null}
        </div>
      </div>

      {journalData ? (
        <div className="journal-panel-scroll">
          {loadError ? (
            <div className="alert journal-alert" role="alert">
              {loadError}
            </div>
          ) : null}
          <div className="journal-period-tabs" role="tablist" aria-label="Trading journal period">
            {JOURNAL_PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`journal-period-tab ${period === option.value ? 'active' : ''}`}
                type="button"
                role="tab"
                aria-selected={period === option.value}
                onClick={() => setPeriod(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="journal-metrics-grid">
            <JournalMetricCard label="Net PnL" value={money(metrics.netPnl)} tone={metrics.netPnl} />
            <JournalMetricCard
              label="Profit factor"
              value={formatJournalFactor(metrics.profitFactor)}
              tone={metrics.profitFactor - 1}
            />
            <JournalMetricCard
              label="Win rate"
              value={formatJournalPercent(metrics.winRate)}
              tone={metrics.winRate - 50}
            />
            <JournalMetricCard
              label="Trades"
              value={String(metrics.totalTrades)}
              detail={`${metrics.winCount}W / ${metrics.lossCount}L`}
            />
          </div>

          <section className="journal-section">
            <div className="journal-section-header">
              <h3>Cumulative PnL</h3>
              <span>{cumulativePnl.length} points</span>
            </div>
            <JournalCumulativeChart data={cumulativePnl} />
          </section>

          <section className="journal-section">
            <div className="journal-section-header">
              <h3>Daily breakdown</h3>
              <span>{dailyEntries.length} days</span>
            </div>
            {dailyEntries.length > 0 ? (
              <JournalCalendar dailyStats={dailyStats} />
            ) : (
              <div className="empty-state side-panel-empty-state">
                <h3>No journal activity in this period</h3>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="empty-state side-panel-empty-state journal-empty-state">
          <div className="journal-empty-icon" aria-hidden="true">
            <i className="fa-solid fa-book-open" />
          </div>
          <div className="journal-empty-copy">
            <h3>{isLoading ? 'Loading trading journal' : 'Trading Journal available on demand'}</h3>
            <p>
              The Trading Journal gives you a structured view of closed trades, cumulative PnL,
              daily performance, and win/loss behavior so you can review execution quality instead
              of just raw position history.
            </p>
            <p>{loadError ?? 'Load it only when you want to inspect performance and past trades.'}</p>
          </div>
          <button
            className="journal-empty-cta"
            type="button"
            disabled={!isOnline || isLoading}
            onClick={onRefresh}
          >
            <i
              className={`fa-solid ${isLoading ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'}`}
              aria-hidden="true"
            />
            <span>{isLoading ? 'Loading journal…' : 'Load trading journal'}</span>
          </button>
        </div>
      )}
    </>
  );
});

function JournalCalendar({
  dailyStats,
}: {
  dailyStats: Record<string, JournalDayStats>;
}): ReactNode {
  const availableDates = Object.keys(dailyStats).sort();
  const latestDate = availableDates[availableDates.length - 1];
  const initialMonthDate = latestDate ? new Date(`${latestDate}T00:00:00`) : new Date();
  const [displayMonth, setDisplayMonth] = useState<Date>(
    () => new Date(initialMonthDate.getFullYear(), initialMonthDate.getMonth(), 1)
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(latestDate ?? null);

  useEffect(() => {
    const nextLatestDate = availableDates[availableDates.length - 1];
    const nextMonthDate = nextLatestDate ? new Date(`${nextLatestDate}T00:00:00`) : new Date();

    setDisplayMonth(new Date(nextMonthDate.getFullYear(), nextMonthDate.getMonth(), 1));
    setSelectedDate(nextLatestDate ?? null);
  }, [availableDates.join('|')]);

  const year = displayMonth.getFullYear();
  const month = displayMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const cells: ReactNode[] = [];

  for (let index = 0; index < firstDay; index += 1) {
    cells.push(<div key={`empty-${index}`} className="journal-calendar-day empty" />);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayStats = dailyStats[dateKey];
    const isToday =
      today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
    const isSelected = selectedDate === dateKey;
    const toneClass =
      dayStats == null ? '' : dayStats.totalPnl >= 0 ? 'positive' : 'negative';

    cells.push(
      <button
        key={dateKey}
        className={[
          'journal-calendar-day',
          dayStats ? 'has-trades' : '',
          toneClass,
          isToday ? 'today' : '',
          isSelected ? 'selected' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        type="button"
        disabled={!dayStats}
        onClick={() => setSelectedDate(dateKey)}
      >
        <span className="journal-calendar-day-number">{day}</span>
        {dayStats ? (
          <>
            <strong className="journal-calendar-day-pnl">{money(dayStats.totalPnl)}</strong>
            <span className="journal-calendar-day-count">{`${dayStats.tradeCount} trades`}</span>
          </>
        ) : null}
      </button>
    );
  }

  const selectedDay = selectedDate ? dailyStats[selectedDate] ?? null : null;

  return (
    <div className="journal-calendar-shell">
      <div className="journal-calendar-header">
        <strong>{formatMonthLabel(displayMonth)}</strong>
        <div className="journal-calendar-nav">
          <button type="button" onClick={() => setDisplayMonth(addMonths(displayMonth, -1))}>
            ‹
          </button>
          <button type="button" onClick={() => setDisplayMonth(addMonths(displayMonth, 1))}>
            ›
          </button>
        </div>
      </div>

      <div className="journal-calendar-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
          <div key={label} className="journal-calendar-weekday">
            {label}
          </div>
        ))}
        {cells}
      </div>

      {selectedDay ? (
        <div className="journal-calendar-detail">
          <div className="journal-calendar-detail-header">
            <strong>{selectedDay.date}</strong>
            <span>{`${selectedDay.tradeCount} trades · ${money(selectedDay.totalPnl)}`}</span>
          </div>
          <div className="journal-calendar-detail-list">
            {selectedDay.positions
              .slice()
              .sort((left, right) => right.closeTimestamp - left.closeTimestamp)
              .map((position) => (
                <article key={position.id} className="journal-calendar-detail-item">
                  <div>
                    <strong>{`${position.symbol} ${position.side.toUpperCase()} ${position.leverage}x`}</strong>
                    <span>{`${formatTime(position.openTimestamp)} → ${formatTime(position.closeTimestamp)}`}</span>
                  </div>
                  <b className={position.realizedPnl >= 0 ? 'positive' : 'negative'}>
                    {money(position.realizedPnl)}
                  </b>
                </article>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function JournalMetricCard({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: string;
  tone?: number;
  detail?: string;
}): ReactNode {
  const toneClass = tone == null ? '' : tone > 0 ? 'positive' : tone < 0 ? 'negative' : '';

  return (
    <article className="journal-metric-card">
      <span>{label}</span>
      <strong className={toneClass}>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function JournalCumulativeChart({
  data,
}: {
  data: Array<{ date: string; pnl: number }>;
}): ReactNode {
  if (data.length === 0) {
    return (
      <div className="journal-chart-empty">
        <span>No data for this period</span>
      </div>
    );
  }

  const width = 640;
  const height = 180;
  const padding = 16;
  const values = data.map((point) => point.pnl);
  const minValue = Math.min(...values, 0);
  const maxValue = Math.max(...values, 0);
  const range = Math.max(1, maxValue - minValue);
  const stepX = data.length === 1 ? 0 : (width - padding * 2) / (data.length - 1);
  const zeroY = height - padding - ((0 - minValue) / range) * (height - padding * 2);
  const linePath = data
    .map((point, index) => {
      const x = padding + stepX * index;
      const y = height - padding - ((point.pnl - minValue) / range) * (height - padding * 2);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
  const areaPath = `${linePath} L ${padding + stepX * (data.length - 1)} ${height - padding} L ${padding} ${height - padding} Z`;
  const lastValue = values[values.length - 1] ?? 0;
  const toneClass = lastValue >= 0 ? 'positive' : 'negative';

  return (
    <div className="journal-chart-shell">
      <svg viewBox={`0 0 ${width} ${height}`} className={`journal-chart ${toneClass}`} role="img">
        <line x1={padding} y1={zeroY} x2={width - padding} y2={zeroY} className="journal-chart-zero" />
        <path d={areaPath} className="journal-chart-area" />
        <path d={linePath} className="journal-chart-line" />
      </svg>
      <div className="journal-chart-footer">
        <span>{data[0]?.date}</span>
        <b className={toneClass}>{money(lastValue)}</b>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function PositionHistoryPanel({ positions }: { positions: PositionHistoryEntry[] }): ReactNode {
  return (
    <>
      <div className="side-panel-header">
        <div>
          <p className="eyebrow">History</p>
          <h2>Closed positions</h2>
        </div>
        <span>{positions.length} trades</span>
      </div>

      {positions.length > 0 ? (
        <div className="table-wrap side-panel-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Side</th>
                <th>Entry / Close</th>
                <th>Size / Margin</th>
                <th>PnL</th>
                <th>Max / Min PnL</th>
                <th>MAE</th>
                <th>Closed</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => {
                const pnlClass = position.realizedPnl >= 0 ? 'positive' : 'negative';
                const size = position.quantity * position.entryPrice;
                const rowClass =
                  position.realizedPnl >= 0
                    ? 'history-row history-row-positive'
                    : 'history-row history-row-negative';

                return (
                  <tr key={position.id} className={rowClass}>
                    <td>
                      <strong>{position.symbol}</strong>
                    </td>
                    <td>
                      <span className={`side ${position.side}`}>
                        {position.side.toUpperCase()} {position.leverage}x
                      </span>
                    </td>
                    <td>
                      <strong>{money(position.entryPrice)}</strong>
                      <span className="muted">{money(position.closePrice)}</span>
                    </td>
                    <td>
                      <strong>{money(size)}</strong>
                      <span className="muted">{money(position.margin)}</span>
                    </td>
                    <td className={`pnl-cell ${pnlClass}`}>{money(position.realizedPnl)}</td>
                    <td className="history-pnl-range-cell">
                      <span className={position.maxPnl >= 0 ? 'positive' : 'negative'}>
                        {money(position.maxPnl)}
                      </span>
                      <span className="negative">{money(position.minPnl)}</span>
                    </td>
                    <td>{position.mae.toFixed(2)}%</td>
                    <td>
                      <strong>{formatDate(position.closeTimestamp)}</strong>
                      <span className="muted">{formatTime(position.closeTimestamp)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state side-panel-empty-state">
          <h3>No closed positions yet</h3>
        </div>
      )}
    </>
  );
}

function PositionRow({
  position,
  isOnline,
  isPending,
  onClose,
}: {
  position: Position;
  isOnline: boolean;
  isPending: boolean;
  onClose: (position: Position, event?: ReactMouseEvent<HTMLButtonElement>) => void;
}): ReactNode {
  const pnlClass = position.realizedPnl >= 0 ? 'positive' : 'negative';
  const size = position.quantity * position.entryPrice;
  const trailingStopLoss = getPreviousExecutedTrailingStopLoss(position);
  const trailingPnl = trailingStopLoss?.params.trailingPnl;
  const tslClass = trailingPnl == null ? '' : trailingPnl >= 0 ? 'positive' : 'negative';

  return (
    <tr>
      <td>
        <strong>{position.symbol}</strong>
      </td>
      <td>
        <span className={`side ${position.side}`}>
          {position.side.toUpperCase()} {position.leverage}x
        </span>
      </td>
      <td>{position.entryPrice}</td>
      <td>{money(size)}</td>
      <td>{money(position.margin)}</td>
      <td className={`pnl-cell ${pnlClass}`}>{money(position.realizedPnl)}</td>
      <td className={`tsl-cell ${tslClass}`}>{money(trailingPnl)}</td>
      <td>
        {money(position.maxRealizedPnl)} / {money(position.minRealizedPnl)}
      </td>
      <td>{position.mae.toFixed(2)}%</td>
      <td>{duration(position.openTimestamp, Date.now())}</td>
      <td className="actions">
        <button
          className={`danger-button ${pnlClass}`}
          disabled={!isOnline || isPending}
          onClick={(event) => {
            onClose(position, event);
          }}
        >
          {isPending ? 'Closing' : 'Close'}
        </button>
      </td>
    </tr>
  );
}

function EmptyState(): ReactNode {
  return (
    <div className="empty-state">
      <h3>No open positions</h3>
    </div>
  );
}

function getSortedScannerSymbols(
  symbols: MarketScannerSymbolStats[],
  sortKey: ScannerSortKey,
  direction: 'asc' | 'desc'
): MarketScannerSymbolStats[] {
  const multiplier = direction === 'desc' ? -1 : 1;

  return [...symbols].sort((left, right) => {
    const leftValue = sanitizeScannerMetricValue(getScannerMetricValue(left, sortKey));
    const rightValue = sanitizeScannerMetricValue(getScannerMetricValue(right, sortKey));

    if (leftValue !== rightValue) {
      return (leftValue - rightValue) * multiplier;
    }

    return left.symbol.localeCompare(right.symbol);
  });
}

function getScannerMetricValue(symbol: MarketScannerSymbolStats, sortKey: ScannerSortKey): number {
  switch (sortKey) {
    case 'priceChange1mPct':
      return sanitizeScannerMetricValue(symbol.priceChange1mPct);
    case 'priceChange15mPct':
      return sanitizeScannerMetricValue(symbol.priceChange15mPct);
    case 'priceChange5mPct':
      return sanitizeScannerMetricValue(symbol.priceChange5mPct);
    case 'volumeDeltaImbalance':
      return symbol.volumeDeltaImbalance ?? 0;
    case 'tradesPerSecond':
      return symbol.tradesPerSecond;
    case 'totalVolume':
      return symbol.totalVolume;
  }
}

function getScannerSecondaryMetrics(
  sortKey: ScannerSortKey
): Array<{ key: ScannerTimeframeMetricKey; label: string }> {
  if (
    sortKey === 'priceChange1mPct' ||
    sortKey === 'priceChange15mPct' ||
    sortKey === 'priceChange5mPct'
  ) {
    return SCANNER_TIMEFRAME_COLUMNS.filter((metric) => metric.key !== sortKey);
  }

  return SCANNER_TIMEFRAME_COLUMNS;
}

function getScannerFlowMetrics(symbol: MarketScannerSymbolStats): {
  imbalance: number;
  delta: number;
} {
  const delta = symbol.volumeDelta ?? symbol.buyVolume - symbol.sellVolume;

  if (
    typeof symbol.volumeDeltaImbalance === 'number' &&
    Number.isFinite(symbol.volumeDeltaImbalance)
  ) {
    return {
      imbalance: symbol.volumeDeltaImbalance,
      delta,
    };
  }

  const totalVolume = symbol.totalVolume;
  return {
    imbalance: totalVolume > 0 ? delta / totalVolume : 0,
    delta,
  };
}

function sanitizeScannerMetricValue(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getScannerSortLabel(sortKey: ScannerSortKey): string {
  return SCANNER_SORT_OPTIONS.find((option) => option.value === sortKey)?.label ?? sortKey;
}

function formatScannerMetric(sortKey: ScannerSortKey, value: number): string {
  if (sortKey === 'volumeDeltaImbalance') {
    return formatPercent(value * 100);
  }

  if (
    sortKey === 'priceChange1mPct' ||
    sortKey === 'priceChange15mPct' ||
    sortKey === 'priceChange5mPct'
  ) {
    return formatPercent(value);
  }

  return formatCompactNumber(value);
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }

  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatCompactNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }

  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(value);
  }

  return value.toFixed(2);
}

function formatSignedCompactNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }

  const formatted = formatCompactNumber(value);
  return value > 0 ? `+${formatted}` : formatted;
}

function filterJournalPositionsByPeriod(
  positions: JournalPosition[],
  period: JournalPeriod
): JournalPosition[] {
  if (period === 'all') {
    return positions;
  }

  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);

  const startDate = new Date(endDate);
  if (period === 'today') {
    startDate.setHours(0, 0, 0, 0);
  } else if (period === '7d') {
    startDate.setDate(startDate.getDate() - 7);
    startDate.setHours(0, 0, 0, 0);
  } else if (period === '30d') {
    startDate.setDate(startDate.getDate() - 30);
    startDate.setHours(0, 0, 0, 0);
  } else {
    startDate.setFullYear(startDate.getFullYear() - 1);
    startDate.setHours(0, 0, 0, 0);
  }
  const startTimestamp = startDate.getTime();

  return positions.filter((position) => position.closeTimestamp >= startTimestamp);
}

function calculateJournalMetrics(positions: JournalPosition[]): JournalMetrics {
  if (positions.length === 0) {
    return {
      netPnl: 0,
      totalTrades: 0,
      winCount: 0,
      lossCount: 0,
      winRate: 0,
      profitFactor: 0,
      avgWin: 0,
      avgLoss: 0,
      avgWinLossRatio: 0,
      largestWin: 0,
      largestLoss: 0,
      avgTradePnl: 0,
      avgMae: 0,
    };
  }

  const wins = positions.filter((position) => position.realizedPnl > 0);
  const losses = positions.filter((position) => position.realizedPnl <= 0);
  const netPnl = positions.reduce((sum, position) => sum + position.realizedPnl, 0);
  const totalWins = wins.reduce((sum, position) => sum + position.realizedPnl, 0);
  const totalLosses = Math.abs(
    losses.reduce((sum, position) => sum + position.realizedPnl, 0)
  );
  const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;

  return {
    netPnl,
    totalTrades: positions.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: (wins.length / positions.length) * 100,
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
    avgWin,
    avgLoss,
    avgWinLossRatio: avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0,
    largestWin: wins.length > 0 ? Math.max(...wins.map((position) => position.realizedPnl)) : 0,
    largestLoss:
      losses.length > 0 ? Math.min(...losses.map((position) => position.realizedPnl)) : 0,
    avgTradePnl: netPnl / positions.length,
    avgMae: positions.reduce((sum, position) => sum + position.mae, 0) / positions.length,
  };
}

function groupJournalPositionsByDay(
  positions: JournalPosition[]
): Record<string, JournalDayStats> {
  return positions.reduce<Record<string, JournalDayStats>>((accumulator, position) => {
    const date = new Date(position.closeTimestamp).toISOString().split('T')[0]!;
    const currentDay = accumulator[date] ?? {
      date,
      tradeCount: 0,
      winCount: 0,
      lossCount: 0,
      totalPnl: 0,
      positions: [],
    };

    currentDay.tradeCount += 1;
    currentDay.totalPnl += position.realizedPnl;
    currentDay.positions.push(position);

    if (position.realizedPnl > 0) {
      currentDay.winCount += 1;
    } else {
      currentDay.lossCount += 1;
    }

    accumulator[date] = currentDay;
    return accumulator;
  }, {});
}

function calculateJournalCumulativePnl(
  positions: JournalPosition[]
): Array<{ date: string; pnl: number }> {
  const dailyStats = groupJournalPositionsByDay(positions);
  const dates = Object.keys(dailyStats).sort();
  const cumulative: Array<{ date: string; pnl: number }> = [];
  let runningPnl = 0;

  for (const date of dates) {
    runningPnl += dailyStats[date]!.totalPnl;
    cumulative.push({
      date,
      pnl: runningPnl,
    });
  }

  return cumulative;
}

function getInitialTheme(): Theme {
  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return savedTheme === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function getInitialSplitRatio(): number {
  try {
    const savedRatio = Number(window.localStorage.getItem(SPLIT_RATIO_STORAGE_KEY));
    if (Number.isFinite(savedRatio)) {
      return clamp(savedRatio, MIN_SPLIT_RATIO, MAX_SPLIT_RATIO);
    }
  } catch {
    return 58;
  }

  return 58;
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    return;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createClientId(): string {
  if (typeof window.crypto?.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }

  const randomValues = new Uint32Array(4);

  if (typeof window.crypto?.getRandomValues === 'function') {
    window.crypto.getRandomValues(randomValues);
  } else {
    for (let i = 0; i < randomValues.length; i += 1) {
      randomValues[i] = Math.floor(Math.random() * 0xffffffff);
    }
  }

  return Array.from(randomValues, (value) => value.toString(16).padStart(8, '0')).join('-');
}

function isPositionPending(pendingCommands: PendingCommands, positionId: string): boolean {
  return Object.values(pendingCommands).some((command) => command.positionId === positionId);
}

function hasScannerCommandPending(
  pendingCommands: PendingCommands,
  symbol: string,
  side: PositionSide
): boolean {
  return Object.values(pendingCommands).some(
    (command) => command.label === `scanner:${symbol}:${side}`
  );
}

function normalizeSymbolString(symbol: string): string | null {
  const normalizedSymbol = symbol.replace('/', '');
  return normalizedSymbol.split(':')[0] ?? null;
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const rest = { ...record };
  delete rest[key];
  return rest;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === 'string' && payload.error.length > 0) {
      return payload.error;
    }
  } catch {
    return JOURNAL_FETCH_ERROR;
  }

  return JOURNAL_FETCH_ERROR;
}

function getPreviousExecutedTrailingStopLoss(
  position: Position
): RiskStrategyActionExecuted | undefined {
  const trailingStopLossStrategies = position.riskStrategiesExecuted?.filter(
    (riskStrategy) => riskStrategy.action === 'TRAILING_STOP_LOSS'
  );

  if (!trailingStopLossStrategies || trailingStopLossStrategies.length === 0) {
    return undefined;
  }

  return trailingStopLossStrategies[trailingStopLossStrategies.length - 1];
}

function money(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '-';
  }

  const prefix = value > 0 ? '+' : '';
  return `${prefix}${moneyFormatter.format(value)}`;
}

function duration(startMs: number, endMs: number): string {
  const totalSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
  }).format(timestamp);
}

function formatIsoDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatJournalPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatJournalFactor(value: number): string {
  if (!Number.isFinite(value)) {
    return '∞';
  }

  return value.toFixed(2);
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function formatMonthLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function statusLabel(currentStatus: ConnectionStatus): string {
  if (currentStatus === 'online') {
    return 'Online';
  }

  if (currentStatus === 'connecting') {
    return 'Connecting';
  }

  return 'Offline';
}

const appRoot = document.querySelector<HTMLElement>('#app');

if (!appRoot) {
  throw new Error('Missing #app root element');
}

createRoot(appRoot).render(<App />);
