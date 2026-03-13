#!/bin/sh
set -e

INDEX="/usr/share/nginx/html/index.html"

sed -i \
  -e "s|__VITE_DEFAULT_WORKSPACE_URL__|${VITE_DEFAULT_WORKSPACE_URL:-}|g" \
  -e "s|__VITE_DEFAULT_APPLICATION_ID__|${VITE_DEFAULT_APPLICATION_ID:-}|g" \
  -e "s|__VITE_X_API_KEY__|${VITE_X_API_KEY:-}|g" \
  -e "s|__VITE_FILES_NAMESPACE__|${VITE_FILES_NAMESPACE:-}|g" \
  -e "s|__VITE_FILES_COLLECTION__|${VITE_FILES_COLLECTION:-}|g" \
  "$INDEX"

exec nginx -g "daemon off;"
