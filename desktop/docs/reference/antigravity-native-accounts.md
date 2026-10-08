# Native Antigravity Accounts

Accounts reads the credential authority on the runtime that owns execution. A client chooses
an owning Orca runtime and a host/distro target before sending an operation; it never replaces
the client's Mac Keychain item for another host. The RPC capability is
`accounts.antigravity-native.v1`. Older paired hosts are refused before account mutations.
The RPC returns account summaries only, never credential JSON, access tokens or refresh tokens.
Displayed quota is tied to the subject and authentication method observed during its refresh;
an external identity change hides the previous account's quota without an automatic fetch.

## Supported authority

Normal macOS agy uses service `gemini`, account `antigravity`. Its go-keyring values use the
base64 or legacy hex wrapper. Orca passes writes through `security -i` stdin, validates bounded
output and reads the entire native value back. The command buffer limit is checked before
writing. A missing native item falls back to the CLI-specific
`~/.gemini/antigravity-cli/antigravity-oauth-token` file. The distinct legacy jetski fallback
is not imported.

Normal Windows agy keeps its login in Windows Credential Manager: a generic credential with
target `gemini:antigravity` and user name `antigravity` (go-keyring's Windows layout). The blob
is the raw UTF-8 JSON with no wrapper, and Windows caps it at 2,560 bytes. NASH reaches that one
item through `@orca/windows-credentials` (`native/windows-credentials`), an N-API addon over
`CredReadW`/`CredWriteW` for `CRED_TYPE_GENERIC` by exact target name. It has no enumeration
call; its only other call deletes items in the disposable `nash-test:` namespace for the
real-store test and refuses every other target. A missing item means agy is signed out; there
is no file fallback on Windows. A write refuses more than 2,560 bytes before touching the item,
compares the current item with the expected value immediately before writing, keeps the
existing item's user name and persistence (a new item gets `antigravity` and
`CRED_PERSIST_LOCAL_MACHINE`, as agy writes it), and reads the whole blob back. Failures carry
only the Win32 error code, never a system message or credential bytes. PowerShell `Add-Type` is
an EDR signal ([windows-edr-posture.md](./windows-edr-posture.md)), `cmdkey` cannot read a blob
back and would put it on a command line, and WinRT `PasswordVault` cannot see these items, so
none of them is used. `config/scripts/rebuild-native-deps.mjs` builds the addon against
Electron next to `@orca/windows-registry`; Windows packages ship it under
`node_modules/@orca/windows-credentials`.

The compiled CLI bypasses keyring storage when SSH/WSL environment detectors or WSL kernel
identity apply. A runtime running under that evidenced bypass reads/writes its own CLI file;
it does not contact the client keychain. The file must be private and regular. A
`cache/antigravity-keyring-unavailable` marker makes authority uncertain on macOS and Windows:
Orca refuses instead of assuming that the keyring or file wins.

Native Linux Secret Service and operations directed from Windows Orca to a selected WSL distro
are explicitly unsupported pending verified adapters. The Windows file bypass (agy under SSH on
a Windows host) is refused until private ACL protection is verified. Linux uses the login
collection with `service=gemini`, `username=antigravity`. No dependency, PowerShell
compilation, credential-home flag, or cross-host fallback is invented here.
A separate SSH relay has no Accounts RPC; use a paired owning runtime that implements it.

## Identity and snapshots

A Google ID token supplies the normalized Google issuer and stable subject. The authentication
method also scopes identity. The label uses a verified email when available; email is never the
identity key. Account record IDs are random and survive token, expiry, refresh-token and email
rotation. Profiles without a stable subject can be displayed but cannot be saved for switching.

Snapshots preserve the exact native JSON, including fields that Orca does not interpret. The
host's vault under `userData/antigravity-accounts/vault` requires meaningful OS encryption and
private permissions. Weak or unavailable encryption is refused. Unreadable/corrupt ciphertext
is preserved; it is never treated as an empty vault. This does not migrate the experimental
candidate's incompatible array vault or token-hash IDs.

