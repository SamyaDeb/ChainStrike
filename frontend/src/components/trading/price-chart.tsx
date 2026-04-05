"use client";

import { useEffect, useRef, memo, useCallback, useState } from 'react';
import { createChart, ColorType, UTCTimestamp, CandlestickData, IChartApi, ISeriesApi, CandlestickSeries } from 'lightweight-charts';
import { useChartData, Timeframe } from '@/hooks/useChartData';
import type { Candle } from '@/types/common';

interface PriceChartProps {
  height?: number;
}

interface BinanceKlineData {
  k: {
    t: number; // Open time
    T: number; // Close time
    o: string; // Open price
    h: string; // High price
    l: string; // Low price
    c: string; // Close price
    v: string; // Volume
  };
}

function PriceChartComponent({ height = 400 }: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const isConnecting = useRef(false);
  
  const [timeframe, setTimeframe] = useState<Timeframe>('1m');
  
  // Fetch initial chart data
  const { data: chartData, isLoading, error } = useChartData(timeframe);

  // Convert Candle to CandlestickData for lightweight-charts
  const convertToChartData = useCallback((candles: Candle[]): CandlestickData[] => {
    return candles.map(candle => ({
      time: candle.time as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
  }, []);

  // WebSocket connection management
  const connectWebSocket = useCallback(() => {
    if (isConnecting.current || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    isConnecting.current = true;
    
    try {
      // Dynamic WebSocket URL based on timeframe
      const interval = timeframe; 
      const wsUrl = `wss://stream.binance.com:9443/ws/algousdt@kline_${interval}`;
      
      wsRef.current = new WebSocket(wsUrl);
      
      wsRef.current.onopen = () => {
        console.log('✅ WebSocket connected successfully');
        isConnecting.current = false;
        reconnectAttempts.current = 0;
        
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
      };
      
      wsRef.current.onmessage = (event) => {
        try {
          const data: BinanceKlineData = JSON.parse(event.data);
          const kline = data.k;
          
          if (!kline || !seriesRef.current) return;
          
          const candleData: CandlestickData = {
            time: Math.floor(kline.t / 1000) as UTCTimestamp,
            open: parseFloat(kline.o),
            high: parseFloat(kline.h),
            low: parseFloat(kline.l),
            close: parseFloat(kline.c),
          };
          
          // Update the chart with new data
          seriesRef.current.update(candleData);
          
        } catch (error) {
          console.error('❌ Error parsing WebSocket data:', error);
        }
      };
      
      wsRef.current.onerror = () => {
        // WebSocket error events never contain useful info (browser security).
        // The onclose handler will fire next with the actual code/reason.
        isConnecting.current = false;
      };
      
      wsRef.current.onclose = (event) => {
        isConnecting.current = false;
        wsRef.current = null;
        
        // Only reconnect on abnormal closure (not user-initiated)
        if (event.code !== 1000 && reconnectAttempts.current < 5) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          
          if (reconnectAttempts.current === 0) {
            console.warn(`⚠️ Chart WebSocket disconnected. Reconnecting in ${delay / 1000}s...`);
          }
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttempts.current++;
            connectWebSocket();
          }, delay);
        }
      };
      
    } catch {
      isConnecting.current = false;
    }
  }, [timeframe]);

  // Disconnect WebSocket
  const disconnectWebSocket = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    isConnecting.current = false;
    reconnectAttempts.current = 0;
  }, []);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart with optimized settings
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0a0f' },
        textColor: '#9ca3af',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: '#1f2937', style: 1, visible: true },
        horzLines: { color: '#1f2937', style: 1, visible: true },
      },
      crosshair: {
        mode: 1,
        vertLine: { 
          color: '#00FF88', 
          width: 1, 
          style: 2, 
          labelBackgroundColor: '#00FF88' 
        },
        horzLine: { 
          color: '#00FF88', 
          width: 1, 
          style: 2, 
          labelBackgroundColor: '#00FF88' 
        },
      },
      rightPriceScale: {
        borderColor: '#374151',
        textColor: '#9ca3af',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#374151',
        timeVisible: true,
        secondsVisible: timeframe === '1m',
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      kineticScroll: {
        mouse: true,
        touch: true,
      },
    });

    // Create candlestick series with enhanced visuals
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00FF88',
      downColor: '#FF4757', 
      borderUpColor: '#00FF88',
      borderDownColor: '#FF4757',
      wickUpColor: '#00FF88',
      wickDownColor: '#FF4757',
      priceFormat: {
        type: 'price',
        precision: 6,
        minMove: 0.000001,
      },
    });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chart) {
        chart.applyOptions({ 
          width: chartContainerRef.current.clientWidth,
          height: height 
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chart) {
        chart.remove();
      }
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height, timeframe]);

  // Update chart data when initial data loads
  useEffect(() => {
    if (!chartData || !seriesRef.current || chartData.length === 0) return;

    try {
      const formattedData = convertToChartData(chartData);
      seriesRef.current.setData(formattedData);
      
      // Auto-fit chart to data
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent();
      }
      
    } catch (error) {
      console.error('❌ Error setting chart data:', error);
    }
  }, [chartData, convertToChartData]);

  // Manage WebSocket connection
  useEffect(() => {
    connectWebSocket();
    
    return () => {
      disconnectWebSocket();
    };
  }, [connectWebSocket, disconnectWebSocket]);

  // Timeframe selector
  const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

  return (
    <div className="glass-card p-4">
      {/* Header with timeframe selector */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">ALGO/USDT Chart</h3>
        
        {/* Timeframe Selector */}
        <div className="flex items-center gap-1 bg-dark-800 p-1 rounded-lg">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                timeframe === tf
                  ? 'bg-neon-green text-dark-950 font-semibold'
                  : 'text-gray-400 hover:text-white hover:bg-glass'
              }`}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
        
        {/* Connection Status */}
        <div className="flex items-center gap-2 text-sm">
          <div className={`w-2 h-2 rounded-full ${
            wsRef.current?.readyState === WebSocket.OPEN 
              ? 'bg-green-500' 
              : 'bg-red-500'
          }`} />
          <span className="text-gray-400">
            {wsRef.current?.readyState === WebSocket.OPEN ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Chart Container */}
      <div className="relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-dark-900/80 z-10">
            <div className="flex items-center gap-2 text-gray-400">
              <div className="w-4 h-4 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
              Loading chart data...
            </div>
          </div>
        )}
        
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-dark-900/80 z-10">
            <div className="text-center text-red-400">
              <p>Failed to load chart data</p>
              <p className="text-sm text-gray-500 mt-1">Retrying...</p>
            </div>
          </div>
        )}
        
        <div 
          ref={chartContainerRef}
          className="w-full rounded-lg overflow-hidden"
          style={{ height: `${height}px` }}
        />
      </div>
    </div>
  );
}

export const PriceChart = memo(PriceChartComponent);
