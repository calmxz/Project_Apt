# Build stage: compile Vite bundle.
FROM node:26.3.1-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# VITE_API_BASE_URL is baked into the bundle. Prod nginx reverse-proxies /api
# back to the backend service so the SPA uses a same-origin relative URL.
ENV VITE_API_BASE_URL=/api
RUN npm run build

# Serve stage: lean nginx with SPA fallback + /api proxy.
FROM nginx:1.27.5-alpine
# Pull latest alpine patches (closes CVE-2026-31789 in libssl3/libcrypto3 that
# ships in 1.27.5-alpine baseline). Trivy scan gates merges on CRITICAL CVEs.
RUN apk --no-cache upgrade
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
