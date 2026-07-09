'use client'

import { Activity, Database, Radio, Brain } from 'lucide-react'
import { motion } from 'framer-motion'

const STEPS = [
  { icon: Radio, label: 'Connecting Binance WebSocket', delay: 0 },
  { icon: Database, label: 'Seeding 2,700 historical candles (BTC · ETH · SOL × 15m/1h/4h)', delay: 0.15 },
  { icon: Activity, label: 'Computing multi-timeframe indicators & patterns', delay: 0.3 },
  { icon: Brain, label: 'Warming up LLM reasoning engine', delay: 0.45 },
]

export function BootSplash() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/60 py-16"
    >
      <div className="w-full max-w-md space-y-5 px-6">
        <div className="flex flex-col items-center text-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
            className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg shadow-emerald-900/40"
          >
            <Activity className="h-6 w-6 text-white" strokeWidth={2.5} />
          </motion.div>
          <h2 className="mt-3 text-lg font-bold text-zinc-100">AlphaSpot Engine Booting</h2>
          <p className="text-xs text-zinc-500">Ingesting real-time market data…</p>
        </div>

        <div className="space-y-2.5">
          {STEPS.map((s, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: s.delay }}
              className="flex items-center gap-2.5 rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-3 py-2"
            >
              <s.icon className="h-4 w-4 shrink-0 text-emerald-400" />
              <span className="text-xs text-zinc-300">{s.label}</span>
              <motion.span
                className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
              />
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  )
}
