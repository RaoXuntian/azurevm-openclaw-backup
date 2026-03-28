#!/usr/bin/env bash
set -euo pipefail

# Patch local openclaw-weixin extension to stay compatible with recent OpenClaw SDK path changes.
# Safe to run repeatedly.

OPENCLAW_ROOT="${OPENCLAW_ROOT:-$HOME/.nvm/versions/node/v22.22.1/lib/node_modules/openclaw}"
PLUGIN_ROOT="${PLUGIN_ROOT:-$HOME/.openclaw/extensions/openclaw-weixin}"

if [[ ! -d "$OPENCLAW_ROOT" ]]; then
  echo "ERROR: OpenClaw root not found: $OPENCLAW_ROOT" >&2
  exit 1
fi
if [[ ! -d "$PLUGIN_ROOT" ]]; then
  echo "ERROR: plugin root not found: $PLUGIN_ROOT" >&2
  exit 1
fi

mkdir -p "$PLUGIN_ROOT/node_modules"
ln -sfn "$OPENCLAW_ROOT" "$PLUGIN_ROOT/node_modules/openclaw"

echo "[patch] linked plugin-local openclaw => $OPENCLAW_ROOT"

python3 - <<'PY'
from pathlib import Path
plugin = Path.home() / '.openclaw' / 'extensions' / 'openclaw-weixin'
replacements = {
    plugin / 'index.ts': [
        ('import { buildChannelConfigSchema } from "openclaw/plugin-sdk";\n',
         'import { buildChannelConfigSchema } from "openclaw/plugin-sdk/core";\n')
    ],
    plugin / 'src/channel.ts': [
        ('import { normalizeAccountId, resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk";\n',
         'import { normalizeAccountId } from "openclaw/plugin-sdk/core";\nimport { resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk/infra-runtime";\n')
    ],
    plugin / 'src/log-upload.ts': [
        ('import { resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk";\n',
         'import { resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk/infra-runtime";\n')
    ],
    plugin / 'src/util/logger.ts': [
        ('import { resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk";\n',
         'import { resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk/infra-runtime";\n')
    ],
    plugin / 'src/auth/accounts.ts': [
        ('import { normalizeAccountId } from "openclaw/plugin-sdk";\n',
         'import { normalizeAccountId } from "openclaw/plugin-sdk/core";\n')
    ],
    plugin / 'src/auth/pairing.ts': [
        ('import { withFileLock } from "openclaw/plugin-sdk";\n',
         'import { withFileLock } from "openclaw/plugin-sdk/infra-runtime";\n')
    ],
    plugin / 'src/messaging/process-message.ts': [
        ('import {\n  createTypingCallbacks,\n  resolveSenderCommandAuthorizationWithRuntime,\n  resolveDirectDmAuthorizationOutcome,\n  resolvePreferredOpenClawTmpDir,\n} from "openclaw/plugin-sdk";\n',
         'import { createTypingCallbacks } from "openclaw/plugin-sdk/channel-runtime";\nimport {\n  resolveSenderCommandAuthorizationWithRuntime,\n  resolveDirectDmAuthorizationOutcome,\n} from "openclaw/plugin-sdk/command-auth";\nimport { resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk/infra-runtime";\n')
    ],
    plugin / 'src/messaging/send.ts': [
        ('import { stripMarkdown } from "openclaw/plugin-sdk";\n',
         'import { stripMarkdown } from "openclaw/plugin-sdk/text-runtime";\n')
    ],
}
patched = []
for path, pairs in replacements.items():
    if not path.exists():
        continue
    text = path.read_text()
    new = text
    for old, repl in pairs:
        if old in new:
            new = new.replace(old, repl)
    if new != text:
        path.write_text(new)
        patched.append(str(path))
print('[patch] modified files:')
for p in patched:
    print(' -', p)
if not patched:
    print(' - none (already patched or source changed)')
PY

echo "[patch] verifying module resolution"
node - <<'JS'
const base=['/home/xtrao/.openclaw/extensions/openclaw-weixin'];
for (const mod of ['openclaw/plugin-sdk','openclaw/plugin-sdk/core','openclaw/plugin-sdk/infra-runtime']) {
  const p=require.resolve(mod,{paths:base});
  console.log(' OK', mod, '=>', p);
}
JS

echo "[patch] done"
