# Postfix: receiving real mail

Postfix runs on the VPS host and is the public MX. It accepts mail only for the mail domain, asks the ingest app whether each recipient exists, and hands accepted mail to ingest over LMTP. It never sends mail.

```
sender ──SMTP :25──▶ Postfix (postscreen, TLS, 10 MB limit)
                       ├─ RCPT TO ──▶ ingest policy service 127.0.0.1:10040
                       └─ delivery ─▶ ingest LMTP          127.0.0.1:2525
```

The names used below:

| Name | Purpose |
|---|---|
| `mail.ilotus.dev` | Mail domain. Addresses look like `k3x9q2m7p1zt@mail.ilotus.dev`. |
| `mx.ilotus.dev` | The VPS's public name, which the MX record points to. |
| `ilotus.dev` | Not touched. Its existing MX (name.com forwarding), SPF and A records stay as they are. |

A subdomain is used so the temporary inboxes never interfere with mail to the main domain.

## 1. DNS records (at name.com)

Replace `VPS_IP` with the server's public IPv4 address.

| Type | Host | Value | Why |
|---|---|---|---|
| A | `mx` | `VPS_IP` | Where the MX points |
| MX | `mail` | `mx.ilotus.dev`, priority 10 | Sends mail for `@mail.ilotus.dev` to the VPS |
| TXT | `mail` | `v=spf1 -all` | No server may send as `@mail.ilotus.dev` |
| TXT | `_dmarc.mail` | `v=DMARC1; p=reject; adkim=s; aspf=s` | Receivers reject forged mail from the domain |
| TXT | `mx` | `v=spf1 -all` | The MX host sends nothing either |

Also ask the VPS provider to set the **reverse DNS (PTR)** of `VPS_IP` to `mx.ilotus.dev`. Receiving works without it, but some senders and block lists treat a server without matching reverse DNS as suspicious.

Check:

```
dig +short MX mail.ilotus.dev     # 10 mx.ilotus.dev.
dig +short A mx.ilotus.dev        # VPS_IP
dig +short -x VPS_IP              # mx.ilotus.dev.
```

## 2. Port 25

Opening the port in the VPS firewall (`ufw`, `iptables`) is necessary but may not be enough: many providers block port 25 in their own network, outside the server, and only the provider can lift that. Only **inbound** 25 matters here, since this server never sends.

Check from a machine outside the VPS, once Postfix is running:

```
nc -vz VPS_IP 25          # should connect and print a 220 banner with: telnet VPS_IP 25
```

If it times out while `ss -ltn | grep ':25 '` on the VPS shows Postfix listening and the VPS firewall allows it, the provider blocks the port: open a ticket asking them to allow inbound TCP 25. A provider-side firewall or security group in their control panel is another common cause.

## 3. Install and configure Postfix

Needs Debian 12+ or Ubuntu 22.04+ (Postfix 3.6 or newer). If another mail server (Exim, Sendmail) is installed, remove it first.

```
sudo MAIL_DOMAIN=mail.ilotus.dev MX_HOST=mx.ilotus.dev ./setup.sh
```

The script is safe to run again after changing anything. It sets:

- receive-only: no local delivery, and every outgoing message fails, so a rejected message never bounces back to a forged sender;
- relay for `mail.ilotus.dev` only, to ingest over LMTP;
- the recipient check at `RCPT TO`. If ingest cannot answer, Postfix replies `451` and the sender retries later; no mail is lost;
- a 10 MB size limit and connection rate limits;
- postscreen with Spamhaus, SpamCop and DNSWL. Its deep protocol tests stay off, because they make every new sender retry, which would delay one-time codes by minutes;
- opportunistic STARTTLS;
- fast retries (every 1 to 5 minutes, for up to 2 hours), since inboxes live for one hour.

Spamhaus refuses queries that come through public resolvers such as 8.8.8.8 or 1.1.1.1. If the VPS uses one, the Spamhaus check quietly does nothing. A local resolver (`apt install unbound`, then `nameserver 127.0.0.1` in `/etc/resolv.conf`) fixes that.

### TLS certificate

Without one, STARTTLS uses the self-signed certificate the package installs. Senders still encrypt; they just do not verify it. To get a real one (port 80 must be open and free):

```
sudo apt install certbot
sudo certbot certonly --standalone -d mx.ilotus.dev --deploy-hook "systemctl reload postfix"
sudo MAIL_DOMAIN=mail.ilotus.dev MX_HOST=mx.ilotus.dev ./setup.sh    # picks the certificate up
```

Once Nginx owns port 80 (Day 11), renewals need `--webroot` instead of `--standalone`.

## 4. Connect Postfix to ingest

Postfix expects ingest on `127.0.0.1:2525` and `127.0.0.1:10040`.

**Before the app is deployed** (Day 9 testing), the app can run on a laptop and be reached through an SSH tunnel. On the laptop:

```
# .env: MAIL_DOMAIN="mail.ilotus.dev"
pnpm infra:up && pnpm db:seed     # makes mail.ilotus.dev the domain for new addresses
pnpm dev
ssh -N -R 127.0.0.1:2525:127.0.0.1:2525 -R 127.0.0.1:10040:127.0.0.1:10040 user@VPS_IP
```

The tunnel ports open on the VPS's loopback only. While the tunnel or the laptop is down, Postfix answers `451` and senders retry.

**After deployment** (Day 11), ingest runs on the VPS with its ports published on `127.0.0.1` only. Postfix needs no change.

## 5. Test

Generate an address in the dashboard and send it a message from Gmail or another real service. It should appear within a few seconds.

On the VPS:

```
sudo tail -f /var/log/mail.log      # or: journalctl -u postfix -f
postqueue -p                        # mail waiting for a retry
sudo postqueue -f                   # retry it now
```

What the log shows:

| Line | Meaning |
|---|---|
| `postscreen ... PASS NEW` / `PASS OLD` | Sender passed the connection checks |
| `NOQUEUE: reject: RCPT ... 550 5.1.1 ... User unknown` | Address never existed |
| `NOQUEUE: reject: RCPT ... 550 5.1.1 ... Mailbox expired` | Address expired |
| `NOQUEUE: reject: RCPT ... 451 4.3.5 Recipient check unavailable` | Ingest not reachable on port 10040 |
| `lmtp ... status=sent (250 2.0.0 Queued)` | Handed to ingest; the worker takes it from here |
| `lmtp ... status=deferred ... Connection refused` | Ingest not reachable on port 2525; retried |
