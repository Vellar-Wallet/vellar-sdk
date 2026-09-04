# Config validation helper

`validateConfig(config, schema)` checks a plain configuration object against
a schema of required field names and expected types (`string` | `number` |
`boolean` | `object` | `array`). Returns a list of human-readable error
messages instead of throwing on the first problem, so every issue can be
shown at once.

## Usage

```ts
import { validateConfig, type FieldSchema } from "./config-validator";

const schema: FieldSchema[] = [
  { name: "network", type: "string" },
  { name: "enableX402", type: "boolean" },
];

validateConfig({ network: "testnet", enableX402: true }, schema);
// -> [] (valid)

validateConfig({ enableX402: "yes" }, schema);
// -> [
//   'Missing required field "network"',
//   'Field "enableX402" expected type "boolean", got "string"',
// ]
```

Fields present in the config but not listed in the schema are ignored —
this validates required shape, not a strict allowlist.

## Run it

```sh
npx tsx config-validator.ts
```

Expected output:

```
Valid config errors: []
Broken config errors: [
  'Missing required field "appName"',
  'Field "rpcUrl" expected type "string", got "number"',
  'Field "enableX402" expected type "boolean", got "string"'
]
```

## Tests

```sh
npx vitest run contrib/examples/config-validator
```
