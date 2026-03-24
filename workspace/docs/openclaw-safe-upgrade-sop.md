# OpenClaw Safe Upgrade SOP

Goal: upgrade or repair OpenClaw on a live machine while minimizing service disruption.

---

## Core rule

**Do not run `npm install -g openclaw ...` directly on the live production runtime during active use unless you have explicitly accepted a maintenance window.**

If the issue is inside a local extension/plugin, fix the extension first.

---

## Preferred repair order

1. **Read-only diagnosis first**
   - `openclaw status`
   - plugin load errors from logs
   - gateway logs
   - confirm whether the issue is core runtime vs local plugin vs config

2. **Patch local extension / config first**
   - If a local extension fails after an OpenClaw upgrade, patch the extension in place.
   - Example: `openclaw-weixin` SDK import path drift.

3. **Avoid mutating the live global install if possible**
   - Do not jump straight to `npm install -g`.
   - Prefer local symlink / compatibility patch / staged validation.

4. **If a reinstall is unavoidable**
   - announce expected impact first
   - create a rollback path first
   - perform one controlled reinstall
   - restart once
   - run smoke tests immediately

5. **Validate service recovery**
   - `openclaw status`
   - channel/plugin-specific smoke tests
   - real inbound/outbound test if the issue affected messaging

---

## Preflight checklist

Before any risky change:

- [ ] Confirm the current user wants a maintenance window or accepts disruption.
- [ ] Check current status: `openclaw status`
- [ ] Inspect recent gateway log lines for the actual failure signature.
- [ ] Identify whether the failure is:
  - [ ] core OpenClaw package
  - [ ] local plugin / extension
  - [ ] config / auth / tokens
- [ ] Prepare rollback / backup path.

---

## Weixin-specific SOP

### If `openclaw-weixin` breaks after an OpenClaw upgrade

Use the patch script first:

```bash
bash /home/xtrao/.openclaw/workspace/scripts/patch-openclaw-weixin.sh
openclaw status
```

If status is healthy again, stop there.

### If the Weixin channel still does not receive messages

Check:
- account files under `~/.openclaw/openclaw-weixin/accounts/`
- whether inbound messages appear in gateway logs
- whether a gateway restart is needed after QR login

### Important operational note

For the current Weixin integration, **successful QR login may still require a gateway restart before the new account starts polling messages**.

Operational shorthand:

1. QR login succeeds
2. restart gateway once
3. send a simple test message
4. confirm inbound + outbound in logs

---

## Smoke test checklist after restart

### Core
- [ ] `openclaw status` succeeds
- [ ] gateway is listening
- [ ] Control UI reconnects

### Plugins / channels
- [ ] plugin load errors are gone
- [ ] expected channels show healthy state
- [ ] test inbound message appears in logs
- [ ] test outbound reply is sent

### Cron / automation
- [ ] scheduled jobs still list correctly
- [ ] channel/account IDs in cron delivery match current live accounts

---

## Anti-patterns (avoid these)

### Bad
- `npm install -g openclaw@...` on the live host as the first troubleshooting step
- repeated rescans / repeated restarts while account state is still unclear
- mixing runtime upgrade, plugin patching, and account migration in one uncontrolled loop
- declaring recovery before testing real inbound/outbound messaging

### Better
- isolate the failing layer
- patch the smallest layer first
- make one deliberate restart
- verify with real traffic

---

## Incident lesson from 2026-03-24

A morning repair attempt caused extended disruption because the live global OpenClaw install was mutated in place via npm during active use. This expanded a plugin failure into a broader runtime instability window.

Rule going forward:

> **Service availability beats repair speed.**
> Fix the smallest layer that can restore service.

---

## Fast decision tree

### `openclaw status` fails with plugin load error
1. inspect the plugin import error
2. patch the plugin
3. retry status
4. only consider reinstall if core package itself is clearly broken

### QR login succeeds but messages still do not arrive
1. confirm new account file exists
2. restart gateway once
3. test inbound again

### Multiple Weixin accounts are mixed up
1. back up account files
2. prune to the intended live account(s)
3. restart gateway
4. retest with a single known chat line
