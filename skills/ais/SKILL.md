---
name: ais
description: Work with AIS (Agent Interaction Spec) — the standard for describing DeFi protocol interfaces for AI agents. Use when: (1) installing or setting up the @owliabot/ais-ts-sdk, (2) validating/linting AIS spec files (.ais.yaml, .ais-pack.yaml, .ais-flow.yaml), (3) parsing or resolving AIS protocol specs, packs, and workflows in TypeScript/Node.js, (4) authoring new AIS protocol specs or pack files, (5) any task involving the `ais` CLI command.
version: 1.0.0
---

# AIS — Agent Interaction Spec

AIS defines a chain-agnostic schema for DeFi protocol interaction specs used by AI agents.
Three document types: **Protocol Spec** (`.ais.yaml`), **Pack** (`.ais-pack.yaml`), **Workflow** (`.ais-flow.yaml`).

## Installation

```bash
# As a project dependency
npm install @owliabot/ais-ts-sdk
# or
pnpm add @owliabot/ais-ts-sdk

# Global CLI
npm install -g @owliabot/ais-ts-sdk
```

## CLI

```bash
ais validate ./protocols/          # Validate against schema
ais lint ./specs/                  # Check best practices
ais check . --recursive            # Validate + lint + workflow refs
ais check . --json                 # JSON output
ais check . --quiet                # Errors only
ais version
```

## TypeScript SDK

```typescript
import {
  parseAIS, parseProtocolSpec, parsePack, parseWorkflow,
  validate, detectType,
  createContext, registerProtocol, resolveAction,
  setVariable, setQueryResult, resolveExpressionString,
  validateConstraints, requiresSimulation,
  validateWorkflow, getWorkflowProtocols,
  loadDirectory, loadDirectoryAsContext,
} from '@owliabot/ais-ts-sdk';

// Parse any AIS document (auto-detects type)
const doc = parseAIS(yamlString);
// doc.type === 'protocol' | 'pack' | 'workflow'

// Validate
const result = validate(yamlString);
if (!result.valid) console.log(result.issues);

// Resolver context
const ctx = createContext();
registerProtocol(ctx, protocolSpec);
const action = resolveAction(ctx, 'uniswap-v3/swap_exact_in');

// Load directory
const { protocols, packs, workflows, errors } = await loadDirectory('./protocols');
```

## Document Schemas

### Protocol Spec (`.ais.yaml`)
```yaml
ais_version: "1.0"
type: protocol
protocol:
  name: my-protocol
  version: "1.0.0"
  chain_id: 1
  addresses:
    router: "0x..."
queries:
  - name: get_price
    contract: router
    method: getAmountOut
    outputs:
      - name: amount
        type: uint256
actions:
  - name: swap
    contract: router
    method: exactInputSingle
    inputs:
      - name: tokenIn
        type: address
      - name: amountIn
        type: uint256
```

### Pack (`.ais-pack.yaml`)
```yaml
ais_version: "1.0"
type: pack
pack:
  name: safe-defi
  version: "1.0.0"
protocols:
  - protocol: my-protocol
    version: "1.0.0"
constraints:
  slippage:
    max_bps: 50
  require_simulation: true
```

### Workflow (`.ais-flow.yaml`)
```yaml
ais_version: "1.0"
type: workflow
workflow:
  name: swap-to-token
  version: "1.0.0"
inputs:
  - name: target_token
    type: address
steps:
  - id: swap
    uses: my-protocol/swap
    with:
      token_out: "${input.target_token}"
```

## Expression Syntax

- `${input.name}` — Input parameter
- `${query.name.field}` — Query result field
- `${step.id.output}` — Previous step output
- `${address.name}` — Protocol address

## Constraint Validation

```typescript
const result = validateConstraints(pack.constraints, {
  token: '0x...',
  amount_usd: 5000,
  slippage_bps: 50,
});
if (!result.valid) console.log(result.violations);

if (requiresSimulation(pack.constraints)) {
  // Run simulation before executing
}
```

## References

- Spec: https://github.com/owliabot/ais
- Spec index: specs/index.md in the repo
- Examples: examples/ (uniswap-v3.ais.yaml, aave-v3.ais.yaml, safe-defi-pack.ais-pack.yaml)