One host service serializes Add, Select, Remove, launch checks and refresh reconciliation.
It re-reads the vault after asynchronous native reads and captures external CLI refreshes into
the same stable account. Selection reconciles the outgoing snapshot, checks the expected native
bytes before writing, and checks native readback before publishing the selected ID. It avoids
writing an old snapshot over an already-active account. The current or selected account cannot
be removed; deletion checks the latest native value again before committing.

A selected account is checked before new Orca PTY launches, including desktop daemon and
headless runtime paths. An externally changed native identity blocks the launch and asks the
user to select again. A launch whose environment points agy at another home is refused: the
guard compares `HOME` on macOS and Linux and `USERPROFILE` on Windows, case-insensitively,
because Go's `os.UserHomeDir` reads only `USERPROFILE` there (a Git Bash `HOME` is ignored).
Existing sessions can retain their original credentials in memory. Shell commands typed
manually into a running terminal are outside the Orca launch guard, and so are NASH's routed
agy tasks, which start outside the PTY path.

## Sign-in and concurrency limits

Sign-in uses the supported ordinary agy browser/code flow. Users run agy on the owning host;
to add a different account they use its `/logout` command, complete the next sign-in, then save
the actual resulting account in Orca. This implementation does not advertise an Orca-managed
login or invent an agy `login`/`--login` flag. Browser completion and a second real Google
account remain user-driven; tests do not sign out or change the developer's real native item.

Native keyring does not expose compare-and-swap. Orca's queue serializes its own calls, and
bounded before/after checks detect observed conflicts; another independently running agy or
Orca process can still write between the final check and the write or launch. A failed
verification may mean the native item changed but selection was not persisted. Refresh and
explicit selection resolve that state; automatic rollback could destroy a newer CLI refresh
and is deliberately avoided. The file backend has the same external-writer limit.

## Evidence and contributor credit

The foundation adapts the reviewed codec/macOS adapter from #21784 and account-service concepts
from #21797 (nwparker), with fresh identity, persistence, serialization and conflict handling.
The signed-in Accounts card and quota-error visibility acknowledge #19588 by @artile; quota
transport is reused from current main rather than its obsolete extraction code. Targeted
multi-account UI/target concepts acknowledge #23761 by @Tai-DT, replacing its placeholder login
and unused settings selection. The Accounts legacy-Gemini clarification acknowledges #21682
and the original relevant migration contribution by @siddqamar, as requested in #17345.
No stale development stack was cherry-picked.

Live proof uses a disposable Mac service/account item, a fully isolated hidden Electron home,
and synthetic accounts. A private task-only copy was also selected through the real service;
installed agy 1.2.14 consumed that verified file credential under its SSH bypass and returned
`command.name=usage`, `num_turns=0`, no conversation. The real native item remained unchanged.
This proves the Mac adapter mechanics and actual CLI file authority, not a second-account
native-keychain switch, native Windows/Linux switching, or WSL/SSH relay deployment.

Windows proof (2026-10-06): the addon was built against Electron 43.7.5 headers and run in
Electron's own runtime (run-as-node, no app window) against a disposable `nash-test:<uuid>`
item with synthetic accounts. The addon read an absent item as missing, wrote and read back
exact bytes, user name and persistence, accepted a full 2,560-byte blob, refused 2,561 bytes,
an invalid persistence and every delete outside `nash-test:`, then deleted the item. The TS
adapter, bundled unchanged, then signed in, switched, refused a stale expected value and an
over-limit write without changing the item, and read the deleted item as signed out.
`gemini:antigravity` was never read or written. `native-windows-credentials.real.test.ts`
repeats the adapter part on demand (`ORCA_REAL_AGY_NATIVE_BACKEND_TEST=1`, Windows only). This
does not yet prove a switch between two real Google accounts that installed agy then uses.
