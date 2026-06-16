#!/usr/bin/env bash
# scaffold-factory.sh — append a createMock<Type> factory stub to the project's
# factories module, framework-agnostic (TypeScript only).
#
# The factory pattern is the one a real production codebase uses (527-line factories.ts):
#   - Plain TypeScript, no React imports
#   - Each factory: createMockX(overrides: Partial<X> = {}): X
#   - Deterministic defaults (no Math.random / Date.now / unseeded faker)
#   - Returns the production type (Partial<X> overrides)
#
# Where the factory lives — first existing of:
#   .storybook/factories.ts
#   src/stories/factories/index.ts
#   src/stories/factories.ts
# If none exist, defaults to .storybook/factories.ts (creating the file).
#
# Usage:
#   scaffold-factory.sh <TypeName>                       # default type import: '@/types'
#   scaffold-factory.sh <TypeName> <type-import-path>    # custom import path
#   scaffold-factory.sh User '@/types/user'
#   scaffold-factory.sh Course '../types' --target .storybook/factories.ts
#
# Output: appends a stub the agent should fill in. The stub compiles only after
# the agent fills the required-by-type fields. Intentional — forces engagement
# with the production type.
#
# Exit codes:
#   0  factory stub appended
#   1  factory already exists for this type (will not overwrite)
#   2  bad invocation

set -uo pipefail

TYPE_NAME=""
IMPORT_PATH="@/types"
TARGET_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET_FILE="$2"; shift 2 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *)
      if [[ -z "$TYPE_NAME" ]]; then TYPE_NAME="$1"
      elif [[ "$IMPORT_PATH" == "@/types" ]]; then IMPORT_PATH="$1"
      fi
      shift
      ;;
  esac
done

if [[ -z "$TYPE_NAME" ]]; then
  echo "ERROR: pass a TypeScript type name. e.g. scaffold-factory.sh User '@/types/user'" >&2
  exit 2
fi

# Validate TypeName is PascalCase
if ! echo "$TYPE_NAME" | grep -qE '^[A-Z][A-Za-z0-9]*$'; then
  echo "ERROR: TypeName must be PascalCase (got '$TYPE_NAME')." >&2
  exit 2
fi

# Resolve target file
if [[ -z "$TARGET_FILE" ]]; then
  for cand in .storybook/factories.ts src/stories/factories/index.ts src/stories/factories.ts; do
    if [[ -f "$cand" ]]; then TARGET_FILE="$cand"; break; fi
  done
fi
if [[ -z "$TARGET_FILE" ]]; then
  TARGET_FILE=".storybook/factories.ts"
fi

GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; RESET=$'\033[0m'
if [[ ! -t 1 ]]; then GREEN=""; YELLOW=""; DIM=""; RESET=""; fi

# If target file doesn't exist, create with header
if [[ ! -f "$TARGET_FILE" ]]; then
  mkdir -p "$(dirname "$TARGET_FILE")"
  cat > "$TARGET_FILE" <<'EOF'
/**
 * Shared mock factories for Storybook stories.
 *
 * Framework-agnostic — plain TypeScript, no React imports. Re-usable in tests.
 *
 * Rules (see references/factory-patterns.md in the sb-stories skill):
 *  - Each factory: createMockX(overrides: Partial<X> = {}): X
 *  - Deterministic defaults (no Math.random / Date.now / unseeded faker)
 *  - Return the production type — Partial<X> overrides allow customization
 *  - Compose: factories can call other factories for nested entities
 */

EOF
  echo "${DIM}Created $TARGET_FILE${RESET}"
fi

# Refuse to clobber an existing factory for this type
if grep -qE "^export function createMock${TYPE_NAME}\b" "$TARGET_FILE" 2>/dev/null; then
  echo "${YELLOW}createMock${TYPE_NAME} already exists in $TARGET_FILE — refusing to overwrite.${RESET}"
  echo "${DIM}Edit the file directly, or remove the existing factory first.${RESET}"
  exit 1
fi

# Ensure type is imported
if ! grep -qE "import\s+type\s+\{[^}]*\b${TYPE_NAME}\b[^}]*\}\s+from\s+['\"]${IMPORT_PATH}['\"]" "$TARGET_FILE" 2>/dev/null; then
  # Append import after the comment header, before the first export
  # Strategy: find first `export` line, insert import before it
  if grep -qE "^export " "$TARGET_FILE"; then
    awk -v import="import type { ${TYPE_NAME} } from '${IMPORT_PATH}';" '
      /^export / && !inserted { print import; print ""; inserted=1 }
      { print }
    ' "$TARGET_FILE" > "$TARGET_FILE.tmp" && mv "$TARGET_FILE.tmp" "$TARGET_FILE"
  else
    # No exports yet — append at end
    {
      echo ""
      echo "import type { ${TYPE_NAME} } from '${IMPORT_PATH}';"
    } >> "$TARGET_FILE"
  fi
fi

# Append the factory stub
cat >> "$TARGET_FILE" <<EOF

export function createMock${TYPE_NAME}(overrides: Partial<${TYPE_NAME}> = {}): ${TYPE_NAME} {
  // TODO(agent): fill in deterministic defaults for every required field of ${TYPE_NAME}.
  // Rules: no Math.random, no Date.now, no unseeded faker. Static IDs/dates only.
  // Compose with other factories for nested types: ...createMockNested(),
  return {
    // id: 1,
    // createdAt: '2026-01-01T00:00:00.000Z',
    // ...
    ...overrides,
  } as ${TYPE_NAME};
}
EOF

echo "${GREEN}✓ Appended createMock${TYPE_NAME} stub to $TARGET_FILE${RESET}"
echo "${DIM}Next: open the file, fill in the TODO with deterministic defaults from ${IMPORT_PATH}.${RESET}"
echo "${DIM}Then: tsc --noEmit will fail until every required field is set — that's intentional.${RESET}"
exit 0
