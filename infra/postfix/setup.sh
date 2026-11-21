#!/usr/bin/env bash
# Installs and configures Postfix as a receive-only MX that hands mail to the ingest app.
# Run as root on Debian or Ubuntu. Safe to run again: every setting is applied with postconf.
#
#   sudo MAIL_DOMAIN=mail.ilotus.dev MX_HOST=mx.ilotus.dev ./setup.sh
#
# MAIL_DOMAIN         domain the generated addresses use (must match MAIL_DOMAIN in .env)
# MX_HOST             public name of this server; the MX record points here
# INGEST_HOST         where ingest listens (default 127.0.0.1)
# INGEST_LMTP_PORT    default 2525
# INGEST_POLICY_PORT  default 10040
set -euo pipefail

: "${MAIL_DOMAIN:?Set MAIL_DOMAIN, for example mail.ilotus.dev}"
: "${MX_HOST:?Set MX_HOST, for example mx.ilotus.dev}"
INGEST_HOST="${INGEST_HOST:-127.0.0.1}"
INGEST_LMTP_PORT="${INGEST_LMTP_PORT:-2525}"
INGEST_POLICY_PORT="${INGEST_POLICY_PORT:-10040}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

if ! command -v postconf >/dev/null 2>&1; then
  echo "Installing Postfix"
  echo "postfix postfix/main_mailer_type select Internet Site" | debconf-set-selections
  echo "postfix postfix/mailname string ${MX_HOST}" | debconf-set-selections
  DEBIAN_FRONTEND=noninteractive apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q postfix
fi

echo "${MX_HOST}" > /etc/mailname

echo "Configuring main.cf"
postconf -e \
  "myhostname = ${MX_HOST}" \
  "myorigin = ${MX_HOST}" \
  "smtpd_banner = \$myhostname ESMTP" \
  "inet_interfaces = all" \
  "inet_protocols = all" \
  "mynetworks = 127.0.0.0/8 [::1]/128" \
  "biff = no" \
  "compatibility_level = 3.6" \
  \
  `# Nothing is delivered on this machine and nothing is sent out.` \
  "mydestination =" \
  "local_recipient_maps =" \
  "local_transport = error:local delivery is disabled" \
  "default_transport = error:outbound mail is disabled" \
  "notify_classes =" \
  \
  `# The mail domain is relayed to ingest over LMTP. The policy service decides which recipients exist.` \
  "relay_domains = ${MAIL_DOMAIN}" \
  "relay_recipient_maps =" \
  "relay_transport = lmtp:inet:${INGEST_HOST}:${INGEST_LMTP_PORT}" \
  "smtpd_relay_restrictions = reject_unauth_destination" \
  "smtpd_recipient_restrictions = reject_non_fqdn_recipient, reject_unauth_destination, check_policy_service inet:${INGEST_HOST}:${INGEST_POLICY_PORT}" \
  "smtpd_policy_service_timeout = 10s" \
  "smtpd_policy_service_default_action = 451 4.3.5 Recipient check unavailable" \
  \
  `# Limits.` \
  "message_size_limit = 10485760" \
  "smtpd_recipient_limit = 50" \
  "smtpd_helo_required = yes" \
  "disable_vrfy_command = yes" \
  "smtpd_client_connection_count_limit = 10" \
  "smtpd_client_connection_rate_limit = 60" \
  "smtpd_client_message_rate_limit = 120" \
  "anvil_rate_time_unit = 60s" \
  \
  `# Inboxes live an hour, so retry quickly after a 451 from ingest and give up after two hours.` \
  `# A bounce can never be sent (outbound is disabled), so none are queued.` \
  "queue_run_delay = 60s" \
  "minimal_backoff_time = 60s" \
  "maximal_backoff_time = 300s" \
  "maximal_queue_lifetime = 2h" \
  "bounce_queue_lifetime = 0" \
  \
  `# postscreen: drop clients that talk before the greeting or are on block lists.` \
  `# The deep protocol tests stay off; they make every new sender retry, which delays OTP mail.` \
  "postscreen_access_list = permit_mynetworks" \
  "postscreen_denylist_action = drop" \
  "postscreen_greet_action = enforce" \
  "postscreen_dnsbl_action = enforce" \
  "postscreen_dnsbl_threshold = 3" \
  "postscreen_dnsbl_allowlist_threshold = -2" \
  "postscreen_dnsbl_sites = zen.spamhaus.org=127.0.0.[2..11]*3, bl.spamcop.net*2, list.dnswl.org=127.0.[0..255].[1..3]*-2" \
  \
  `# Opportunistic TLS for incoming mail.` \
  "smtpd_tls_security_level = may" \
  "smtpd_tls_loglevel = 1" \
  "smtpd_tls_received_header = yes" \
  "smtpd_tls_mandatory_protocols = >=TLSv1.2" \
  "smtpd_tls_protocols = >=TLSv1.2" \
  "smtp_tls_security_level = none"

CERT_DIR="/etc/letsencrypt/live/${MX_HOST}"
if [ -f "${CERT_DIR}/fullchain.pem" ]; then
  echo "Using the Let's Encrypt certificate in ${CERT_DIR}"
  postconf -e \
    "smtpd_tls_cert_file = ${CERT_DIR}/fullchain.pem" \
    "smtpd_tls_key_file = ${CERT_DIR}/privkey.pem"
else
  echo "No certificate in ${CERT_DIR}; STARTTLS uses the existing self-signed one. See infra/postfix/README.md."
fi

echo "Configuring master.cf: postscreen on port 25"
postconf -M "smtp/inet=smtp inet n - y - 1 postscreen"
postconf -M "smtpd/pass=smtpd pass - - y - - smtpd"
postconf -M "dnsblog/unix=dnsblog unix - - y - 0 dnsblog"
postconf -M "tlsproxy/unix=tlsproxy unix - - y - 0 tlsproxy"

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  echo "Opening port 25 in ufw"
  ufw allow 25/tcp
fi

postfix check
if [ -d /run/systemd/system ]; then
  systemctl enable postfix >/dev/null
  systemctl restart postfix
else
  postfix status >/dev/null 2>&1 && postfix reload || postfix start
fi

echo "Postfix accepts mail for ${MAIL_DOMAIN} and hands it to ingest at ${INGEST_HOST}:${INGEST_LMTP_PORT}."
