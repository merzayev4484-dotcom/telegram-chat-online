#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js o'rnatilmagan: https://nodejs.org"; exit 1; }
echo "Brauzerda oching: http://localhost:3000  (ega: ega@test.com)"
OWNER_EMAIL=ega@test.com DEV_LOGIN=1 PORT=3000 node server.js
