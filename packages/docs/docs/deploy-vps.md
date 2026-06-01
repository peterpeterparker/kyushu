# Deploy on a VPS

This guide covers deploying a Kyushu worker on a fresh VPS. The example uses Hetzner Cloud with Ubuntu 24.04, but any VPS with a recent Ubuntu/Debian works.

## Prerequisites

- A VPS with Ubuntu 24.04
- A domain pointing to the VPS IP (A record)
- SSH access as root

## 1. System setup

Update the system and install Caddy:

```bash
apt update && apt upgrade -y
apt install -y curl caddy
```

## 2. Install the Kyushu CLI

```bash
curl -fsSL https://kyushu.dev/install | bash
source $HOME/.cargo/env
kyu --version
```

## 3. Deploy your worker

Copy your built artifacts to the VPS — the `kyushu.run.toml`, the compiled wasm, and any static files:

```bash
mkdir -p /opt/yourwebsite
# e.g. rsync -av ./dist user@yourserver:/opt/yourwebsite/
```

## 4. Create a systemd service

```bash
cat > /etc/systemd/system/kyushu.service << 'EOF'
[Unit]
Description=Kyushu Site
After=network.target

[Service]
ExecStart=/root/.cargo/bin/kyu run kyushu.run.toml
WorkingDirectory=/opt/yourwebsite
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable kyushu
systemctl start kyushu
systemctl status kyushu
```

The service starts automatically on boot and restarts on failure.

## 5. Configure Caddy

Once your domain's DNS has propagated, configure Caddy as a reverse proxy. Check propagation first:

```bash
dig yourdomain.com +short @8.8.8.8
```

Then write the Caddyfile:

```bash
cat > /etc/caddy/Caddyfile << 'EOF'
yourdomain.com {
    reverse_proxy localhost:5987
}
EOF

systemctl restart caddy
```

Caddy automatically provisions and renews a TLS certificate via Let's Encrypt.

## Verify

```bash
curl https://yourdomain.com/install
```

## Updating

To deploy a new release, stop the service, replace the files, and restart:

```bash
systemctl stop kyushu
# copy your updated artifacts to /opt/yourwebsite
systemctl start kyushu
```
