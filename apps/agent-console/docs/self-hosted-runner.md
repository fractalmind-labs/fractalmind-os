# Agent Console Apple Silicon runner

Agent Console CI is intentionally macOS/Apple Silicon only. Jobs target one
repository-scoped runner with these labels:

```text
self-hosted, macOS, ARM64, rosex-host, agent-console
```

## Security boundary

- The repository is private. Pull requests from forks are excluded from the
  persistent runner job.
- Run the service under a dedicated standard macOS user with no `sudo` access
  and no read access to RoseX's normal home, envd credentials, or agent tmux
  data. Do not install it under the existing `sulabs_001` account.
- Register the runner at repository scope, not organization scope.
- Never paste registration or removal tokens into issues, Slack, shell history,
  workflow logs, or artifacts.
- The workflow token is read-only on pull requests and checkout credentials are
  not persisted.
- Signing, notarization, tags, and release publication remain separate owner
  approval gates. This runner uses the repository's existing ad-hoc Test bundle
  configuration only.

## Pinned bootstrap

As the dedicated runner user, install the current reviewed Apple Silicon runner
package. The runner can self-update after registration.

```bash
mkdir -p "$HOME/actions-runner-agent-console"
cd "$HOME/actions-runner-agent-console"

version=2.332.0
archive="actions-runner-osx-arm64-${version}.tar.gz"
curl -fL --retry 3 -o "$archive" \
  "https://github.com/actions/runner/releases/download/v${version}/${archive}"
echo "d53bedb30619a64e751bb9f729cc9e9b35eb1df5361651d54daae00db33f2e73  $archive" \
  | shasum -a 256 -c -
tar xzf "$archive"
```

Obtain a one-hour repository registration token through a trusted admin shell,
export it only for the configuration command, and unset it immediately:

```bash
./config.sh \
  --url https://github.com/fractalmind-ai/agent-console \
  --token "$RUNNER_REGISTRATION_TOKEN" \
  --name rosex-agent-console-arm64 \
  --labels rosex-host,agent-console \
  --work _work \
  --unattended \
  --replace
unset RUNNER_REGISTRATION_TOKEN

./svc.sh install
./svc.sh start
./svc.sh status
```

GitHub must read back the runner as `online`, idle, `macOS`/`ARM64`, and carrying
both custom labels before any workflow is dispatched.

## Rollback

If isolation, labels, checkout identity, or the first CI job do not match, stop
the service immediately and keep PRs unmerged:

```bash
cd "$HOME/actions-runner-agent-console"
./svc.sh stop
./svc.sh uninstall
```

Then obtain a short-lived repository removal token, run
`./config.sh remove --token "$RUNNER_REMOVAL_TOKEN"`, unset the token, and verify
through the GitHub runners API that the runner is absent. Removing the runner
does not authorize deleting build evidence or modifying the existing envd and
agent services.
