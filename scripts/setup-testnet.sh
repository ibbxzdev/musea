#!/usr/bin/env bash
#
# One-time (well — once per testnet reset) Stellar testnet bootstrap.
#
# Creates the three project identities, issues the Musea test USDC asset, deploys its
# Stellar Asset Contract, and prints the environment variables to paste into Convex.
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
TREASURY_MINT="${TREASURY_MINT:-1000000}"

step() { printf "\n\033[1;34m==>\033[0m %s\n" "$1"; }
warn() { printf "\033[1;33mwarning:\033[0m %s\n" "$1" >&2; }
die()  { printf "\033[1;31merror:\033[0m %s\n" "$1" >&2; exit 1; }

command -v stellar >/dev/null 2>&1 || die \
  "stellar CLI not found. Install Rust (https://rustup.rs) then: cargo install --locked stellar-cli"
command -v openssl >/dev/null 2>&1 || die "openssl not found; needed to generate secrets."

# ---------------------------------------------------------------------------
step "Creating and funding identities"
# ---------------------------------------------------------------------------
for name in musea-issuer musea-treasury musea-deployer; do
  if stellar keys address "$name" >/dev/null 2>&1; then
    echo "  $name already exists — reusing"
  else
    echo "  generating $name"
    # No --global: the flag was removed in stellar-cli 28. Identities are stored in the
    # config dir ($XDG_CONFIG_HOME/stellar, else ~/.config/stellar) by default now.
    stellar keys generate "$name" --network "$NETWORK" --fund
  fi
done

ISSUER="$(stellar keys address musea-issuer)"
TREASURY="$(stellar keys address musea-treasury)"
DEPLOYER="$(stellar keys address musea-deployer)"

echo "  issuer:   $ISSUER"
echo "  treasury: $TREASURY"
echo "  deployer: $DEPLOYER"

# ---------------------------------------------------------------------------
step "Deploying the USDC Stellar Asset Contract (SAC)"
# ---------------------------------------------------------------------------
# We issue our own test USDC rather than using Circle's testnet asset, so we control the
# faucet. Switching to Circle's later is a config change, not a code change.
if ! USDC_SAC_ID="$(stellar contract asset deploy \
      --asset "USDC:$ISSUER" \
      --source musea-issuer \
      --network "$NETWORK" 2>/dev/null)"; then
  warn "SAC deploy failed — it may already exist. Fetching its id instead."
  USDC_SAC_ID="$(stellar contract id asset --asset "USDC:$ISSUER" --network "$NETWORK")"
fi
echo "  USDC SAC: $USDC_SAC_ID"

# ---------------------------------------------------------------------------
step "Funding the treasury with test USDC"
# ---------------------------------------------------------------------------
# The treasury must hold a USDC trustline BEFORE it can be minted to. `mint` does not
# create one: without it the SAC fails simulation with Error(Contract, #13),
# "trustline entry is missing for account". Verified against stellar-cli 28 on testnet.
#
# This is also why `provisionWallet` has to establish a trustline for every new user
# wallet before seeding it — same constraint, same failure.
stellar tx new change-trust \
  --source-account musea-treasury \
  --line "USDC:$ISSUER" \
  --network "$NETWORK"
echo "  treasury trustline established"

stellar contract invoke \
  --id "$USDC_SAC_ID" \
  --source musea-issuer \
  --network "$NETWORK" \
  -- mint \
  --to "$TREASURY" \
  --amount "$(( TREASURY_MINT * 10000000 ))"
echo "  minted $TREASURY_MINT USDC to the treasury"

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
  --usdc "$USDC_SAC_ID")"
echo "  TipJar: $TIPJAR_CONTRACT_ID"

# ---------------------------------------------------------------------------
step "Environment variables"
# ---------------------------------------------------------------------------
TREASURY_SECRET="$(stellar keys show musea-treasury)"
MASTER_KEY="$(openssl rand -base64 32)"
AUTH_SECRET="$(openssl rand -base64 32)"

cat <<CONFIG

Paste these into the Convex dashboard (Settings -> Environment Variables),
or run each as: npx convex env set NAME 'value'

  STELLAR_NETWORK=$NETWORK
  HORIZON_URL=https://horizon-testnet.stellar.org
  RPC_URL=https://soroban-testnet.stellar.org
  NETWORK_PASSPHRASE=Test SDF Network ; September 2015
  FRIENDBOT_URL=https://friendbot.stellar.org
  USDC_ASSET_CODE=USDC
  USDC_ISSUER=$ISSUER
  USDC_SAC_ID=$USDC_SAC_ID
  TIPJAR_CONTRACT_ID=$TIPJAR_CONTRACT_ID
  TREASURY_PUBLIC=$TREASURY
  TREASURY_SECRET=$TREASURY_SECRET
  SEED_AMOUNT=$SEED_AMOUNT
  MASTER_ENCRYPTION_KEY=$MASTER_KEY
  BETTER_AUTH_SECRET=$AUTH_SECRET

Verify the deploy:
  https://stellar.expert/explorer/testnet/contract/$TIPJAR_CONTRACT_ID

CONFIG

warn "TREASURY_SECRET and MASTER_ENCRYPTION_KEY are printed above. They are secrets:"
warn "  - do not commit them, paste them into an issue, or send them to the client"
warn "  - if this terminal is being recorded, clear the scrollback now"
