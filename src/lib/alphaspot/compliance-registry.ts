// Shariah Compliance Classification Registry
//
// Classifies assets based on Shariah principles:
//   • Utility Test — does the token have genuine utility beyond speculation?
//   • Interest-Based Lending — is the token tied to a lending/borrowing protocol?
//   • Gambling — is the token associated with gambling or pure speculation?
//   • Derivatives — is the token tied to futures/options/perpetuals?
//
// Classification categories:
//   COMPLIANT — passes the utility test, no prohibited use cases
//   HARAM     — fails one or more Shariah tests (lending, gambling, derivatives)
//   PENDING   — not yet reviewed (conservative default: excluded in Shariah mode)

export type ComplianceCategory = 'COMPLIANT' | 'HARAM' | 'PENDING'

export interface ComplianceClassification {
  base: string // e.g. "BTC"
  category: ComplianceCategory
  reason: string
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANT — Passes Utility Test
// These tokens power genuine blockchain networks (gas, staking, governance
// of non-lending protocols, payments, oracle services, storage).
// ─────────────────────────────────────────────────────────────────────────────

const COMPLIANT_ASSETS: ComplianceClassification[] = [
  { base: 'BTC', category: 'COMPLIANT', reason: 'Passes Utility Test — decentralized store of value and payment network' },
  { base: 'ETH', category: 'COMPLIANT', reason: 'Passes Utility Test — smart contract platform gas token' },
  { base: 'BNB', category: 'COMPLIANT', reason: 'Passes Utility Test — BNB Chain gas + exchange utility token' },
  { base: 'SOL', category: 'COMPLIANT', reason: 'Passes Utility Test — Solana blockchain gas token' },
  { base: 'XRP', category: 'COMPLIANT', reason: 'Passes Utility Test — cross-border payment settlement token' },
  { base: 'ADA', category: 'COMPLIANT', reason: 'Passes Utility Test — Cardano blockchain gas + staking' },
  { base: 'AVAX', category: 'COMPLIANT', reason: 'Passes Utility Test — Avalanche blockchain gas token' },
  { base: 'DOT', category: 'COMPLIANT', reason: 'Passes Utility Test — Polkadot governance + staking' },
  { base: 'LINK', category: 'COMPLIANT', reason: 'Passes Utility Test — Chainlink oracle service payment' },
  { base: 'LTC', category: 'COMPLIANT', reason: 'Passes Utility Test — peer-to-peer payment currency' },
  { base: 'BCH', category: 'COMPLIANT', reason: 'Passes Utility Test — peer-to-peer electronic cash' },
  { base: 'ATOM', category: 'COMPLIANT', reason: 'Passes Utility Test — Cosmos Hub staking + governance' },
  { base: 'NEAR', category: 'COMPLIANT', reason: 'Passes Utility Test — NEAR Protocol gas token' },
  { base: 'APT', category: 'COMPLIANT', reason: 'Passes Utility Test — Aptos blockchain gas token' },
  { base: 'ARB', category: 'COMPLIANT', reason: 'Passes Utility Test — Arbitrum DAO governance token' },
  { base: 'OP', category: 'COMPLIANT', reason: 'Passes Utility Test — Optimism Collective governance token' },
  { base: 'FIL', category: 'COMPLIANT', reason: 'Passes Utility Test — Filecoin storage payment token' },
  { base: 'INJ', category: 'COMPLIANT', reason: 'Passes Utility Test — Injective blockchain gas + staking' },
  { base: 'SUI', category: 'COMPLIANT', reason: 'Passes Utility Test — Sui blockchain gas token' },
  { base: 'SEI', category: 'COMPLIANT', reason: 'Passes Utility Test — Sei blockchain gas token' },
  { base: 'TIA', category: 'COMPLIANT', reason: 'Passes Utility Test — Celestia data availability staking' },
  { base: 'RUNE', category: 'COMPLIANT', reason: 'Passes Utility Test — THORChain native settlement asset' },
  { base: 'ALGO', category: 'COMPLIANT', reason: 'Passes Utility Test — Algorand blockchain gas token' },
  { base: 'EGLD', category: 'COMPLIANT', reason: 'Passes Utility Test — MultiversX blockchain gas token' },
  { base: 'FLOW', category: 'COMPLIANT', reason: 'Passes Utility Test — Flow blockchain gas token' },
  { base: 'XTZ', category: 'COMPLIANT', reason: 'Passes Utility Test — Tezos blockchain gas + staking' },
  { base: 'KAVA', category: 'COMPLIANT', reason: 'Passes Utility Test — Kava blockchain gas + staking' },
  { base: 'ZIL', category: 'COMPLIANT', reason: 'Passes Utility Test — Zilliqa blockchain gas token' },
  { base: 'ICP', category: 'COMPLIANT', reason: 'Passes Utility Test — Internet Computer compute cycles' },
  { base: 'HBAR', category: 'COMPLIANT', reason: 'Passes Utility Test — Hedera transaction fee token' },
  { base: 'VET', category: 'COMPLIANT', reason: 'Passes Utility Test — VeChain supply chain utility' },
  { base: 'THETA', category: 'COMPLIANT', reason: 'Passes Utility Test — Theta video delivery network' },
  { base: 'GRT', category: 'COMPLIANT', reason: 'Passes Utility Test — The Graph indexing service payment' },
  { base: 'IMX', category: 'COMPLIANT', reason: 'Passes Utility Test — Immutable X NFT marketplace gas' },
  { base: 'STX', category: 'COMPLIANT', reason: 'Passes Utility Test — Stacks blockchain gas token' },
  { base: 'CKB', category: 'COMPLIANT', reason: 'Passes Utility Test — Nervos blockchain gas token' },
  { base: 'MINA', category: 'COMPLIANT', reason: 'Passes Utility Test — Mina Protocol staking + gas' },
  { base: 'ROSE', category: 'COMPLIANT', reason: 'Passes Utility Test — Oasis Network gas + staking' },
  { base: 'ASTR', category: 'COMPLIANT', reason: 'Passes Utility Test — Astar Network gas token' },
  { base: 'GLMR', category: 'COMPLIANT', reason: 'Passes Utility Test — Moonbeam gas token' },
]

// ─────────────────────────────────────────────────────────────────────────────
// HARAM — Fails Shariah Tests
// These tokens fail due to interest-based lending, gambling, derivatives,
// or pure speculative meme tokens with no utility.
// ─────────────────────────────────────────────────────────────────────────────

const HARAM_ASSETS: ComplianceClassification[] = [
  // Interest-Based Lending Protocols
  { base: 'AAVE', category: 'HARAM', reason: 'Fails: Interest-Based Lending Protocol — AAVE is a decentralized lending/borrowing platform where lenders earn interest' },
  { base: 'COMP', category: 'HARAM', reason: 'Fails: Interest-Based Lending Protocol — Compound is a money market protocol with interest-bearing lending' },
  { base: 'MKR', category: 'HARAM', reason: 'Fails: Interest-Based Lending Protocol — MakerDAO issues DAI via collateralized debt positions with stability fees (interest)' },
  { base: 'SNX', category: 'HARAM', reason: 'Fails: Derivatives Protocol — Synthetix mints synthetic assets tracking derivatives' },
  { base: 'GMX', category: 'HARAM', reason: 'Fails: Derivatives Protocol — GMX is a perpetual futures exchange enabling leveraged trading' },
  { base: 'DYDX', category: 'HARAM', reason: 'Fails: Derivatives Protocol — dYdX is a decentralized perpetual futures exchange' },
  { base: 'PERP', category: 'HARAM', reason: 'Fails: Derivatives Protocol — Perpetual Protocol enables leveraged perpetual trading' },
  { base: 'CRV', category: 'HARAM', reason: 'Fails: Interest-Based Lending Protocol — Curve facilitates stablecoin yield farming (interest generation)' },
  { base: 'BAL', category: 'HARAM', reason: 'Fails: Interest-Based Yield — Balancer AMM generates yield from liquidity provision (interest-like returns)' },
  { base: 'SUSHI', category: 'HARAM', reason: 'Fails: Interest-Based Yield — SushiSwap AMM generates yield from liquidity provision' },
  { base: '1INCH', category: 'HARAM', reason: 'Fails: Facilitates Interest-Based Yield — DEX aggregator routing to lending/yield protocols' },
  { base: 'CAKE', category: 'HARAM', reason: 'Fails: Interest-Based Yield — PancakeSwap AMM + staking generates interest-like returns' },
  { base: 'FRAX', category: 'HARAM', reason: 'Fails: Algorithmic Stablecoin — Frax uses fractional-algorithmic mechanism tied to lending' },
  { base: 'LDO', category: 'HARAM', reason: 'Fails: Staking Derivatives — Lido issues stETH (liquid staking derivative), facilitates derivative creation' },
  { base: 'RPL', category: 'HARAM', reason: 'Fails: Staking Derivatives — Rocket Pool liquid staking derivative protocol' },
  // Gambling / Pure Speculation (Meme coins)
  { base: 'DOGE', category: 'HARAM', reason: 'Fails: Speculative Asset — Dogecoin originated as a meme; lacks sufficient utility beyond speculation' },
  { base: 'SHIB', category: 'HARAM', reason: 'Fails: Decentralized Speculation — Shiba Inu is a meme token with no intrinsic utility' },
  { base: 'PEPE', category: 'HARAM', reason: 'Fails: Decentralized Speculation — Pepe is a meme token with zero utility, pure speculation' },
  { base: 'FLOKI', category: 'HARAM', reason: 'Fails: Decentralized Speculation — Floki is a meme token with no genuine utility' },
  { base: 'BONK', category: 'HARAM', reason: 'Fails: Decentralized Speculation — Bonk is a Solana meme token with no utility' },
  { base: 'WIF', category: 'HARAM', reason: 'Fails: Decentralized Speculation — dogwifhat is a Solana meme token with no utility' },
  { base: 'MEME', category: 'HARAM', reason: 'Fails: Decentralized Speculation — Memecoin is explicitly a speculative meme token' },
  { base: 'FET', category: 'HARAM', reason: 'Fails: Decentralized Speculation — Fetch.ai token lacks clear Shariah-compliant utility classification' },
  // Derivatives / Options / Futures
  { base: 'OGN', category: 'HARAM', reason: 'Fails: Interest-Based Yield — Origin Dollar auto-yields via lending' },
  { base: 'XEC', category: 'HARAM', reason: 'Fails: Speculative Asset — eCash lacks sufficient utility beyond speculation' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Build the lookup map
// ─────────────────────────────────────────────────────────────────────────────

const CLASSIFICATION_MAP: Map<string, ComplianceClassification> = new Map()

for (const c of COMPLIANT_ASSETS) CLASSIFICATION_MAP.set(c.base.toUpperCase(), c)
for (const c of HARAM_ASSETS) CLASSIFICATION_MAP.set(c.base.toUpperCase(), c)

/**
 * Classify an asset by its base symbol (e.g. "BTC").
 * Returns COMPLIANT, HARAM, or PENDING (default for unknown assets).
 * In Shariah mode, PENDING assets are conservatively excluded.
 */
export function classifyAsset(base: string): ComplianceClassification {
  const found = CLASSIFICATION_MAP.get(base.toUpperCase())
  if (found) return found
  return {
    base: base.toUpperCase(),
    category: 'PENDING',
    reason: 'Pending compliance review — asset not yet classified',
  }
}

/**
 * Check if an asset is Shariah-compliant.
 * Returns true ONLY for explicitly classified COMPLIANT assets.
 * PENDING and HARAM return false (conservative — capital preservation first).
 */
export function isShariahCompliant(base: string): boolean {
  return classifyAsset(base).category === 'COMPLIANT'
}

/** Get the compliance classification for a canonical symbol (e.g. "BTC/USDT"). */
export function classifySymbol(symbol: string): ComplianceClassification {
  const base = symbol.split('/')[0]
  return classifyAsset(base)
}

/** Export the full classification list for DB seeding. */
export function getAllClassifications(): ComplianceClassification[] {
  return [...COMPLIANT_ASSETS, ...HARAM_ASSETS]
}

/** Stats for observability. */
export function getClassificationStats(): { compliant: number; haram: number; total: number } {
  return {
    compliant: COMPLIANT_ASSETS.length,
    haram: HARAM_ASSETS.length,
    total: COMPLIANT_ASSETS.length + HARAM_ASSETS.length,
  }
}
