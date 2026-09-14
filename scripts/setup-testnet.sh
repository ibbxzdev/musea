#!/usr/bin/env bash
#
# One-time (well — once per testnet reset) Stellar testnet bootstrap.
#
# Creates the two project identities, resolves the native XLM Stellar Asset Contract,
# deploys the TipJar contract against it, and prints the environment variables to paste
# into Convex.
#
# Tips move XLM, the network's native asset. That means there is no asset to issue, no
# issuer identity, and no trustline for anyone — the treasury included. Friendbot is the
# faucet. If this ever moves back to an issued asset, the change-trust and mint steps
# removed here are in the git history.
#
# Stellar testnet is wiped roughly quarterly. When that happens every account and contract
# below vanishes and you re-run this script — which is the entire reason it is a script
# and not a page of instructions.
#
# Usage:  ./scripts/setup-testnet.sh
# Needs:  stellar CLI (cargo install --locked stellar-cli), openssl
#
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
SEED_AMOUNT="${SEED_AMOUNT:-100}"

step() { printf "\n\033[1;34m==>\033[0m %s\n" "$1"; }
warn() { printf "\033[1;33mwarning:\033[0m %s\n" "$1" >&2; }
die()  { printf "\033[1;31merror:\033[0m %s\n" "$1" >&2; exit 1; }

command -v stellar >/dev/null 2>&1 || die \
  "stellar CLI not found. Install Rust (https://rustup.rs) then: cargo install --locked stellar-cli"
command -v openssl >/dev/null 2>&1 || die "openssl not found; needed to generate secrets."

# ---------------------------------------------------------------------------
step "Creating and funding identities"
# ---------------------------------------------------------------------------
# No issuer any more: nobody issues XLM. The treasury holds the XLM that seeds new
# wallets, and the deployer owns the TipJar contract.
for name in musea-treasury musea-deployer; do
  if stellar keys address "$name" >/dev/null 2>&1; then
    echo "  $name already exists — reusing"
  else
    echo "  generating $name"
    # No --global: the flag was removed in stellar-cli 28. Identities are stored in the
    # config dir ($XDG_CONFIG_HOME/stellar, else ~/.config/stellar) by default now.
    stellar keys generate "$name" --network "$NETWORK" --fund
  fi
done

TREASURY="$(stellar keys address musea-treasury)"
DEPLOYER="$(stellar keys address musea-deployer)"

echo "  treasury: $TREASURY"
echo "  deployer: $DEPLOYER"

# ---------------------------------------------------------------------------
step "Resolving the native XLM Stellar Asset Contract (SAC)"
# ---------------------------------------------------------------------------
# The native SAC address is derived from the network passphrase, not chosen — every
# network has exactly one and it is the same for everybody. It is normally already
# deployed on testnet, so a failed deploy here is expected and not an error.
if ! XLM_SAC_ID="$(stellar contract asset deploy \
      --asset native \
      --source musea-deployer \
      --network "$NETWORK" 2>/dev/null)"; then
  XLM_SAC_ID="$(stellar contract id asset --asset native --network "$NETWORK")"
  echo "  already deployed — using the existing instance"
fi
echo "  XLM SAC: $XLM_SAC_ID"

# The treasury needs no trustline and no minting: Friendbot funded it with XLM above,
# and XLM is what it hands out. Nothing to do here beyond confirming it has a balance.
step "Checking the treasury balance"
stellar keys fund musea-treasury --network "$NETWORK" 2>/dev/null || true
echo "  treasury funded (Friendbot tops up to 10,000 XLM)"

# ---------------------------------------------------------------------------
step "Building and deploying the TipJar contract"
# ---------------------------------------------------------------------------
( cd "$(dirname "$0")/../contracts/tipjar" && stellar contract build )

WASM="$(dirname "$0")/../contracts/tipjar/target/wasm32v1-none/release/tipjar.wasm"
if [ ! -f "$WASM" ]; then
  # Older toolchains emit to the wasm32-unknown-unknown target directory instead.
  WASM="$(dirname "$0")/../contracts/tipjar/target/wasm32-unknown-unknown/release/tipjar.wasm"
fi
[ -f "$WASM" ] || die "Could not find the built wasm. Run 'stellar contract build' in contracts/tipjar and check the target path."

TIPJAR_CONTRACT_ID="$(stellar contract deploy \
  --wasm "$WASM" \
  --source musea-deployer \
  --network "$NETWORK" \
  -- \
  --token "$XLM_SAC_ID")"
echo "  TipJar: $TIPJAR_CONTRACT_ID"

# ---------------------------------------------------------------------------
step "Environment variables"
# ---------------------------------------------------------------------------
TREASURY_SECRET="$(stellar keys show musea-treasury)"
AUTH_SECRET="$(openssl rand -base64 32)"

cat <<CONFIG

Paste these into the Convex dashboard (Settings -> Environment Variables),
or run each as: npx convex env set NAME 'value'

  STELLAR_NETWORK=$NETWORK
  HORIZON_URL=https://horizon-testnet.stellar.org
  RPC_URL=https://soroban-testnet.stellar.org
  NETWORK_PASSPHRASE=Test SDF Network ; September 2015
  FRIENDBOT_URL=https://friendbot.stellar.org
  XLM_SAC_ID=$XLM_SAC_ID
  TIPJAR_CONTRACT_ID=$TIPJAR_CONTRACT_ID
  TREASURY_PUBLIC=$TREASURY
  TREASURY_SECRET=$TREASURY_SECRET
  SEED_AMOUNT=$SEED_AMOUNT
  BETTER_AUTH_SECRET=$AUTH_SECRET

If you are migrating an existing deployment, remove the variables that no longer
exist, or stellarConfig() will keep validating values nothing reads:
  npx convex env remove USDC_ASSET_CODE
  npx convex env remove USDC_ISSUER
  npx convex env remove USDC_SAC_ID
  npx convex env remove MASTER_ENCRYPTION_KEY

Verify the deploy:
  https://stellar.expert/explorer/testnet/contract/$TIPJAR_CONTRACT_ID

CONFIG
