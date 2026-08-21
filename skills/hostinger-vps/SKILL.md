---
name: hostinger-vps
description: Connect to and safely operate the Dragao Careca Hostinger VPS over SSH. Use when checking VPS connectivity, inspecting the deployed admin API/web services, reading logs, or performing an explicitly requested deployment. Never store or print VPS credentials.
metadata:
  short-description: Safely connect to the Hostinger VPS over SSH
---

# Hostinger VPS

Use this skill for the Dragao Careca VPS only through SSH. The skill is
parameterized so credentials remain outside the repository.

## Required configuration

The default credentials file is `~/.config/hostinger-vps/credentials.env`.
The checker loads it automatically. Alternatively, set these environment
variables in the shell that runs the operation:

- `HOSTINGER_VPS_HOST`: VPS hostname or IP address.
- `HOSTINGER_VPS_USER`: SSH user.
- `HOSTINGER_VPS_SSH_KEY`: absolute path to the private SSH key.
- `HOSTINGER_VPS_PORT`: optional SSH port; defaults to `22`.
- `HOSTINGER_VPS_PROJECT_DIR`: optional deployed project directory.

Override the credentials-file location with `HOSTINGER_VPS_CREDENTIALS_FILE`
when needed. The credentials file must be shell-compatible `KEY=value` data,
owned by the current user with mode `600`.

The key must be protected (`chmod 600`). Do not put values in `.env`,
`.planning/`, commits, shell history, or skill files.

## Connection workflow

1. Check that the required variables exist and the key is readable.
2. Run `scripts/check-connection.sh` for a read-only connectivity test.
3. Before any mutation, inspect the remote service and deployed files. Check
   Git state only when the configured remote directory is actually a checkout.
4. For deployment, show the exact remote commands and require explicit user
   approval before running them.
5. Never use `git reset --hard`, delete remote media, or overwrite production
   environment files without a separate explicit request.

## Safe inspection examples

```bash
./scripts/check-connection.sh
ssh -p "${HOSTINGER_VPS_PORT:-22}" -i "$HOSTINGER_VPS_SSH_KEY" "$HOSTINGER_VPS_USER@$HOSTINGER_VPS_HOST" 'uname -a; free -h; df -h; systemctl --no-pager --type=service --state=running | head -40'
```

For project inspection, use the configured directory only after confirming it.
The production app directory may be a deployed copy rather than a Git
checkout, so do not assume `.git` exists:

```bash
ssh -p "${HOSTINGER_VPS_PORT:-22}" -i "$HOSTINGER_VPS_SSH_KEY" "$HOSTINGER_VPS_USER@$HOSTINGER_VPS_HOST" "cd '$HOSTINGER_VPS_PROJECT_DIR' && git status --short && git branch --show-current"
```

## Repository-specific constraints

- The VPS target has 4 GB RAM; keep transcript and summary agents sequential.
- Feed generation remains backend-owned.
- Preserve backend `AUTH_BYPASS` behavior and never copy local development
  secrets to the VPS.
- Prefer the repository's existing `scripts/bootstrap-vps.sh` and documented
  service commands instead of inventing parallel deployment paths.
- Verify deployments with `npm run typecheck` and `npm run build` before
  restarting services.

## Failure handling

- `Permission denied`: do not retry with passwords or print key contents;
  verify the SSH user, key path, and authorized-key configuration.
- `Connection timed out`: verify Hostinger firewall/network settings and the
  configured port.
- Missing configuration: stop and ask for the missing non-secret variable.
- A failed deployment must leave the existing service running whenever
  possible; capture logs before attempting recovery.
