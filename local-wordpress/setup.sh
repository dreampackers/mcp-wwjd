#!/usr/bin/env bash
# Spins up a local WordPress + MySQL via Docker Compose and fully configures it
# for testing mcp-wwjd: installs WordPress, enables Application Passwords
# (disabled by default over plain HTTP unless the environment type is "local"),
# sets pretty permalinks (required for the REST API's /wp-json/ route), and
# prints a ready-to-paste .env block with a freshly generated Application Password.
set -euo pipefail
cd "$(dirname "$0")"

SITE_URL="http://localhost:8080"
ADMIN_USER="admin"
ADMIN_PASSWORD="TestPass123!"
ADMIN_EMAIL="admin@example.com"
APP_PASSWORD_NAME="mcp-wwjd-$(date +%s)"

wp() { docker compose exec -T cli wp --path=/var/www/html --allow-root "$@"; }

echo "==> Starting containers..."
docker compose up -d

echo "==> Waiting for the database to accept connections..."
for i in $(seq 1 30); do
  if wp db check 2>/dev/null; then break; fi
  sleep 2
done

if wp core is-installed 2>/dev/null; then
  echo "==> WordPress already installed, skipping install."
else
  echo "==> Installing WordPress..."
  for i in $(seq 1 5); do
    if wp core install \
      --url="$SITE_URL" \
      --title="MCP Test Site" \
      --admin_user="$ADMIN_USER" \
      --admin_password="$ADMIN_PASSWORD" \
      --admin_email="$ADMIN_EMAIL" \
      --skip-email; then
      break
    fi
    echo "    retrying in 3s..."
    sleep 3
  done
fi

echo "==> Fixing uploads directory permissions..."
docker compose exec -T -u root wordpress chown -R www-data:www-data /var/www/html/wp-content

echo "==> Enabling pretty permalinks (needed for /wp-json/ routes)..."
wp rewrite structure '/%postname%/' --hard
wp rewrite flush --hard

echo "==> Enabling Application Passwords (WordPress disables them by default over plain HTTP unless WP_ENVIRONMENT_TYPE=local)..."
if ! wp config has WP_ENVIRONMENT_TYPE 2>/dev/null; then
  wp config set WP_ENVIRONMENT_TYPE local --type=constant
fi

echo "==> Generating a fresh Application Password..."
APP_PASSWORD=$(wp user application-password create "$ADMIN_USER" "$APP_PASSWORD_NAME" --porcelain)

cat <<EOF

=====================================================================
로컬 워드프레스 준비 완료!

관리자 화면:  $SITE_URL/wp-admin  (로그인: $ADMIN_USER / $ADMIN_PASSWORD)

아래 내용을 mcp-wwjd 프로젝트 루트의 .env 파일에 붙여넣으세요:

WP_SITE_URL=$SITE_URL
WP_USERNAME=$ADMIN_USER
WP_APP_PASSWORD=$APP_PASSWORD
WP_DEFAULT_STATUS=draft
=====================================================================
EOF
